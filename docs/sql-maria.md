# MariaDB

MariaDB databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive MariaDB integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

MariaDB databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The MariaDB source interface supports three primary extraction approaches through these interface methods:

```go
type IClientDBMariaSource interface {
    FetchRecords(param *models.MariaSourceFetch) <-chan map[string]any
    GenerateQuery(param *models.MariaSourceQuery) (*models.MariaSourceQueryTune, error)
    GenerateBinLog(param *models.MariaSourceBinlog) (*models.MariaSourceBinlogTune, error)
}
```

- **Record Fetching** - Provides full control over data reading, streaming records one at a time via channels
- **Query Generation** - Dynamic query construction for complex data transformations  
- **Binary Log Processing** - Real-time change data capture using MariaDB's binlog functionality

### Source Configuration Structure

When configuring MariaDB as a source database, the system uses these struct definitions:

```go
// Source operations
type MariaSourceFetch struct {
    PipelineName      string
    SourceDBConn      *client.Conn
    AuxilaryDBConnMap map[string]IDatabaseEngine
    DestDBConn        IDatabaseEngine
}

type MariaSourceQuery struct {
    PipelineName      string
    SourceDBConn      *client.Conn
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MariaSourceBinlog struct {
    PipelineName      string
    SourceDBConn      *client.Conn
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MariaSourceQueryTune struct {
    Query string
}

type MariaSourceBinlogTune struct {
    ServerID uint32
}
```

These structures provide:

- **Pipeline Name** - Unique identifier for the ETL operation
- **Source DB Connection** - Direct MariaDB connection instance for data extraction
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment

### Example Source
```go
func (c *IUseConnector) FetchRecords(param *MariaSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

    go func() {
        defer close(ch)

        rows, err := param.SourceDBConn.Query("SELECT id, name FROM " + param.Ctx.GetName() + " LIMIT 5")
        if err != nil {
            log.Println("query error:", err)
            return
        }
        defer rows.Close()

        cols, _ := rows.Columns()
        for rows.Next() {
            // create a slice of interface{} to hold each column value
            vals := make([]any, len(cols))
            ptrs := make([]any, len(cols))
            for i := range vals {
                ptrs[i] = &vals[i]
            }

            if err := rows.Scan(ptrs...); err != nil {
                log.Println("scan error:", err)
                continue
            }

            // map column names to values
            record := map[string]any{}
            for i, col := range cols {
                record[col] = vals[i]
            }
            ch <- record
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *MariaSourceQuery) (*MariaSourceQueryTune, error) {
    query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.Ctx.GetName())
    return &MariaSourceQueryTune{Query: query}, nil
}

func (c *IUseConnector) GenerateBinLog(param *MariaSourceBinlog) (*MariaSourceBinlogTune, error) {
    // To establish a replication connection with a unique server ID.
    // Here we mock with a static server ID for simplicity.
    return &MariaSourceBinlogTune{
        ServerID: 1234, // unique replication client ID
    }, nil
}
```

## Destination Database Operations

MariaDB databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The MariaDB destination interface provides structured data loading operations:

```go
type IClientDBMariaDest interface {
    GenerateQuery(param *models.MariaDestQuery) (*models.MariaDestQueryTune, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and UPSERT operations
- **Batch Processing** - Efficient handling of large record sets

### Destination Configuration Structure

When using MariaDB as a destination, the system uses this struct definition:

```go
// Destination operations
type MariaDestQuery struct {
    PipelineName      string
    Record            map[string]any
    SourceDBConn      IDatabaseEngine
    DestDBConn        *client.Conn
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MariaDestQueryTune struct {
    Query           string
    Value           []any
    RecordsPerBatch int
}
```

This structure manages:

- **Pipeline Identification** - Links destination operations to specific ETL workflows
- **Record Processing** - Handles individual data records for transformation and loading
- **Connection Management** - Maintains source, destination, and auxiliary database connections
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination
```go
func (c *IUseConnector) GenerateQuery(param *models.MariaDestQuery) (*models.MariaDestQueryTune, error) {
    // Example: simple INSERT query generator
    columns := ""
    values := ""
    args := []any{}

    i := 0
    for k, v := range param.Record {
        if i > 0 {
            columns += ", "
            values += ", "
        }
        columns += k
        values += "?"
        args = append(args, v)
        i++
    }

    query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
        param.Ctx.GetName(), columns, values)

    return &models.MariaDestQueryTune{
        Query:           query,
        Value:           args,
        RecordsPerBatch: 100, // Example batch size
    }, nil
}
```

## Database Connection Casting

### IDatabaseEngine Interface

The `IDatabaseEngine` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific MariaDB connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual MariaDB connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to MariaDB connection
mariaConn, err := CastAsMariaDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to MariaDB connection: %v", err)
}

// Now you can use the underlying MariaDB connection directly
// mariaConn is of type *client.Conn
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid MariaDB connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to MariaDB-specific functionality when required.
:::