# MongoDB

MongoDB databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive MongoDB integration capabilities, supporting multiple data extraction methods including change streams, oplog tailing, and efficient BSON document operations.

## Source Database Operations

MongoDB databases can serve as data sources using several extraction methods, each optimized for different use cases and real-time data requirements.

### Data Extraction Methods

The MongoDB source interface supports four primary extraction approaches through these interface methods:

```go
type IClientDBMongoSource interface {
    GenerateQuery(param *models.MongoSourceQuery) (*models.MongoSourceQueryOptions, error)
    GenerateStream(param *models.MongoSourceStreams) (*models.MongoStreamsOptions, error)
    GenerateOplogTrailing(param *models.MongoSourceOplog) (*models.MongoSourceOplogOptions, error)
    FetchRecords(param *models.MongoSourceFetch) <-chan *models.Record
}
```

- **Query Generation** - BSON-based aggregation pipeline construction for complex data transformations
- **Change Streams** - Real-time data change monitoring without manually tailing the oplog
- **Oplog Tailing** - Low-level oplog access for database recovery and historical data restoration
- **Record Fetching** - Streaming BSON documents one at a time via channels for controlled data processing

### Source Configuration Structure

When configuring MongoDB as a source database, the system uses these struct definitions:

```go
// Source operations
type MongoSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *mongo.Client
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MongoSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MongoSourceStreams struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MongoSourceOplog struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MongoSourceQueryOptions struct {
    CommandDoc bson.D
}

type MongoStreamsOptions struct {
    Collection          string
    ChangeStreamOptions options.ChangeStreamOptionsBuilder
    Pipeline            []bson.M
}

type MongoSourceOplogOptions struct {
    Collection string
    Filter     bson.M
    Options    options.FindOptionsBuilder
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - MongoDB client instance for document extraction, available on `MongoSourceFetch` (used by the user-defined capture mode)
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **BSON Command Documents** - Native MongoDB query format for flexible document operations
- **Collection** - `MongoStreamsOptions` and `MongoSourceOplogOptions` each carry the target collection name alongside their filter/pipeline

### Example Source Implementation

```go
func (c *IUseConnector) FetchRecords(param *models.MongoSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        collection := param.SourceDBConn.Database("etl").Collection(param.State.GetName())
        cursor, err := collection.Find(context.TODO(), bson.M{}, options.Find().SetLimit(5))
        if err != nil {
            log.Println("find error:", err)
            return
        }
        defer cursor.Close(context.TODO())

        for cursor.Next(context.TODO()) {
            var document bson.M
            if err := cursor.Decode(&document); err != nil {
                log.Println("decode error:", err)
                continue
            }
            ch <- &models.Record{Data: document}
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.MongoSourceQuery) (*models.MongoSourceQueryOptions, error) {
    pipeline := bson.D{
        {"$match", bson.M{"status": "active"}},
        {"$sort", bson.M{"created_at": -1}},
        {"$limit", 10},
    }
    return &models.MongoSourceQueryOptions{CommandDoc: pipeline}, nil
}

func (c *IUseConnector) GenerateStream(param *models.MongoSourceStreams) (*models.MongoStreamsOptions, error) {
    pipeline := []bson.M{
        {"$match", bson.M{"operationType": bson.M{"$in": []string{"insert", "update"}}}},
    }

    opts := options.ChangeStream().
        SetFullDocument("updateLookup").
        SetBatchSize(100)

    return &models.MongoStreamsOptions{
        Collection:          param.State.GetName(),
        ChangeStreamOptions: *opts,
        Pipeline:            pipeline,
    }, nil
}

func (c *IUseConnector) GenerateOplogTrailing(param *models.MongoSourceOplog) (*models.MongoSourceOplogOptions, error) {
    filter := bson.M{
        "ts": bson.M{"$gte": time.Now().Add(-1 * time.Hour)},
        "ns": bson.M{"$regex": "^etl\\." + param.State.GetName()},
    }

    opts := options.Find().
        SetSort(bson.M{"$natural": 1}).
        SetNoCursorTimeout(true)

    return &models.MongoSourceOplogOptions{
        Collection: param.State.GetName(),
        Filter:     filter,
        Options:    *opts,
    }, nil
}
```

## Destination Database Operations

MongoDB databases function as destinations for processed data, supporting flexible document insertion, updates, and bulk operations with various write strategies.

### Data Loading Capabilities

The MongoDB destination interface provides structured document loading operations:

```go
type IClientDBMongoDest interface {
    GenerateQuery(param *models.MongoDestQuery) ([]*models.MongoDestQueryPayload, error)
    GenerateOptions(param *models.MongoDestQuery) (*models.MongoDestOptions, error)
}
```

This interface enables:

- **Document Operations** - INSERT_ONE, INSERT_MANY, UPDATE_ONE, UPDATE_MANY operations
- **Advanced Operations** - REPLACE_ONE, DELETE_ONE, DELETE_MANY operations  
- **Bulk Processing** - BULK_WRITE operations for efficient batch processing
- **Flexible Write Options** - Upsert, hints, sort, array filters, and collation per payload
- **Per-Collection Bulk Settings** - `GenerateOptions` returns write concern, ordering, and validation-bypass settings that can differ per collection

### Write Operation Types

The system supports comprehensive MongoDB write operations:

```go
const (
    MongoWriteInsertOne  MongoWriteOperationType = "INSERT_ONE"
    MongoWriteInsertMany MongoWriteOperationType = "INSERT_MANY"
    MongoWriteUpdateOne  MongoWriteOperationType = "UPDATE_ONE"
    MongoWriteUpdateMany MongoWriteOperationType = "UPDATE_MANY"
    MongoWriteReplaceOne MongoWriteOperationType = "REPLACE_ONE"
    MongoWriteDeleteOne  MongoWriteOperationType = "DELETE_ONE"
    MongoWriteDeleteMany MongoWriteOperationType = "DELETE_MANY"
    MongoWriteBulkWrite  MongoWriteOperationType = "BULK_WRITE"
)

// MongoBulkCallSettings groups the bulk-write call options that apply to a
// whole flush, as opposed to a single payload.
type MongoBulkCallSettings struct {
    Ordered          bool                       // always applied explicitly via opts.SetOrdered(Ordered); the Go zero value false is used literally — this differs from the MongoDB driver's own BulkWrite default of true, since this app always sets it rather than leaving it unset
    BypassValidation bool                       // always applied explicitly via opts.SetBypassDocumentValidation(BypassValidation); zero value false
    WriteConcern     *writeconcern.WriteConcern // only applied when non-nil; nil (the zero value) means the collection's inherited write concern is used
    Comment          any                        // only set on the call when non-nil
    Let              any                        // only set on the call when non-nil
}

// MongoDestOptions is returned by GenerateOptions. Default applies to every
// collection unless overridden by a matching entry in PerCollection.
type MongoDestOptions struct {
    Default       MongoBulkCallSettings
    PerCollection map[string]MongoBulkCallSettings
}
```

### Destination Configuration Structure

When using MongoDB as a destination, the system uses this struct definition:

```go
// Destination operations
type MongoDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MongoDestQueryPayload struct {
    Collection   string
    Query        any // filter document (e.g. bson.M{"_id": id})
    Payload      any // document to write or update
    Operation    MongoWriteOperationType
    Hint         any
    Sort         any
    ArrayFilters []any
    Upsert       bool
    Collation    *options.Collation
}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` values (each with a `Data` map and a `Meta` map) for transformation and loading
- **Connection Management** - Maintains auxiliary database connections for lookups; the destination MongoDB connection itself is managed internally and is not passed through this struct
- **Operation Configuration** - Specifies write operation type, target collection, and associated per-payload options

:::note `Ordered` default differs from the MongoDB driver
Leaving `MongoBulkCallSettings.Ordered` unset resolves to the Go zero value `false`, because it's always applied explicitly via `SetOrdered`. This is the opposite of the MongoDB driver's own `BulkWrite` default, which is `true` when the option is left unset entirely. If you want ordered bulk writes, set `Ordered: true` explicitly.
:::

### Example Destination Implementation

```go
func (c *IUseConnector) GenerateQuery(param *models.MongoDestQuery) ([]*models.MongoDestQueryPayload, error) {
    payloads := make([]*models.MongoDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        document := bson.M{}
        for k, v := range rec.Data {
            document[k] = v
        }

        filter := bson.M{}
        if id, exists := document["_id"]; exists {
            filter["_id"] = id
            delete(document, "_id")
        }

        payloads = append(payloads, &models.MongoDestQueryPayload{
            Collection: param.State.GetName(),
            Operation:  models.MongoWriteUpdateOne,
            Query:      filter,
            Payload:    bson.M{"$set": document},
            Upsert:     true,
        })
    }

    return payloads, nil
}

func (c *IUseConnector) GenerateOptions(param *models.MongoDestQuery) (*models.MongoDestOptions, error) {
    return &models.MongoDestOptions{
        // Applies to every collection this connector writes to unless a
        // PerCollection entry overrides it.
        Default: models.MongoBulkCallSettings{
            Ordered:      true,
            WriteConcern: writeconcern.W1(),
        },
    }, nil
}
```

## Database Connection Casting

### IDatabaseEngine Interface

The `IDatabaseEngine` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety for MongoDB-specific operations.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific MongoDB client connections when needed. This allows developers to:

- **Access Native Client** - Retrieve the actual MongoDB client instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to MongoDB client
mongoClient, err := CastAsMongoDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to MongoDB connection: %v", err)
}

// Now you can use the native MongoDB client directly
// mongoClient is of type *mongo.Client
collection := mongoClient.Database("etl").Collection("documents")
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid MongoDB client
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to MongoDB-specific functionality when required.
:::
