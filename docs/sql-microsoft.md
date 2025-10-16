# Microsoft SQL Server

Microsoft SQL Server databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive SQL Server integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

Microsoft SQL Server databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The SQL Server source interface supports four primary extraction approaches through these interface methods:

```go
type IClientDBMicrosoftServerSource interface {
    FetchRecords(param *models.MicrosoftServerSourceFetch) <-chan map[string]any
    GenerateQuery(param *models.MicrosoftServerSourceQuery) (*models.MicrosoftServerSourceQueryTune, error)
    GenerateCDC(param *models.MicrosoftServerSourceCDC) (*models.MicrosoftServerSourceCDCTune, error)
    GenerateServiceBroker(param *models.MicrosoftServerSourceServiceBroker) (*models.MicrosoftServerServiceBrokerTune, error)
}
```

- **Record Fetching** - Provides full control over data reading, streaming records one at a time via channels
- **Query Generation** - Dynamic query construction for complex data transformations
- **Change Data Capture (CDC)** - Real-time change tracking using SQL Server's CDC functionality
- **Service Broker** - Message-based change notification using SQL Server Service Broker

### Source Configuration Structure

When configuring SQL Server as a source database, the system uses these struct definitions:

```go
// Source operations
type MicrosoftServerSourceFetch struct {
    PipelineName      string
    SourceDBConn      *sql.DB
    AuxilaryDBConnMap map[string]IDatabaseEngine
    DestDBConn        IDatabaseEngine
}

type MicrosoftServerSourceQuery struct {
    PipelineName      string
    SourceDBConn      *sql.DB
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerSourceCDC struct {
    PipelineName      string
    SourceDBConn      *sql.DB
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerSourceServiceBroker struct {
    PipelineName      string
    SourceDBConn      *sql.DB
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerSourceCDCTune struct {
    FromLSN      string
    ToLSN        string
    StartTime    time.Time
    EndTime      time.Time
    UseMinMaxLSN bool
    QueryType    MicrosoftServerCDCQueryType
    InstanceName string
    RowFilter    string
}

type MicrosoftServerServiceBrokerTune struct {
    QueueName  string
    SchemaName string
    Timeout    int // -1 means never timeout
}

type MicrosoftServerSourceQueryTune struct {
    Query string
}
const (
	MicrosoftServerCDCTypeAllChanges MicrosoftServerCDCQueryType = "ALL_CHANGES"
	MicrosoftServerCDCTypeNetChanges MicrosoftServerCDCQueryType = "NET_CHANGES"
)
```

These structures provide:

- **Pipeline Name** - Unique identifier for the ETL operation
- **Source DB Connection** - Direct SQL Server connection instance for data extraction
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *MicrosoftServerSourceFetch) <-chan map[string]any {
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

func (c *IUseConnector) GenerateQuery(param *MicrosoftServerSourceQuery) (*MicrosoftServerSourceQueryTune, error) {
    query := fmt.Sprintf("SELECT TOP 10 * FROM %s", param.Ctx.GetName())
    return &MicrosoftServerSourceQueryTune{Query: query}, nil
}

func (c *IUseConnector) GenerateCDC(param *MicrosoftServerSourceCDC) (*MicrosoftServerSourceCDCTune, error) {
    // Get current time for the end range
    endTime := time.Now()
    // Set start time to 1 hour ago for example
    startTime := endTime.Add(-1 * time.Hour)

    return &MicrosoftServerSourceCDCTune{
        FromLSN:      "", // Will be determined by sys.fn_cdc_get_min_lsn or sys.fn_cdc_map_time_to_lsn
        ToLSN:        "", // Will be determined by sys.fn_cdc_get_max_lsn or sys.fn_cdc_map_time_to_lsn  
        StartTime:    startTime,
        EndTime:      endTime,
        UseMinMaxLSN: true, // Use sys.fn_cdc_get_min_lsn and sys.fn_cdc_get_max_lsn
        QueryType:    models.MicrosoftServerCDCTypeAllChanges,
        InstanceName: fmt.Sprintf("dbo_%s", param.Ctx.GetName()), // Capture instance name format: schema_tablename
        RowFilter:    "", // Additional WHERE clause if needed
    }, nil
}

func (c *IUseConnector) GenerateServiceBroker(param *MicrosoftServerSourceServiceBroker) (*MicrosoftServerServiceBrokerTune, error) {
    return &MicrosoftServerServiceBrokerTune{
        QueueName:  param.Ctx.GetName() + "_queue",
        SchemaName: "dbo",
        Timeout:    30000, // 30 seconds
    }, nil
}
```

## Destination Database Operations

Microsoft SQL Server databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The SQL Server destination interface provides structured data loading operations:

```go
type IClientDBMicrosoftServerDest interface {
    GenerateQuery(param *models.MicrosoftServerDestQuery) (*models.MicrosoftServerDestQueryTune, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and MERGE operations
- **Batch Processing** - Efficient handling of large record sets

### Destination Configuration Structure

When using SQL Server as a destination, the system uses this struct definition:

```go
// Destination operations
type MicrosoftServerDestQuery struct {
    PipelineName      string
    Record            map[string]any
    SourceDBConn      IDatabaseEngine
    DestDBConn        *sql.DB
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerDestQueryTune struct {
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
func (c *IUseConnector) GenerateQuery(param *models.MicrosoftServerDestQuery) (*models.MicrosoftServerDestQueryTune, error) {
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

    return &models.MicrosoftServerDestQueryTune{
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

The system includes built-in functionality to cast generic database engine interfaces to specific SQL Server connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual SQL Server connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to SQL Server connection
sqlServerConn, err := CastAsMicrosoftServerDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to SQL Server connection: %v", err)
}

// Now you can use the underlying SQL Server connection directly
// sqlServerConn is of type *sql.DB
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid SQL Server connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to SQL Server-specific functionality when required.
:::