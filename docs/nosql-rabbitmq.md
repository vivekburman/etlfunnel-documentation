# RabbitMQ

RabbitMQ is a message broker. In a pipeline it works as a **source** that consumes from a queue or from an exchange, and as a **destination** that publishes messages. Consumers always use manual acknowledgement: a message is acknowledged only after the destination has durably written it, so a failed run does not lose messages.

## Source Operations

### Data Extraction Methods

```go
type IClientDBRabbitMQSource interface {
    GenerateQueue(param *models.RabbitMQSourceQueue) (*models.RabbitMQSourceQueueOptions, error)
    GenerateExchange(param *models.RabbitMQSourceExchange) (*models.RabbitMQSourceExchangeOptions, error)
    FetchRecords(param *models.RabbitMQSourceFetch) <-chan *models.Record
}
```

- **Queue** consumes from a queue that already exists.
- **Exchange** binds a queue you name to an exchange, with routing keys, and consumes it.
- **Record Fetching** is the user-defined capture mode, with full control over the AMQP connection.

### Source Configuration Structure

```go
type RabbitMQSourceQueue struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type RabbitMQSourceExchange struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type RabbitMQSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *amqp.Connection
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type RabbitMQSourceQueueOptions struct {
    ParseFn       func(AMQPRawMessage) (map[string]any, error)
    QueueName     string
    ConsumerTag   string
    PrefetchCount int  // QoS is set only when > 0; otherwise unlimited
    DrainToEmpty  bool // end once the messages that were ready at start have been delivered
    Ack           RabbitMQAckMode
}

type RabbitMQSourceExchangeOptions struct {
    ParseFn       func(AMQPRawMessage) (map[string]any, error)
    ExchangeName  string
    ExchangeType  string   // direct, topic, fanout or headers
    QueueName     string
    RoutingKeys   []string // required for direct and topic
    PrefetchCount int
}

type AMQPRawMessage struct {
    Headers     map[string]any
    Exchange    string
    RoutingKey  string
    ContentType string
    Body        []byte
}
```

`ParseFn` turns each raw message into the record's data. A returned error drops that message and the run continues.

### Acknowledgement and ending

| `Ack` value | Behaviour |
|---|---|
| `RabbitMQAckAfterCommit` (the zero value) | Acknowledge after the destination confirms the write. **This deletes every message it reads**, so it is the right choice for a real transfer and the wrong one for a look. |
| `RabbitMQAckNone` | Read without consuming; nothing is acknowledged. `PrefetchCount` is ignored in this mode, because a prefetch window would fill and stall the read. |
| `RabbitMQAckAuto` | The broker considers a message delivered as soon as it is sent. |

A queue read **does not end by itself**. Set `DrainToEmpty: true` for a bounded read. An exchange read does not end by itself either.

### Example Source

```go
func (d *IUseConnector) GenerateQueue(param *models.RabbitMQSourceQueue) (*models.RabbitMQSourceQueueOptions, error) {
    return &models.RabbitMQSourceQueueOptions{
        QueueName:     "orders",
        PrefetchCount: 200,
        DrainToEmpty:  true,
        Ack:           models.RabbitMQAckAfterCommit,
        ParseFn: func(m models.AMQPRawMessage) (map[string]any, error) {
            var out map[string]any
            if err := json.Unmarshal(m.Body, &out); err != nil {
                return nil, err
            }
            return out, nil
        },
    }, nil
}
```

The queue must already exist. Implement only the method for the capture mode you use; return an error from the others, as in the [Postgres](./sql-postgres) example.

## Destination Operations

```go
type IClientDBRabbitMQDest interface {
    GenerateQuery(param *models.RabbitMQDestQuery) ([]*models.RabbitMQDestQueryPayload, error)
    GenerateOptions(param *models.RabbitMQDestQuery) (*models.RabbitMQDestOptions, error)
}

type RabbitMQDestQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
    Records            []*Record
}

type RabbitMQDestQueryPayload struct {
    Headers      map[string]any
    ExchangeName string
    RoutingKey   string
    QueueName    string
    ContentType  string
    Expiration   string
    Body         []byte
    Mandatory    bool
    Immediate    bool
    DeliveryMode uint8 // forwarded as given; 0 is AMQP's non-persistent
    Priority     uint8
}

type RabbitMQDestOptions struct{}
```

Return one payload per message to publish. If `QueueName` is set and `ExchangeName` is empty, the queue name is used as the routing key on the default exchange. Otherwise `ExchangeName` and `RoutingKey` are used as given. The queue must already exist. `GenerateOptions` has no fields to set.

### Example Destination

```go
func (d *IUseConnector) GenerateQuery(param *models.RabbitMQDestQuery) ([]*models.RabbitMQDestQueryPayload, error) {
    out := make([]*models.RabbitMQDestQueryPayload, 0, len(param.Records))
    for _, r := range param.Records {
        body, err := json.Marshal(r.Data)
        if err != nil {
            return nil, err
        }
        out = append(out, &models.RabbitMQDestQueryPayload{
            QueueName:    "orders_out",
            ContentType:  "application/json",
            DeliveryMode: 2, // persistent
            Body:         body,
        })
    }
    return out, nil
}
```

## Connection Parameters

Set these on the hub (see [Connector Hub](./connector-hub#rabbitmq-connector)): host, port (default 5672), username, password, virtual host, and whether to use TLS.
