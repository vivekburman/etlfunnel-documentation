# Redis

Redis databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive Redis integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

Redis databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The Redis source interface supports four primary extraction approaches through these interface methods:

```go
type IClientDBRedisSource interface {
    GenerateKeys(param *models.RedisSourceKeys) (*models.RedisSourceKeysTune, error)
    GenerateStreams(param *models.RedisSourceStreams) (*models.RedisSourceStreamsTune, error)
    GenerateKeyspace(param *models.RedisSourceKeyspace) (*models.RedisSourceKeySpacesTune, error)
    FetchRecords(param *models.RedisSourceFetch) <-chan *models.Record
}
```

- **Key Generation** - Targets specific keys using patterns or explicit lists for batch extraction
- **Stream Processing** - Real-time data capture using Redis Streams with consumer groups
- **Keyspace Notifications** - Event-driven extraction based on key modifications
- **Record Fetching** - Direct data reading with streaming capabilities

### Source Configuration Structure

When configuring Redis as a source database, the system uses these struct definitions:

```go
// Source operations
type RedisSourceKeys struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type RedisSourceKeyspace struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type RedisSourceStreams struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type RedisSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *redis.Client
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

// RedisRawValue carries a raw value read from a Redis key.
type RedisRawValue struct {
    Value    any
    Key      string
    DataType RedisDataType
    TTL      time.Duration
}

// RedisRawKeySpaceEvent carries a keyspace notification event.
type RedisRawKeySpaceEvent struct {
    Pattern string
    Channel string
    Event   string
    Key     string
}

type RedisSourceKeysTune struct {
    ParseFn         func(RedisRawValue) (map[string]any, error)
    SpecificKeyList []string
    KeyPatterns     []string
    ScanCount       int
}

type RedisSourceStreamsTune struct {
    ConsumerGroup   string
    ConsumerName    string
    SpecificStartId string
    StartFrom       string
    StreamNames     []string
    BatchSize       int
    BlockTime       int
    ClaimMinIdle    int
    AutoAck         bool
}

type RedisSourceKeySpacesTune struct {
    ParseFn           func(RedisRawKeySpaceEvent) (map[string]any, error)
    NotificationTypes []string
    KeyPatterns       []string
    SubscriptionMode  RedisSubscriptionMode
    Database          int
}

type RedisSubscriptionMode string

const (
    RedisSubscriptionModeKeyspace RedisSubscriptionMode = "keyspace"
    RedisSubscriptionModeKeyevent RedisSubscriptionMode = "keyevent"
    RedisSubscriptionModeBoth     RedisSubscriptionMode = "both"
)
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct Redis client connection for data extraction, available on `RedisSourceFetch` (used by the user-defined capture mode)
- **Auxiliary DB Connections** - Additional database connections for lookup operations
- **Keys ParseFn** - Controls how raw Redis key values are shaped into pipeline records
- **Keyspace ParseFn** - Controls how raw keyspace notification events are shaped into pipeline records

### Example Source

```go
func (c *IUseConnector) GenerateKeys(param *models.RedisSourceKeys) (*models.RedisSourceKeysTune, error) {
    return &models.RedisSourceKeysTune{
        SpecificKeyList: []string{"user:*", "session:*"},
        KeyPatterns:     []string{"cache:*", "temp:*"},
        ScanCount:       100,
        ParseFn: func(rv models.RedisRawValue) (map[string]any, error) {
            return map[string]any{
                "key":      rv.Key,
                "value":    rv.Value,
                "type":     string(rv.DataType),
                "ttl_secs": int64(rv.TTL.Seconds()),
            }, nil
        },
    }, nil
}

func (c *IUseConnector) GenerateStreams(param *models.RedisSourceStreams) (*models.RedisSourceStreamsTune, error) {
    return &models.RedisSourceStreamsTune{
        StreamNames:     []string{param.State.GetName() + ":events"},
        ConsumerGroup:   "etl-group",
        ConsumerName:    "etl-consumer-1",
        SpecificStartId: "0",
        StartFrom:       ">",
        BatchSize:       50,
        BlockTime:       1000,
        AutoAck:         false,
        ClaimMinIdle:    60000,
    }, nil
}

func (c *IUseConnector) GenerateKeyspace(param *models.RedisSourceKeyspace) (*models.RedisSourceKeySpacesTune, error) {
    return &models.RedisSourceKeySpacesTune{
        NotificationTypes: []string{"KEA"},
        KeyPatterns:       []string{"user:*", "session:*"},
        Database:          0,
        SubscriptionMode:  models.RedisSubscriptionModeKeyspace,
        ParseFn: func(event models.RedisRawKeySpaceEvent) (map[string]any, error) {
            return map[string]any{
                "key":     event.Key,
                "event":   event.Event,
                "channel": event.Channel,
            }, nil
        },
    }, nil
}

func (c *IUseConnector) FetchRecords(param *models.RedisSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)
        ctx := context.Background()

        iter := param.SourceDBConn.Scan(ctx, 0, param.State.GetName()+":*", 100).Iterator()
        for iter.Next(ctx) {
            key := iter.Val()
            val, err := param.SourceDBConn.Get(ctx, key).Result()
            if err != nil {
                log.Printf("Error getting key %s: %v", key, err)
                continue
            }

            ch <- &models.Record{
                Data: map[string]any{
                    "key":   key,
                    "value": val,
                },
            }
        }

        if err := iter.Err(); err != nil {
            log.Printf("Scan error: %v", err)
        }
    }()

    return ch
}
```

## Destination Database Operations

Redis databases can also function as destinations for processed data, supporting efficient data loading and various Redis data structures.

### Data Loading Capabilities

The Redis destination interface provides structured data loading operations:

```go
type IClientDBRedisDest interface {
    GenerateQuery(param *models.RedisDestQuery) ([]*models.RedisDestQueryPayload, error)
    GenerateOptions(param *models.RedisDestQuery) (*models.RedisDestOptions, error)
}
```

This interface enables:

- **Multiple Data Types** - Support for strings, hashes, lists, sets, sorted sets, and streams
- **Expiration Management** - TTL settings for automatic data cleanup
- **Batch Processing** - Receives a batch of records and returns one query payload per record
- **Connector Options** - `GenerateOptions` returns a `RedisDestOptions` value; Redis currently defines no connector-wide settings, so this struct is empty

### Destination Configuration Structure

When using Redis as a destination, the system uses this struct definition:

```go
// Destination operations
type RedisDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type RedisDestQueryPayload struct {
    Value      any
    Operation  RedisDestOperation
    Key        string
    Expiration time.Duration
    MaxLen     int64
    Approx     bool
}

// RedisDestOptions currently has no fields; Redis has no connector-wide
// write settings, so GenerateOptions returns an empty struct.
type RedisDestOptions struct{}

type RedisDestOperation string

const (
    RedisDestOpSet    RedisDestOperation = "SET"
    RedisDestOpHSet   RedisDestOperation = "HSET"
    RedisDestOpSAdd   RedisDestOperation = "SADD"
    RedisDestOpLPush  RedisDestOperation = "LPUSH"
    RedisDestOpRPush  RedisDestOperation = "RPUSH"
    RedisDestOpZAdd   RedisDestOperation = "ZADD"
    RedisDestOpIncr   RedisDestOperation = "INCR"
    RedisDestOpDecr   RedisDestOperation = "DECR"
    RedisDestOpExpire RedisDestOperation = "EXPIRE"
    RedisDestOpXAdd   RedisDestOperation = "XADD"
)
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` values (each with a `Data` map and a `Meta` map) for transformation and loading
- **Connection Management** - Maintains auxiliary database connections for lookups; the destination Redis connection itself is managed internally and is not passed through this struct
- **Operation Configuration** - Specifies typed Redis commands and parameters

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.RedisDestQuery) ([]*models.RedisDestQueryPayload, error) {
    payloads := make([]*models.RedisDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        key := fmt.Sprintf("%s:%v", param.State.GetName(), rec.Data["id"])
        expiration := time.Duration(0)

        if ttl, exists := rec.Data["ttl"]; exists {
            if ttlInt, ok := ttl.(int); ok {
                expiration = time.Duration(ttlInt) * time.Second
            }
        }

        op := models.RedisDestOpSet
        if recordType, exists := rec.Data["type"]; exists {
            switch recordType {
            case "hash":
                op = models.RedisDestOpHSet
            case "list":
                op = models.RedisDestOpLPush
            case "set":
                op = models.RedisDestOpSAdd
            case "zset":
                op = models.RedisDestOpZAdd
            }
        }

        payloads = append(payloads, &models.RedisDestQueryPayload{
            Operation:  op,
            Key:        key,
            Value:      rec.Data["data"],
            Expiration: expiration,
        })
    }

    return payloads, nil
}

func (c *IUseConnector) GenerateOptions(param *models.RedisDestQuery) (*models.RedisDestOptions, error) {
    // Redis defines no connector-wide write settings today, so this is a no-op.
    return &models.RedisDestOptions{}, nil
}
```

## Database Connection Casting

### IDatabaseEngine Interface

The `IDatabaseEngine` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific Redis connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual Redis client instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to Redis connection
redisConn, err := CastAsRedisDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Redis connection: %v", err)
}

// Now you can use the underlying Redis connection directly
// redisConn is of type *redis.Client
ctx := context.Background()
pong, err := redisConn.Ping(ctx).Result()
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid Redis connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to Redis-specific functionality when required.
:::
