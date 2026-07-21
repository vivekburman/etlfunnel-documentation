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
    InitialOffset     int64         // sarama.OffsetNewest or sarama.OffsetOldest — no app default; set unconditionally, so the zero value 0 is used as a literal offset, NOT sarama's own default of OffsetNewest
    MaxWaitTime       time.Duration // <= 0 leaves sarama's built-in default (250ms); only overridden when > 0
    FetchMaxBytes     int32         // <= 0 leaves sarama's built-in default (unlimited, 0); only overridden when > 0
    SessionTimeout    time.Duration // <= 0 leaves sarama's built-in default (10s); only overridden when > 0
    HeartbeatInterval time.Duration // <= 0 leaves sarama's built-in default (3s); only overridden when > 0
    RebalanceTimeout  time.Duration // <= 0 leaves sarama's built-in default (60s); only overridden when > 0. Also bounds (at 80%) how long a forced destination flush may run before a partition revocation completes
    ParseFn           func(KafkaRawMessage) (map[string]any, error)
}

type KafkaSourceAssignmentOptions struct {
    Partitions []KafkaTopicPartition
    ParseFn    func(KafkaRawMessage) (map[string]any, error)
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

:::note Defaults on `KafkaSourceSubscriptionOptions`
Leaving `MaxWaitTime`, `FetchMaxBytes`, `SessionTimeout`, `HeartbeatInterval`, or `RebalanceTimeout` at `<= 0` (including the zero value) leaves sarama's own built-in default in place — respectively `250ms`, unlimited (`0`), `10s`, `3s`, and `60s`. `InitialOffset` has no such fallback: it's set unconditionally, so a literal `0` is used as-is rather than falling back to `sarama.OffsetNewest`. `KafkaSourceAssignmentOptions` has no `MaxWaitTime`/`FetchMaxBytes` equivalents — manual partition assignment always reuses the existing client's configuration.
:::

:::note Offsets commit only once the destination confirms durability
Sarama's own auto-commit timer is disabled entirely — there is no `CommitInterval` to configure. Instead, offsets are marked and committed from the pipeline's commit hook, only after a batch has been confirmed durably written to the destination. Messages that never become a record (`ParseFn` nil or erroring) are marked immediately, since there's nothing durable to lose by skipping them and leaving them unmarked would stall the partition on a poison message forever.

On a consumer-group rebalance, the source forces a synchronous flush of whatever the destination is still holding for the ending session before its partitions are revoked, so those offsets land while they're still valid to commit. That forced flush is bounded by `RebalanceTimeout` (at 80% of it, leaving headroom for the rest of the rebalance protocol): if nothing answers in time, the source logs a warning and lets the revocation proceed anyway, accepting a bounded duplicate-delivery window rather than risking this member getting kicked from the group.
:::

### Record Position Metadata

Both `GenerateSubscription` and `GenerateAssignment` reads stamp each delivered record's `Meta` with the originating message's full identity — you don't need to copy these into `Data` yourself the way the example below does; that copy is for consumers that only ever look at `Data`, and is redundant with what's already on `Meta`:

| Key | Constant | Description |
|-----|----------|--------------|
| `_kafka_key` | `models.MetaKafkaKey` | The message key |
| `_kafka_topic` | `models.MetaKafkaTopic` | The originating topic |
| `_kafka_partition` | `models.MetaKafkaPartition` | The originating partition |
| `_kafka_offset` | `models.MetaKafkaOffset` | The message offset — this is what the pipeline's commit hook actually marks and commits; nothing else on the record is read for that purpose |

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
        RebalanceTimeout:  60 * time.Second,
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

- **Per-record message tuning** - Topic, key, value, and headers per message
- **Batch processing** - Receives a batch of records and returns one payload per message
- **Connector Options** - `GenerateOptions` returns a `KafkaDestOptions` value; Kafka currently defines no connector-wide settings, so this struct is empty

There is no per-payload `Partition` field — every message is sent through sarama's configured partitioner (by default, hash-of-key when `Key` is set, otherwise round-robin), so a specific partition cannot be pinned per record.

### Destination Configuration Structure

```go
// Destination operations
type KafkaDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type KafkaDestQueryPayload struct {
    Headers []KafkaHeader
    Topic   string
    Key     []byte
    Value   []byte
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
            Topic: topic,
            Key:   []byte(key),
            Value: valueBytes,
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
