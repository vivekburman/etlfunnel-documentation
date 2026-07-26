# MariaDB

MariaDB databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive MariaDB integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

MariaDB databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The MariaDB source interface supports three primary extraction approaches through these interface methods:

```go
type IClientDBMariaSource interface {
    FetchRecords(param *models.MariaSourceFetch) <-chan *models.Record
    GenerateQuery(param *models.MariaSourceQuery) (*models.MariaSourceQueryOptions, error)
    GenerateBinLog(param *models.MariaSourceBinlog) (*models.MariaSourceBinlogOptions, error)
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
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type MariaSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type MariaSourceBinlog struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type MariaSourceQueryOptions struct {
    Query string
}

type MariaSourceBinlogOptions struct {
    ParseFn       func(MariaChangeEvent) (map[string]any, error)
    StartFile     string // binlog filename to start streaming from
    StartPosition uint32 // byte offset within StartFile to start streaming from
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct MariaDB connection instance for data extraction, available on `MariaSourceFetch`
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **BinLog ParseFn** - Controls how raw change events are shaped into pipeline records
- **StartFile / StartPosition** - Select where `GenerateBinLog` begins streaming; leaving both unset reproduces the server's own default, which is **not** "start from now" — an empty filename makes the server start from the first event of its *oldest retained* binlog

The replication server ID is configured once, at the connection level — the **Server ID** parameter on the [MariaDB Connector](connector-hub.md#mariadb-connector) — and is what actually registers with the MariaDB master.

### MariaChangeEvent

`MariaChangeEvent` is the typed value the engine passes to the `ParseFn` of `MariaSourceBinlogOptions`. All fields are populated by the engine before your function is called.

```go
type MariaChangeEvent struct {
    Before    map[string]any
    After     map[string]any
    Operation ChangeEventOperation
    Database  string
    Table     string
    Position  string // LSN / GTID / SCN represented as string
    Query     string // DDL/QueryEvent text
    XID       string // transaction id (XIDEvent)
    GTID      string // global transaction id (MariadbGTIDEvent)
    Timestamp uint32 // binlog event header timestamp (row events)
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
| `GTID` | MariaDB global transaction id, populated for `MariadbGTIDEvent`-based changes. |
| `Timestamp` | Binlog event header timestamp for row events. |

### Record Position Metadata

`GenerateBinLog` reads stamp each delivered record's `Meta` with the exact `(file, position)` coordinate that produced it — including `MariadbGTIDEvent`-based records, since file+position resume works regardless of whether GTID mode is also active:

| Key | Constant | Description |
|-----|----------|--------------|
| `_maria_binlog_file` | `models.MetaMariaBinlogFile` | The binlog filename currently being read, tracked from the server's own rotate events |
| `_maria_binlog_pos` | `models.MetaMariaBinlogPos` | The byte position immediately after this event, within that file |

Both values are directly reusable, with no conversion, as `StartFile`/`StartPosition` on a fresh `GenerateBinLog` call — resuming with them continues the stream right after the row that produced them, without replaying it.

### Example Source
```go
func (c *IUseConnector) FetchRecords(param *models.MariaSourceFetch) <-chan *models.Record {
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

func (c *IUseConnector) GenerateQuery(param *models.MariaSourceQuery) (*models.MariaSourceQueryOptions, error) {
    query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.State.GetName())
    return &models.MariaSourceQueryOptions{Query: query}, nil
}

func (c *IUseConnector) GenerateBinLog(param *models.MariaSourceBinlog) (*models.MariaSourceBinlogOptions, error) {
    return &models.MariaSourceBinlogOptions{
        ParseFn: func(event models.MariaChangeEvent) (map[string]any, error) {
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
    GenerateQuery(param *models.MariaDestQuery) ([]*models.MariaDestQueryPayload, error)
    GenerateOptions(param *models.MariaDestQuery) (*models.MariaDestOptions, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and UPSERT operations
- **Batch Processing** - Receives a batch of records and returns one query payload per record
- **Options Generation** - Hook for destination-wide options (currently `MariaDestOptions` carries no fields)

### Destination Configuration Structure

When using MariaDB as a destination, the system uses this struct definition:

```go
// Destination operations
type MariaDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type MariaDestQueryPayload struct {
    Query string
    Value []any
}

type MariaDestOptions struct{}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` values (each wrapping a `Data` map) for transformation and loading
- **Connection Management** - Maintains auxiliary database connections for lookups
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination
```go
func (c *IUseConnector) GenerateQuery(param *models.MariaDestQuery) ([]*models.MariaDestQueryPayload, error) {
    payloads := make([]*models.MariaDestQueryPayload, 0, len(param.Records))

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

        payloads = append(payloads, &models.MariaDestQueryPayload{
            Query: query,
            Value: args,
        })
    }

    return payloads, nil
}
```

## Database Connection Casting

### IDatabaseConnInfo Interface

The `IDatabaseConnInfo` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific MariaDB connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual MariaDB connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseConnInfo to MariaDB connection
mariaConn, err := CastAsMariaConnection(engine)
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
