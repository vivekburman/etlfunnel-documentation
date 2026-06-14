# Oracle

Oracle databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive Oracle integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

Oracle databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The Oracle source interface supports three primary extraction approaches through these interface methods:

```go
type IClientDBOracleSource interface {
    FetchRecords(param *models.OracleSourceFetch) <-chan map[string]any
    GenerateQuery(param *models.OracleSourceQuery) (*models.OracleSourceQueryTune, error)
    GenerateCDC(param *models.OracleSourceCDC) (*models.OracleSourceCDCTune, error)
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
    AuxiliaryDBConnMap map[string]IDatabaseEngine
    DestDBConn         IDatabaseEngine
}

type OracleSourceQuery struct {
    State              IPipelineRuntimeState
    SourceDBConn       *sql.DB
    DestDBConn         IDatabaseEngine
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type OracleSourceCDC struct {
    State              IPipelineRuntimeState
    SourceDBConn       *sql.DB
    DestDBConn         IDatabaseEngine
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type OracleSourceQueryTune struct {
    Query           string
    RecordsPerBatch int
    PrefetchSize    int
}

type OracleSourceCDCTune struct {
    ParseFn                func(ChangeEvent) (map[string]any, error)
    StartTime              time.Time
    SourceTables           []string
    IncludeOperations      []string
    SCNType                string
    SessionRefreshMode     string
    ExtractionMode         string
    PollingInterval        time.Duration
    SessionRefreshInterval time.Duration
    RetryJitter            float64
    StartSCN               uint64
    BatchSize              int
    SessionRefreshCount    int
    MaxRetries             int
    BaseRetryDelayMs       int
    MaxRetryDelayMs        int
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct Oracle connection instance for data extraction
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Advanced CDC Configuration** - Comprehensive change data capture settings with SCN management, retry logic, and session handling
- **CDC ParseFn** - Controls how raw Oracle change events are shaped into pipeline records

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
| `Position` | Oracle SCN at the time of the change. |
| `Meta` | Oracle-specific extras (e.g. redo/undo SQL). |

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *models.OracleSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

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
            ch <- record
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.OracleSourceQuery) (*models.OracleSourceQueryTune, error) {
    query := fmt.Sprintf("SELECT * FROM %s WHERE ROWNUM <= 10", param.State.GetName())
    return &models.OracleSourceQueryTune{
        Query:           query,
        RecordsPerBatch: 1000,
        PrefetchSize:    100,
    }, nil
}

func (c *IUseConnector) GenerateCDC(param *models.OracleSourceCDC) (*models.OracleSourceCDCTune, error) {
    return &models.OracleSourceCDCTune{
        SourceTables:           []string{param.State.GetName()},
        SCNType:                "CURRENT",
        ExtractionMode:         "HOTLOG",
        IncludeOperations:      []string{"INSERT", "UPDATE", "DELETE"},
        BatchSize:              100,
        PollingInterval:        5 * time.Second,
        SessionRefreshMode:     "TIME_BASED",
        SessionRefreshInterval: 30 * time.Minute,
        MaxRetries:             3,
        BaseRetryDelayMs:       500,
        MaxRetryDelayMs:        10000,
        RetryJitter:            0.3,
        ParseFn: func(event models.ChangeEvent) (map[string]any, error) {
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
    GenerateQuery(param *models.OracleDestQuery) ([]*models.OracleDestQueryTune, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and MERGE operations
- **Batch Processing** - Receives a batch of records and returns one query tune per record

### Destination Configuration Structure

When using Oracle as a destination, the system uses this struct definition:

```go
// Destination operations
type OracleDestQuery struct {
    State              IPipelineRuntimeState
    Records            []map[string]any
    SourceDBConn       IDatabaseEngine
    DestDBConn         *sql.DB
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type OracleDestQueryTune struct {
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
func (c *IUseConnector) GenerateQuery(param *models.OracleDestQuery) ([]*models.OracleDestQueryTune, error) {
    tunes := make([]*models.OracleDestQueryTune, 0, len(param.Records))

    for i, rec := range param.Records {
        cols := make([]string, 0, len(rec))
        placeholders := make([]string, 0, len(rec))
        args := make([]any, 0, len(rec))

        j := 1
        for k, v := range rec {
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

        tunes = append(tunes, &models.OracleDestQueryTune{
            Query: query,
            Value: args,
        })
        _ = i
    }

    return tunes, nil
}
```

## Database Connection Casting

### IDatabaseEngine Interface

The `IDatabaseEngine` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific Oracle connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual Oracle connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to Oracle connection
oracleConn, err := CastAsOracleDBConnection(engine)
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
