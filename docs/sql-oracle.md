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
    PipelineName      string
    SourceDBConn      *sql.DB
    AuxilaryDBConnMap map[string]IDatabaseEngine
    DestDBConn        IDatabaseEngine
}

type OracleSourceQuery struct {
    PipelineName      string
    SourceDBConn      *sql.DB
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type OracleSourceCDC struct {
    PipelineName      string
    SourceDBConn      *sql.DB
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type OracleSourceQueryTune struct {
    Query           string
    RecordsPerBatch int
    PrefetchSize    int
}

type OracleSourceCDCTune struct {
    SourceTables           []string
    SCNType                string
    StartSCN               uint64
    StartTime              time.Time
    ExtractionMode         string
    IncludeOperations      []string
    BatchSize              int
    PollingInterval        time.Duration
    SessionRefreshMode     string
    SessionRefreshInterval time.Duration
    SessionRefreshCount    int
    MaxRetries             int
    BaseRetryDelayMs       int
    MaxRetryDelayMs        int
    RetryJitter            float64
}
```

These structures provide:

- **Pipeline Name** - Unique identifier for the ETL operation
- **Source DB Connection** - Direct Oracle connection instance for data extraction
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Advanced CDC Configuration** - Comprehensive change data capture settings with SCN management, retry logic, and session handling

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *OracleSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

    go func() {
        defer close(ch)

        rows, err := param.SourceDBConn.Query("SELECT id, name FROM " + param.PipelineName + " WHERE ROWNUM <= 5")
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

func (c *IUseConnector) GenerateQuery(param *OracleSourceQuery) (*OracleSourceQueryTune, error) {
    query := fmt.Sprintf("SELECT * FROM %s WHERE ROWNUM <= 10", param.PipelineName)
    return &OracleSourceQueryTune{
        Query:           query,
        RecordsPerBatch: 1000,
        PrefetchSize:    100,
    }, nil
}

func (c *IUseConnector) GenerateCDC(param *OracleSourceCDC) (*OracleSourceCDCTune, error) {
    return &OracleSourceCDCTune{
        SourceTables:           []string{param.PipelineName},
        SCNType:                "CURRENT",
        ExtractionMode:         "HOTLOG",
        IncludeOperations:      []string{"INSERT", "UPDATE", "DELETE"},
        BatchSize:              100,
        PollingInterval:        time.Second * 5,
        SessionRefreshMode:     "TIME_BASED",
        SessionRefreshInterval: time.Minute * 30,
        MaxRetries:             3,
        BaseRetryDelayMs:       500,
        MaxRetryDelayMs:        10000,
        RetryJitter:            0.3,
    }, nil
}
```

## Destination Database Operations

Oracle databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The Oracle destination interface provides structured data loading operations:

```go
type IClientDBOracleDest interface {
    GenerateQuery(param *models.OracleDestQuery) (*models.OracleDestQueryTune, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and MERGE operations
- **Batch Processing** - Efficient handling of large record sets with Oracle-specific optimizations

### Destination Configuration Structure

When using Oracle as a destination, the system uses this struct definition:

```go
// Destination operations
type OracleDestQuery struct {
    PipelineName      string
    Record            map[string]any
    SourceDBConn      IDatabaseEngine
    DestDBConn        *sql.DB
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type OracleDestQueryTune struct {
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
func (c *IUseConnector) GenerateQuery(param *models.OracleDestQuery) (*models.OracleDestQueryTune, error) {
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
        values += ":v" + strconv.Itoa(i+1)
        args = append(args, v)
        i++
    }

    query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
        param.PipelineName, columns, values)

    return &models.OracleDestQueryTune{
        Query:           query,
        Value:           args,
        RecordsPerBatch: 1000,
    }, nil
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