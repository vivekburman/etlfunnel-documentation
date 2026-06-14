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
    State              IPipelineRuntimeState
    SourceDBConn       *client.Conn
    AuxiliaryDBConnMap map[string]IDatabaseEngine
    DestDBConn         IDatabaseEngine
}

type MariaSourceQuery struct {
    State              IPipelineRuntimeState
    SourceDBConn       *client.Conn
    AuxiliaryDBConnMap map[string]IDatabaseEngine
    DestDBConn         IDatabaseEngine
}

type MariaSourceBinlog struct {
    State              IPipelineRuntimeState
    SourceDBConn       *client.Conn
    DestDBConn         IDatabaseEngine
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MariaSourceQueryTune struct {
    Query string
}

type MariaSourceBinlogTune struct {
    ParseFn  func(ChangeEvent) (map[string]any, error)
    ServerID uint32
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct MariaDB connection instance for data extraction
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **BinLog ParseFn** - Controls how raw change events are shaped into pipeline records

### ChangeEvent

`ChangeEvent` is the typed value the engine passes to the `ParseFn` of any CDC or replication-based source tune. All fields are populated by the engine before your function is called.

```go
type ChangeEvent struct {
    Before    map[string]any
    After     map[string]any
    Meta      map[string]any
    Operation ChangeEventOperation
    Database  string
    Table     string
    Position  string // LSN for Postgres/MSSQL · GTID for MySQL/MariaDB · SCN for Oracle
}

type ChangeEventOperation string

const (
    ChangeEventOpInsert ChangeEventOperation = "INSERT"
    ChangeEventOpUpdate ChangeEventOperation = "UPDATE"
    ChangeEventOpDelete ChangeEventOperation = "DELETE"
    ChangeEventOpDDL    ChangeEventOperation = "DDL"
)
```

| Field | Description |
|-------|-------------|
| `Before` | Row state before the change. Set for `UPDATE` and `DELETE`; `nil` for `INSERT` and `DDL`. |
| `After` | Row state after the change. Set for `INSERT` and `UPDATE`; `nil` for `DELETE` and `DDL`. |
| `Operation` | Change type: `INSERT`, `UPDATE`, `DELETE`, or `DDL`. |
| `Database` | Source database name. |
| `Table` | Source table name. |
| `Position` | Replication position — LSN, GTID, or SCN depending on the database. |
| `Meta` | Source-specific extras (e.g. Postgres relation OID, Oracle redo SQL). |

### Example Source
```go
func (c *IUseConnector) FetchRecords(param *models.MariaSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

    go func() {
        defer close(ch)

        rows, err := param.SourceDBConn.Execute("SELECT id, name FROM " + param.State.GetName() + " LIMIT 5")
        if err != nil {
            log.Println("query error:", err)
            return
        }

        for i := 0; i < rows.RowNumber(); i++ {
            record := map[string]any{}
            for j, col := range rows.Fields {
                val, _ := rows.GetValue(i, j)
                record[string(col.Name)] = val
            }
            ch <- record
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.MariaSourceQuery) (*models.MariaSourceQueryTune, error) {
    query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.State.GetName())
    return &models.MariaSourceQueryTune{Query: query}, nil
}

func (c *IUseConnector) GenerateBinLog(param *models.MariaSourceBinlog) (*models.MariaSourceBinlogTune, error) {
    return &models.MariaSourceBinlogTune{
        ServerID: 1234, // unique replication client ID
        ParseFn: func(event models.ChangeEvent) (map[string]any, error) {
            record := event.After
            if record == nil {
                record = event.Before
            }
            record["_op"] = string(event.Operation)
            record["_table"] = event.Table
            return record, nil
        },
    }, nil
}
```

## Destination Database Operations

MariaDB databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The MariaDB destination interface provides structured data loading operations:

```go
type IClientDBMariaDest interface {
    GenerateQuery(param *models.MariaDestQuery) ([]*models.MariaDestQueryTune, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and UPSERT operations
- **Batch Processing** - Receives a batch of records and returns one query tune per record

### Destination Configuration Structure

When using MariaDB as a destination, the system uses this struct definition:

```go
// Destination operations
type MariaDestQuery struct {
    State              IPipelineRuntimeState
    Records            []map[string]any
    SourceDBConn       IDatabaseEngine
    DestDBConn         *client.Conn
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MariaDestQueryTune struct {
    Query string
    Value []any
}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of data records for transformation and loading
- **Connection Management** - Maintains source, destination, and auxiliary database connections
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination
```go
func (c *IUseConnector) GenerateQuery(param *models.MariaDestQuery) ([]*models.MariaDestQueryTune, error) {
    tunes := make([]*models.MariaDestQueryTune, 0, len(param.Records))

    for _, rec := range param.Records {
        cols := make([]string, 0, len(rec))
        placeholders := make([]string, 0, len(rec))
        args := make([]any, 0, len(rec))

        for k, v := range rec {
            cols = append(cols, k)
            placeholders = append(placeholders, "?")
            args = append(args, v)
        }

        query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
            param.State.GetName(),
            strings.Join(cols, ", "),
            strings.Join(placeholders, ", "),
        )

        tunes = append(tunes, &models.MariaDestQueryTune{
            Query: query,
            Value: args,
        })
    }

    return tunes, nil
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
