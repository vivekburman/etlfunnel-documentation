# Kafka

Apache Kafka serves as a message streaming component in ETL pipelines, functioning both as a source for consuming messages and a destination for publishing records. Our ETL tool provides comprehensive Kafka integration with consumer group subscription, manual partition assignment, and a user-defined capture mode for full control over message consumption.

## Source Operations

### Data Extraction Methods

The Kafka source interface supports three extraction approaches:

```go
type IClientDBKafkaSource interface {
    GenerateSubscription(param *models.KafkaSourceSubscribe) (*models.KafkaSourceSubscriptionOptions, error)
    GenerateAssignment(param *models.KafkaSourceAssign) (*models.KafkaSourceAssignmentOptions, error)
    FetchRecords(param *models.KafkaSourceFetch) <-chan *models.Record
}
```

- **Subscription** - Consumer group-based topic subscription; the broker assigns partitions and manages offsets
- **Assignment** - Manual partition assignment with explicit offset control
- **Record Fetching** - User-defined capture mode providing full control over message consumption

### Source Configuration Structure

```go
type KafkaSourceSubscribe struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type KafkaSourceAssign struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type KafkaSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       sarama.Client
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type KafkaSourceSubscriptionOptions struct {
    Topics            []string
    GroupID           string
    InitialOffset     int64 // sarama.OffsetNewest or sarama.OffsetOldest
    MaxWaitTime       time.Duration
    FetchMaxBytes     int32
    SessionTimeout    time.Duration
    HeartbeatInterval time.Duration
    CommitInterval    time.Duration
    AutoCommit        bool
    ParseFn           func(KafkaRawMessage) (map[string]any, error)
}

type KafkaSourceAssignmentOptions struct {
    Partitions    []KafkaTopicPartition
    MaxWaitTime   time.Duration
    FetchMaxBytes int32
    ParseFn       func(KafkaRawMessage) (map[string]any, error)
}

// KafkaTopicPartition identifies a specific topic partition and starting offset.
type KafkaTopicPartition struct {
    Topic     string
    Partition int32
    Offset    int64 // sarama.OffsetNewest (-1), sarama.OffsetOldest (-2), or a specific offset
}

// KafkaRawMessage carries the raw fields of a consumed Kafka message.
// Passed to ParseFn so the connector controls how message bytes become pipeline record fields.
type KafkaRawMessage struct {
    Value     []byte
    Key       []byte
    Topic     string
    Partition int32
    Offset    int64
    Headers   map[string][]byte
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source Connection** - Sarama client instance for Kafka consumption, available on `KafkaSourceFetch` (used by the user-defined capture mode)
- **Auxiliary DB Connections** - Additional database connections for enrichment
- **ParseFn** - Controls how raw Kafka message bytes become pipeline records; the engine never decides the record shape

### Example Source

```go
func (c *IUseConnector) GenerateSubscription(param *models.KafkaSourceSubscribe) (*models.KafkaSourceSubscriptionOptions, error) {
    return &models.KafkaSourceSubscriptionOptions{
        Topics:            []string{param.State.GetName()},
        GroupID:           "etl-consumer-group",
        InitialOffset:     sarama.OffsetOldest,
        MaxWaitTime:       250 * time.Millisecond,
        FetchMaxBytes:     1 * 1024 * 1024, // 1 MB
        SessionTimeout:    10 * time.Second,
        HeartbeatInterval: 3 * time.Second,
        CommitInterval:    1 * time.Second,
        AutoCommit:        true,
        ParseFn: func(msg models.KafkaRawMessage) (map[string]any, error) {
            var payload map[string]any
            if err := json.Unmarshal(msg.Value, &payload); err != nil {
                return nil, fmt.Errorf("unmarshal kafka message: %w", err)
            }
            payload["_kafka_key"]       = string(msg.Key)
            payload["_kafka_topic"]     = msg.Topic
            payload["_kafka_partition"] = msg.Partition
            payload["_kafka_offset"]    = msg.Offset
            return payload, nil
        },
    }, nil
}

func (c *IUseConnector) GenerateAssignment(param *models.KafkaSourceAssign) (*models.KafkaSourceAssignmentOptions, error) {
    return &models.KafkaSourceAssignmentOptions{
        Partitions: []models.KafkaTopicPartition{
            {Topic: param.State.GetName(), Partition: 0, Offset: sarama.OffsetOldest},
            {Topic: param.State.GetName(), Partition: 1, Offset: sarama.OffsetOldest},
        },
        MaxWaitTime:   500 * time.Millisecond,
        FetchMaxBytes: 512 * 1024,
        ParseFn: func(msg models.KafkaRawMessage) (map[string]any, error) {
            var payload map[string]any
            if err := json.Unmarshal(msg.Value, &payload); err != nil {
                return nil, fmt.Errorf("unmarshal kafka message: %w", err)
            }
            return payload, nil
        },
    }, nil
}

func (c *IUseConnector) FetchRecords(param *models.KafkaSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)
    close(ch) // not used when GenerateSubscription or GenerateAssignment is active
    return ch
}
```

## Destination Operations

### Data Publishing Capabilities

The Kafka destination interface provides message publishing operations:

```go
type IClientDBKafkaDest interface {
    GenerateQuery(param *models.KafkaDestQuery) ([]*models.KafkaDestQueryPayload, error)
    GenerateOptions(param *models.KafkaDestQuery) (*models.KafkaDestOptions, error)
}
```

This interface enables:

- **Per-record message tuning** - Topic, key, value, partition, and headers per message
- **Batch processing** - Receives a batch of records and returns one payload per message
- **Connector Options** - `GenerateOptions` returns a `KafkaDestOptions` value; Kafka currently defines no connector-wide settings, so this struct is empty

### Destination Configuration Structure

```go
// Destination operations
type KafkaDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type KafkaDestQueryPayload struct {
    Headers   []KafkaHeader
    Topic     string
    Key       []byte
    Value     []byte
    Partition int32 // -1 for partitioner-assigned
}

// KafkaDestOptions currently has no fields; Kafka has no connector-wide
// write settings, so GenerateOptions returns an empty struct.
type KafkaDestOptions struct{}

type KafkaHeader struct {
    Key   string
    Value []byte
}
```

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.KafkaDestQuery) ([]*models.KafkaDestQueryPayload, error) {
    payloads := make([]*models.KafkaDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        topic, _ := rec.Data["_kafka_topic"].(string)
        if topic == "" {
            topic = param.State.GetName()
        }

        key, _ := rec.Data["id"].(string)

        // Strip internal routing fields before serialising the value.
        payload := make(map[string]any, len(rec.Data))
        for k, v := range rec.Data {
            if len(k) > 0 && k[0] == '_' {
                continue
            }
            payload[k] = v
        }

        valueBytes, err := json.Marshal(payload)
        if err != nil {
            return nil, fmt.Errorf("marshal record: %w", err)
        }

        payloads = append(payloads, &models.KafkaDestQueryPayload{
            Topic:     topic,
            Key:       []byte(key),
            Value:     valueBytes,
            Partition: -1, // let the partitioner assign based on key
        })
    }

    return payloads, nil
}

func (c *IUseConnector) GenerateOptions(param *models.KafkaDestQuery) (*models.KafkaDestOptions, error) {
    // Kafka defines no connector-wide write settings today, so this is a no-op.
    return &models.KafkaDestOptions{}, nil
}
```

## Connection Casting

```go
// Cast IDatabaseEngine to Kafka sarama.Client
kafkaClient, err := CastAsKafkaConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Kafka connection: %v", err)
}

// kafkaClient is of type sarama.Client
```

:::tip Connection Casting
This automatically handles connection casting, allowing you to work with the generic database interface while maintaining access to Kafka-specific functionality when required.
:::
