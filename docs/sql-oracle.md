# Oracle

Oracle databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive Oracle integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

Oracle databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The Oracle source interface supports three primary extraction approaches through these interface methods:

```go
type IClientDBOracleSource interface {
    FetchRecords(param *models.OracleSourceFetch) <-chan *models.Record
    GenerateQuery(param *models.OracleSourceQuery) (*models.OracleSourceQueryOptions, error)
    GenerateCDC(param *models.OracleSourceCDC) (*models.OracleSourceCDCOptions, error)
}
```

- **Record Fetching** - Provides full control over data reading, streaming records one at a time via channels
- **Query Generation** - Dynamic query construction with Oracle-specific optimizations
- **Change Data Capture** - Real-time change tracking using Oracle's CDC functionality with advanced SCN management

### Source Configuration Structure

When configuring Oracle as a source database, the system uses these struct definitions:

```go
// Source operations
type OracleSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *sql.DB
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type OracleSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type OracleSourceCDC struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type OracleSourceQueryOptions struct {
    Query           string // no default — required
    RecordsPerBatch int    // no default; passed straight to godror.PrefetchCount(RecordsPerBatch). 0 (or negative) disables batching
    PrefetchSize    int    // no default; passed straight to godror.FetchArraySize(PrefetchSize)
}

type OracleSourceCDCOptions struct {
    ParseFn           func(OracleChangeEvent) (map[string]any, error) // required; the source errors if nil
    StartTime         time.Time             // only consulted when SCNType == OracleSCNTypeTimestamp; converted to an SCN. Zero value converts whatever SCN the DB maps epoch to
    SourceTables      []string              // empty/nil means no table filter — all tables are read
    IncludeOperations []OracleOperation     // empty/nil means no operation filter — all operations (INSERT/UPDATE/DELETE/DDL) are read
    SCNType           OracleSCNType         // OracleSCNTypeNumber uses StartSCN as-is, OracleSCNTypeTimestamp resolves StartTime; any other value (including "", the default) falls through to the DB's current SCN
    ExtractionMode    OracleExtractionMode  // no default — required to be OracleExtractionModeHotlog or OracleExtractionModeArchive; any other value errors
    PollingInterval   time.Duration         // no default; passed directly to time.NewTicker, which panics for values <= 0 — effectively required to be positive
    StartSCN          uint64                // only consulted when SCNType == OracleSCNTypeNumber; used as-is
    BatchSize         int                   // <= 0 means no FETCH FIRST clause is added (unbounded fetch); > 0 adds `FETCH FIRST <BatchSize> ROWS ONLY`
}

// OracleSCNType selects how OracleSourceCDCOptions.StartSCN is resolved.
type OracleSCNType string

const (
    OracleSCNTypeNumber    OracleSCNType = "number"
    OracleSCNTypeTimestamp OracleSCNType = "timestamp"
)

// OracleExtractionMode selects the LogMiner extraction strategy. Any value
// other than the two below returns an "unsupported extraction mode" error —
// there is no default.
type OracleExtractionMode string

const (
    OracleExtractionModeHotlog  OracleExtractionMode = "HOTLOG"
    OracleExtractionModeArchive OracleExtractionMode = "ARCHIVE"
)

// OracleOperation is a LogMiner V$LOGMNR_CONTENTS.OPERATION value, used to
// filter OracleSourceCDCOptions.IncludeOperations.
type OracleOperation string

const (
    OracleOperationInsert OracleOperation = "INSERT"
    OracleOperationUpdate OracleOperation = "UPDATE"
    OracleOperationDelete OracleOperation = "DELETE"
    OracleOperationDDL    OracleOperation = "DDL"
)
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct Oracle connection instance for data extraction, available on `OracleSourceFetch`
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Advanced CDC Configuration** - SCN management and polling-based change tracking
- **CDC ParseFn** - Controls how raw Oracle change events are shaped into pipeline records

:::note LogMiner sessions are per-poll, not long-lived
Each poll tick acquires its own connection, calls `START_LOGMNR` with just `STARTSCN` (letting Oracle auto-discover the needed redo/archive log files), queries `V$LOGMNR_CONTENTS`, then ends the session — all within that single tick. There is no persistent LogMiner session across polls, so there's nothing to periodically refresh, and no per-file `ADD_LOGFILE` call to retry with backoff. (An earlier implementation kept a long-lived session with configurable refresh/retry behavior, but `DBMS_LOGMNR.ADD_LOGFILE` raises `ORA-65040` when connected to a Pluggable Database, so that approach was replaced with the current auto-discovery design.) On a transient extraction error, the source simply logs and retries at the next `PollingInterval` tick.
:::

### OracleChangeEvent

`OracleChangeEvent` is the typed value the engine passes to the `ParseFn` of `OracleSourceCDCOptions`. All fields are populated by the engine before your function is called.

```go
type OracleChangeEvent struct {
    Before    map[string]any
    After     map[string]any
    Operation ChangeEventOperation
    Database  string
    Table     string
    Position  string // SCN represented as string
    SCN       uint64
    Timestamp time.Time
    RedoSQL   string
    UndoSQL   string
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
| `Position` | Oracle SCN at the time of the change, represented as a string. |
| `SCN` | Oracle SCN at the time of the change, as a numeric value. |
| `Timestamp` | Time the change was captured. |
| `RedoSQL` | Redo SQL for the change, when available. |
| `UndoSQL` | Undo SQL for the change, when available. |

### Record Position Metadata

`GenerateCDC` (LogMiner) reads stamp each delivered record's `Meta` with the SCN that produced it:

| Key | Constant | Description |
|-----|----------|--------------|
| `_oracle_scn` | `models.MetaOracleSCN` | The SCN, as `uint64` (matching `OracleSourceCDCOptions.StartSCN`'s own type), that produced this change |

`GenerateQuery` reads never set `Meta` — a one-shot query has no position to resume from. Reusing this value directly as `StartSCN` (with `SCNType: models.OracleSCNTypeNumber`) on a fresh `GenerateCDC` call resumes LogMiner from exactly this point.

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *models.OracleSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        rows, err := param.SourceDBConn.Query("SELECT id, name FROM " + param.State.GetName() + " WHERE ROWNUM <= 5")
        if err != nil {
            log.Println("query error:", err)
            return
        }
        defer rows.Close()

        cols, _ := rows.Columns()
        for rows.Next() {
            vals := make([]any, len(cols))
            ptrs := make([]any, len(cols))
            for i := range vals {
                ptrs[i] = &vals[i]
            }

            if err := rows.Scan(ptrs...); err != nil {
                log.Println("scan error:", err)
                continue
            }

            record := map[string]any{}
            for i, col := range cols {
                record[col] = vals[i]
            }
            ch <- &models.Record{Data: record}
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.OracleSourceQuery) (*models.OracleSourceQueryOptions, error) {
    query := fmt.Sprintf("SELECT * FROM %s WHERE ROWNUM <= 10", param.State.GetName())
    return &models.OracleSourceQueryOptions{
        Query:           query,
        RecordsPerBatch: 1000,
        PrefetchSize:    100,
    }, nil
}

func (c *IUseConnector) GenerateCDC(param *models.OracleSourceCDC) (*models.OracleSourceCDCOptions, error) {
    return &models.OracleSourceCDCOptions{
        SourceTables:   []string{param.State.GetName()},
        SCNType:        "CURRENT", // anything other than OracleSCNTypeNumber/OracleSCNTypeTimestamp falls through to the DB's current SCN
        ExtractionMode: models.OracleExtractionModeHotlog,
        IncludeOperations: []models.OracleOperation{
            models.OracleOperationInsert,
            models.OracleOperationUpdate,
            models.OracleOperationDelete,
        },
        BatchSize:       100, // <= 0 would mean unbounded fetch
        PollingInterval: 5 * time.Second,
        ParseFn: func(event models.OracleChangeEvent) (map[string]any, error) {
            record := event.After
            if record == nil {
                record = event.Before
            }
            record["_op"] = string(event.Operation)
            record["_scn"] = event.Position
            return record, nil
        },
    }, nil
}
```

## Destination Database Operations

Oracle databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The Oracle destination interface provides structured data loading operations:

```go
type IClientDBOracleDest interface {
    GenerateQuery(param *models.OracleDestQuery) ([]*models.OracleDestQueryPayload, error)
    GenerateOptions(param *models.OracleDestQuery) (*models.OracleDestOptions, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and MERGE operations
- **Batch Processing** - Receives a batch of records and returns one query payload per record
- **Options Generation** - Hook for destination-wide options (currently `OracleDestOptions` carries no fields)

### Destination Configuration Structure

When using Oracle as a destination, the system uses this struct definition:

```go
// Destination operations
type OracleDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type OracleDestQueryPayload struct {
    Query string
    Value []any
}

type OracleDestOptions struct{}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` values (each wrapping a `Data` map) for transformation and loading
- **Connection Management** - Maintains auxiliary database connections for lookups
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.OracleDestQuery) ([]*models.OracleDestQueryPayload, error) {
    payloads := make([]*models.OracleDestQueryPayload, 0, len(param.Records))

    for i, rec := range param.Records {
        cols := make([]string, 0, len(rec.Data))
        placeholders := make([]string, 0, len(rec.Data))
        args := make([]any, 0, len(rec.Data))

        j := 1
        for k, v := range rec.Data {
            cols = append(cols, k)
            placeholders = append(placeholders, ":v"+strconv.Itoa(j))
            args = append(args, v)
            j++
        }

        query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
            param.State.GetName(),
            strings.Join(cols, ", "),
            strings.Join(placeholders, ", "),
        )

        payloads = append(payloads, &models.OracleDestQueryPayload{
            Query: query,
            Value: args,
        })
        _ = i
    }

    return payloads, nil
}
```

## Database Connection Casting

### IDatabaseConnInfo Interface

The `IDatabaseConnInfo` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific Oracle connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual Oracle connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseConnInfo to Oracle connection
oracleConn, err := CastAsOracleConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Oracle connection: %v", err)
}

// Now you can use the underlying Oracle connection directly
// oracleConn is of type *sql.DB
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid Oracle connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to Oracle-specific functionality when required.
:::
