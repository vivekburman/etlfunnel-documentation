# MongoDB

MongoDB databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive MongoDB integration capabilities, supporting multiple data extraction methods including change streams, oplog tailing, and efficient BSON document operations.

## Source Database Operations

MongoDB databases can serve as data sources using several extraction methods, each optimized for different use cases and real-time data requirements.

### Data Extraction Methods

The MongoDB source interface supports four primary extraction approaches through these interface methods:

```go
type IClientDBMongoSource interface {
    GenerateQuery(param *models.MongoSourceQuery) (*models.MongoSourceQueryTune, error)
    GenerateStream(param *models.MongoSourceStreams) (*models.MongoStreamsTune, error)
    GenerateOplogTrailing(param *models.MongoSourceOplog) (*models.MongoSourceOplogTune, error)
    FetchRecords(param *models.MongoSourceFetch) <-chan map[string]any
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
    PipelineName      string
    SourceDBConn      *mongo.Client
    AuxilaryDBConnMap map[string]IDatabaseEngine
    DestDBConn        IDatabaseEngine
}

type MongoSourceQuery struct {
    PipelineName      string
    SourceDBConn      *mongo.Client
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MongoSourceStreams struct {
    PipelineName      string
    SourceDBConn      *mongo.Client
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MongoSourceOplog struct {
    PipelineName      string
    SourceDBConn      *mongo.Client
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MongoSourceQueryTune struct {
    CommandDoc bson.D
}

type MongoStreamsTune struct {
    ChangeStreamOptions options.ChangeStreamOptionsBuilder
    Pipeline            []bson.M
}

type MongoSourceOplogTune struct {
    Filter  bson.M
    Options options.FindOptionsBuilder
}
```

These structures provide:

- **Pipeline Name** - Unique identifier for the ETL operation, typically corresponding to collection name
- **Source DB Connection** - MongoDB client instance for document extraction
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **BSON Command Documents** - Native MongoDB query format for flexible document operations

### Example Source Implementation

```go
func (c *IUseConnector) FetchRecords(param *MongoSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

    go func() {
        defer close(ch)

        collection := param.SourceDBConn.Database("etl").Collection(param.Ctx.GetName())
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
            ch <- document
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *MongoSourceQuery) (*MongoSourceQueryTune, error) {
    // Example aggregation pipeline to get recent documents
    pipeline := bson.D{
        {"$match", bson.M{"status": "active"}},
        {"$sort", bson.M{"created_at": -1}},
        {"$limit", 10},
    }
    return &MongoSourceQueryTune{CommandDoc: pipeline}, nil
}

func (c *IUseConnector) GenerateStream(param *MongoSourceStreams) (*MongoStreamsTune, error) {
    // Configure change stream with filters
    pipeline := []bson.M{
        {"$match", bson.M{"operationType": bson.M{"$in": []string{"insert", "update"}}}},
    }
    
    options := options.ChangeStream().
        SetFullDocument("updateLookup").
        SetBatchSize(100)
    
    return &MongoStreamsTune{
        ChangeStreamOptions: *options,
        Pipeline:           pipeline,
    }, nil
}

func (c *IUseConnector) GenerateOplogTrailing(param *MongoSourceOplog) (*MongoSourceOplogTune, error) {
    // Configure oplog tailing with timestamp filter
    filter := bson.M{
        "ts": bson.M{"$gte": time.Now().Add(-1 * time.Hour)},
        "ns": bson.M{"$regex": "^etl\\." + param.Ctx.GetName()},
    }
    
    options := options.Find().
        SetSort(bson.M{"$natural": 1}).
        SetNoCursorTimeout(true)
    
    return &MongoSourceOplogTune{
        Filter:  filter,
        Options: *options,
    }, nil
}
```

## Destination Database Operations

MongoDB databases function as destinations for processed data, supporting flexible document insertion, updates, and bulk operations with various write strategies.

### Data Loading Capabilities

The MongoDB destination interface provides structured document loading operations:

```go
type IClientDBMongoDest interface {
    GenerateQuery(param *models.MongoDestQuery) (*models.MongoDestQueryTune, error)
}
```

This interface enables:

- **Document Operations** - INSERT_ONE, INSERT_MANY, UPDATE_ONE, UPDATE_MANY operations
- **Advanced Operations** - REPLACE_ONE, DELETE_ONE, DELETE_MANY operations  
- **Bulk Processing** - BULK_WRITE operations for efficient batch processing
- **Flexible Write Options** - Upsert, write concern, and validation bypass capabilities

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

type MongoDBWriteOptions struct {
    Upsert           bool
    WriteConcern     *writeconcern.WriteConcern
    Ordered          bool
    BypassValidation bool
    Comment          any
    ArrayFilters     []any
    Hint             any
    Sort             any
    Let              any
    Collation        *options.Collation
}
```

### Destination Configuration Structure

When using MongoDB as a destination, the system uses this struct definition:

```go
// Destination operations
type MongoDestQuery struct {
    PipelineName      string
    Record            map[string]any
    SourceDBConn      IDatabaseEngine
    DestDBConn        *mongo.Client
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MongoDestQueryTune struct {
    Operation        MongoWriteOperationType
    Filter           bson.M
    Document         bson.M
    Options          MongoDBWriteOptions
    RecordsPerBatch  int
}
```

This structure manages:

- **Pipeline Identification** - Links destination operations to specific ETL workflows
- **Document Processing** - Handles BSON document records for transformation and loading
- **Connection Management** - Maintains source, destination, and auxiliary database connections
- **Operation Configuration** - Specifies write operation type and associated options

### Example Destination Implementation

```go
func (c *IUseConnector) GenerateQuery(param *models.MongoDestQuery) (*models.MongoDestQueryTune, error) {
    // Convert map[string]any to bson.M for MongoDB operations
    document := bson.M{}
    for k, v := range param.Record {
        document[k] = v
    }

    // Example: INSERT_ONE operation with upsert capability
    options := MongoDBWriteOptions{
        Upsert:           true,
        WriteConcern:     writeconcern.W1(),
        BypassValidation: false,
        Ordered:          true,
    }

    // Use _id field for upsert filter if present
    filter := bson.M{}
    if id, exists := document["_id"]; exists {
        filter["_id"] = id
        delete(document, "_id") // Remove from update document
    }

    return &models.MongoDestQueryTune{
        Operation:       MongoWriteInsertOne,
        Filter:          filter,
        Document:        document,
        Options:         options,
        RecordsPerBatch: 100,
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