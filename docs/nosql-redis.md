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
    FetchRecords(param *models.RedisSourceFetch) <-chan map[string]any
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
    PipelineName      string
    SourceDBConn      *redis.Client
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type RedisSourceKeyspace struct {
    PipelineName      string
    SourceDBConn      *redis.Client
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type RedisSourceStreams struct {
    PipelineName      string
    SourceDBConn      *redis.Client
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type RedisSourceKeysTune struct {
    SpecificKeyList []string
    KeyPatterns     []string
    ScanCount       int
}

type RedisSourceStreamsTune struct {
    StreamNames     []string
    ConsumerGroup   string
    ConsumerName    string
    SpecificStartId string
    StartFrom       string
    BatchSize       int
    BlockTime       int
    AutoAck         bool
    ClaimMinIdle    int
}

type RedisSourceKeySpacesTune struct {
    NotificationTypes []string
    KeyPatterns       []string
    Database          int
    SubscriptionMode  string
}
```

These structures provide:

- **Pipeline Name** - Unique identifier for the ETL operation
- **Source DB Connection** - Direct Redis client connection for data extraction
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations

### Example Source

```go
func (c *IUseConnector) GenerateKeys(param *models.RedisSourceKeys) (*models.RedisSourceKeysTune, error) {
    return &models.RedisSourceKeysTune{
        SpecificKeyList: []string{"user:*", "session:*"},
        KeyPatterns:     []string{"cache:*", "temp:*"},
        ScanCount:       100,
    }, nil
}

func (c *IUseConnector) GenerateStreams(param *models.RedisSourceStreams) (*models.RedisSourceStreamsTune, error) {
    return &models.RedisSourceStreamsTune{
        StreamNames:     []string{param.PipelineName + ":events"},
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
        NotificationTypes: []string{"KEA"}, // Keyspace, Keyevent, All operations
        KeyPatterns:       []string{"user:*", "session:*"},
        Database:          0,
        SubscriptionMode:  "keyspace",
    }, nil
}

func (c *IUseConnector) FetchRecords(param *models.RedisSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

    go func() {
        defer close(ch)
        ctx := context.Background()

        // Scan for keys matching pattern
        iter := param.SourceDBConn.Scan(ctx, 0, param.PipelineName+":*", 100).Iterator()
        for iter.Next(ctx) {
            key := iter.Val()
            val, err := param.SourceDBConn.Get(ctx, key).Result()
            if err != nil {
                log.Printf("Error getting key %s: %v", key, err)
                continue
            }

            record := map[string]any{
                "key":   key,
                "value": val,
                "type":  "string",
            }
            ch <- record
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
    GenerateQuery(param *models.RedisDestQuery) (*models.RedisDestQueryTune, error)
}
```

This interface enables:

- **Multiple Data Types** - Support for strings, hashes, lists, sets, and sorted sets
- **Expiration Management** - TTL settings for automatic data cleanup
- **Batch Processing** - Efficient handling of large record sets

### Destination Configuration Structure

When using Redis as a destination, the system uses this struct definition:

```go
// Destination operations
type RedisDestQuery struct {
    PipelineName      string
    Record            map[string]any
    SourceDBConn      IDatabaseEngine
    DestDBConn        *redis.Client
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type RedisDestQueryTune struct {
    Operation       string
    Key             string
    Value           any
    Expiration      time.Duration
    RecordsPerBatch int
}
```

This structure manages:

- **Pipeline Identification** - Links destination operations to specific ETL workflows
- **Record Processing** - Handles individual data records for transformation and loading
- **Connection Management** - Maintains source, destination, and auxiliary database connections
- **Operation Configuration** - Specifies Redis commands and parameters

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.RedisDestQuery) (*models.RedisDestQueryTune, error) {
    // Determine operation based on record structure
    operation := "SET"
    key := fmt.Sprintf("%s:%v", param.PipelineName, param.Record["id"])
    value := param.Record["data"]
    expiration := time.Duration(0)

    // Check if record specifies expiration
    if ttl, exists := param.Record["ttl"]; exists {
        if ttlInt, ok := ttl.(int); ok {
            expiration = time.Duration(ttlInt) * time.Second
        }
    }

    // Handle different data types
    if recordType, exists := param.Record["type"]; exists {
        switch recordType {
        case "hash":
            operation = "HSET"
        case "list":
            operation = "LPUSH"
        case "set":
            operation = "SADD"
        case "zset":
            operation = "ZADD"
        default:
            operation = "SET"
        }
    }

    return &models.RedisDestQueryTune{
        Operation:       operation,
        Key:             key,
        Value:           value,
        Expiration:      expiration,
        RecordsPerBatch: 100,
    }, nil
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