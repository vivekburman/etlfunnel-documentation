# MySQL

MySQL databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive MySQL integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

MySQL databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The MySQL source interface supports three primary extraction approaches through these interface methods:

```go
type IClientDBMySQLSource interface {
    FetchRecords(param *models.MySQLSourceFetch) <-chan *models.Record
    GenerateQuery(param *models.MySQLSourceQuery) (*models.MySQLSourceQueryTune, error)
    GenerateBinLog(pram *models.MySQLSourceBinlog) (*models.MySQLSourceBinlogTune, error)
}
```

- **Record Fetching** - Provides full control over data reading, streaming records one at a time via channels
- **Query Generation** - Dynamic query construction for complex data transformations  
- **Binary Log Processing** - Real-time change data capture using MySQL's binlog functionality

### Source Configuration Structure

When configuring MySQL as a source database, the system uses these struct definitions:

```go
// Source operations
type MySQLSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *client.Conn
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MySQLSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MySQLSourceBinlog struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MySQLSourceQueryTune struct {
    Query string
}

type MySQLSourceBinlogTune struct {
    ParseFn  func(MySQLChangeEvent) (map[string]any, error)
    ServerID uint32
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct MySQL connection instance for data extraction, available on `MySQLSourceFetch`
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **BinLog ParseFn** - Controls how raw change events are shaped into pipeline records

### MySQLChangeEvent

`MySQLChangeEvent` is the typed value the engine passes to the `ParseFn` of `MySQLSourceBinlogTune`. All fields are populated by the engine before your function is called.

```go
type MySQLChangeEvent struct {
    Before    map[string]any
    After     map[string]any
    Meta      map[string]any
    Operation ChangeEventOperation
    Database  string
    Table     string
    Position  string // LSN / GTID / SCN represented as string
    Query     string // DDL/QueryEvent text
    XID       string // transaction id (XIDEvent)
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
| `Position` | Replication position (GTID/log position) at the time of the change. |
| `Query` | Raw DDL/query text, populated for `QueryEvent`-based changes. |
| `XID` | Transaction id, populated for `XIDEvent`-based changes. |
| `Meta` | Source-specific extras. |

### Example Source
```go
func (c *IUseConnector) FetchRecords(param *models.MySQLSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

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
            ch <- &models.Record{Data: record}
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.MySQLSourceQuery) (*models.MySQLSourceQueryTune, error) {
    query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.State.GetName())
    return &models.MySQLSourceQueryTune{Query: query}, nil
}

func (c *IUseConnector) GenerateBinLog(param *models.MySQLSourceBinlog) (*models.MySQLSourceBinlogTune, error) {
    return &models.MySQLSourceBinlogTune{
        ServerID: 1234, // unique replication client ID
        ParseFn: func(event models.MySQLChangeEvent) (map[string]any, error) {
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

MySQL databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The MySQL destination interface provides structured data loading operations:

```go
type IClientDBMySQLDest interface {
    GenerateQuery(param *models.MySQLDestQuery) ([]*models.MySQLDestQueryPayload, error)
    GenerateOptions(param *models.MySQLDestQuery) (*models.MySQLDestOptions, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and UPSERT operations
- **Batch Processing** - Receives a batch of records and returns one query payload per record
- **Options Generation** - Hook for destination-wide options (currently `MySQLDestOptions` carries no fields)

### Destination Configuration Structure

When using MySQL as a destination, the system uses this struct definition:

```go
// Destination operations
type MySQLDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MySQLDestQueryPayload struct {
    Query string
    Value []any
}

type MySQLDestOptions struct{}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` values (each wrapping a `Data` map) for transformation and loading
- **Connection Management** - Maintains auxiliary database connections for lookups
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination
```go
func (c *IUseConnector) GenerateQuery(param *models.MySQLDestQuery) ([]*models.MySQLDestQueryPayload, error) {
    payloads := make([]*models.MySQLDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        cols := make([]string, 0, len(rec.Data))
        placeholders := make([]string, 0, len(rec.Data))
        args := make([]any, 0, len(rec.Data))

        for k, v := range rec.Data {
            cols = append(cols, k)
            placeholders = append(placeholders, "?")
            args = append(args, v)
        }

        query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
            param.State.GetName(),
            strings.Join(cols, ", "),
            strings.Join(placeholders, ", "),
        )

        payloads = append(payloads, &models.MySQLDestQueryPayload{
            Query: query,
            Value: args,
        })
    }

    return payloads, nil
}
```

## Database Connection Casting

### IDatabaseEngine Interface

The `IDatabaseEngine` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific MySQL connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual MySQL connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to MySQL connection
mysqlConn, err := CastAsMySQLDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to MySQL connection: %v", err)
}

// Now you can use the underlying MySQL connection directly
// mysqlConn is of type *client.Conn
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid MySQL connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to MySQL-specific functionality when required.
:::
