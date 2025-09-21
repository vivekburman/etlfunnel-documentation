# Postgres

PostgreSQL databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive PostgreSQL integration capabilities, supporting multiple data extraction methods including advanced features like WAL streaming and notification systems.

## Source Database Operations

PostgreSQL databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The PostgreSQL source interface supports four primary extraction approaches through these interface methods:

```go
type IClientDBPostgresSource interface {
    FetchRecords(param *models.PostgresSourceFetch) <-chan map[string]any
    GenerateQuery(param *models.PostgresSourceQuery) (*models.PostgresSourceQueryTune, error)
    GenerateNotification(param *models.PostgresSourceNotification) (*models.PostgresSourceNotificationTune, error)
    GenerateWAL(param *models.PostgresSourceWAL) (*models.PostgresSourceWALTune, error)
}
```

- **Record Fetching** - Provides full control over data reading, streaming records one at a time via channels
- **Query Generation** - Dynamic query construction for complex data transformations
- **Notification Processing** - Real-time event handling using PostgreSQL's LISTEN/NOTIFY functionality
- **WAL Streaming** - Write-Ahead Log based change data capture for real-time replication

### Source Configuration Structure

When configuring PostgreSQL as a source database, the system uses these struct definitions:

```go
// Source operations
type PostgresSourceFetch struct {
    PipelineName      string
    SourceDBConn      *pgx.Conn
    AuxilaryDBConnMap map[string]IDatabaseEngine
    DestDBConn        IDatabaseEngine
}

type PostgresSourceQuery struct {
    PipelineName      string
    SourceDBConn      *pgx.Conn
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type PostgresSourceNotification struct {
    PipelineName      string
    SourceDBConn      *pgx.Conn
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type PostgresSourceWAL struct {
    PipelineName      string
    SourceDBConn      *pgx.Conn
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type PostgresSourceQueryTune struct {
    Query string
}

type PostgresSourceNotificationTune struct {
    ChannelName string
}

type PostgresSourceWALTune struct {
    SlotName        string
    OutputPlugin    PostgresQueryOutputPluginType
    Streaming       bool
    PublicationName string
}

const (
	PostgresQueryTypePGOutput PostgresQueryOutputPluginType = "PG_OUTPUT"
	PostgresQueryTypeWAL2JSON PostgresQueryOutputPluginType = "WAL2JSON"
)

```

These structures provide:

- **Pipeline Name** - Unique identifier for the ETL operation
- **Source DB Connection** - Direct PostgreSQL connection instance using pgx driver
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **WAL Configuration** - Advanced replication settings with support for multiple output plugins
- **Notification Channels** - Real-time event processing capabilities

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *PostgresSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

    go func() {
        defer close(ch)

        rows, err := param.SourceDBConn.Query(context.Background(), 
            "SELECT id, name FROM " + param.PipelineName + " LIMIT 5")
        if err != nil {
            log.Println("query error:", err)
            return
        }
        defer rows.Close()

        for rows.Next() {
            record := map[string]any{}
            values, err := rows.Values()
            if err != nil {
                log.Println("values error:", err)
                continue
            }

            for i, col := range rows.FieldDescriptions() {
                record[col.Name] = values[i]
            }
            ch <- record
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *PostgresSourceQuery) (*PostgresSourceQueryTune, error) {
    query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.PipelineName)
    return &PostgresSourceQueryTune{Query: query}, nil
}

func (c *IUseConnector) GenerateNotification(param *PostgresSourceNotification) (*PostgresSourceNotificationTune, error) {
    channelName := fmt.Sprintf("%s_changes", param.PipelineName)
    return &PostgresSourceNotificationTune{
        ChannelName: channelName,
    }, nil
}

func (c *IUseConnector) GenerateWAL(param *PostgresSourceWAL) (*PostgresSourceWALTune, error) {
    slotName := fmt.Sprintf("%s_slot", param.PipelineName)
    publicationName := fmt.Sprintf("%s_pub", param.PipelineName)

    return &PostgresSourceWALTune{
        SlotName:        slotName,
        OutputPlugin:    models.PostgresQueryTypePGOutput,
        Streaming:       true,
        PublicationName: publicationName,
    }, nil
}
```

## Destination Database Operations

PostgreSQL databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The PostgreSQL destination interface provides structured data loading operations:

```go
type IClientDBPostgresDest interface {
    GenerateQuery(param *models.PostgresDestQuery) (*models.PostgresDestQueryTune, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and UPSERT operations with PostgreSQL-specific features
- **Batch Processing** - Efficient handling of large record sets with configurable batch sizes

### Destination Configuration Structure

When using PostgreSQL as a destination, the system uses these struct definitions:

```go
// Destination operations
type PostgresDestQuery struct {
    PipelineName      string
    Record            map[string]any
    SourceDBConn      IDatabaseEngine
    DestDBConn        *pgx.Conn
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type PostgresDestQueryTune struct {
    Query           string
    Value           []any
    RecordsPerBatch int
}
```

These structures manage:

- **Pipeline Identification** - Links destination operations to specific ETL workflows
- **Record Processing** - Handles individual data records for transformation and loading
- **Connection Management** - Maintains source, destination, and auxiliary database connections using pgx driver
- **Data Mapping** - Ensures proper field mapping between source and destination schemas
- **Batch Configuration** - Optimizes performance through configurable batch processing

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.PostgresDestQuery) (*models.PostgresDestQueryTune, error) {
    // Example: PostgreSQL UPSERT with ON CONFLICT
    columns := ""
    values := ""
    placeholders := ""
    args := []any{}

    i := 0
    for k, v := range param.Record {
        if i > 0 {
            columns += ", "
            values += ", "
            placeholders += ", "
        }
        columns += k
        values += fmt.Sprintf("$%d", i+1)
        placeholders += k
        args = append(args, v)
        i++
    }

    query := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s) 
        ON CONFLICT (id) DO UPDATE SET %s`,
        param.PipelineName, columns, values, placeholders)

    return &models.PostgresDestQueryTune{
        Query:           query,
        Value:           args,
        RecordsPerBatch: 1000, // PostgreSQL handles larger batches efficiently
    }, nil
}
```

## Database Connection Casting

### IDatabaseEngine Interface

The `IDatabaseEngine` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific PostgreSQL connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual PostgreSQL connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to PostgreSQL connection
pgConn, err := CastAsPostgresDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to PostgreSQL connection: %v", err)
}

// Now you can use the underlying PostgreSQL connection directly
// pgConn is of type *pgx.Conn
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid PostgreSQL connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to PostgreSQL-specific functionality including advanced features like WAL streaming and notification channels.
:::