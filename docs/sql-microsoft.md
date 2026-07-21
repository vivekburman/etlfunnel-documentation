# Microsoft SQL Server

Microsoft SQL Server databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive SQL Server integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

Microsoft SQL Server databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The SQL Server source interface supports four primary extraction approaches through these interface methods:

```go
type IClientDBMicrosoftServerSource interface {
    FetchRecords(param *models.MicrosoftServerSourceFetch) <-chan *models.Record
    GenerateQuery(param *models.MicrosoftServerSourceQuery) (*models.MicrosoftServerSourceQueryOptions, error)
    GenerateCDC(param *models.MicrosoftServerSourceCDC) (*models.MicrosoftServerSourceCDCOptions, error)
    GenerateServiceBroker(param *models.MicrosoftServerSourceServiceBroker) (*models.MicrosoftServerServiceBrokerOptions, error)
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
    State              IPipelineRuntimeState
    SourceDBConn       *sql.DB
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerSourceCDC struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerSourceServiceBroker struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerSourceQueryOptions struct {
    Query string
}

type MicrosoftServerSourceCDCOptions struct {
    ParseFn      func(MSSQLChangeEvent) (map[string]any, error)
    StartTime    time.Time
    EndTime      time.Time
    FromLSN      string
    ToLSN        string
    QueryType    MicrosoftServerCDCQueryType
    InstanceName string
    RowFilter    string
    UseMinMaxLSN bool
}

type MicrosoftServerServiceBrokerOptions struct {
    ParseFn    func(MSSQLServiceBrokerRawMessage) (map[string]any, error) // required; the source errors if nil
    QueueName  string // no default — required
    SchemaName string // no default — required
    Timeout    int    // only appends a `, TIMEOUT <n>` clause when >= 0; a negative value omits the clause and waits indefinitely.
                       // The zero value (0) is NOT "never timeout" — it produces `TIMEOUT 0`, which returns immediately.
}

const (
    MicrosoftServerCDCTypeAllChanges MicrosoftServerCDCQueryType = "ALL_CHANGES"
    MicrosoftServerCDCTypeNetChanges MicrosoftServerCDCQueryType = "NET_CHANGES"
)

// MSSQLServiceBrokerRawMessage carries a raw message from a SQL Server Service Broker queue.
type MSSQLServiceBrokerRawMessage struct {
    Body               []byte
    MessageTypeName    string
    ConversationHandle string
    ServiceName        string
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct SQL Server connection instance for data extraction, available on `MicrosoftServerSourceFetch`
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **CDC ParseFn** - Controls how raw change events are shaped into pipeline records
- **Service Broker ParseFn** - Controls how raw Service Broker messages are shaped into pipeline records

### MSSQLChangeEvent

`MSSQLChangeEvent` is the typed value the engine passes to the `ParseFn` of `MicrosoftServerSourceCDCOptions`. All fields are populated by the engine before your function is called.

```go
type MSSQLChangeEvent struct {
    Before    map[string]any
    After     map[string]any
    Meta      map[string]any
    Operation ChangeEventOperation
    Database  string
    Table     string
    Position  string // LSN represented as string
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
| `Position` | SQL Server LSN at the time of the change. |
| `Meta` | Source-specific extras. |

:::note MSSQL is the one CDC connector that still carries a `Meta` bag
`MySQLChangeEvent`, `MariaChangeEvent`, `OracleChangeEvent`, and `PostgresChangeEvent` all expose their per-event extras as typed fields directly on the struct (e.g. `Query`/`XID`, `SCN`/`RedoSQL`, `RelationOID`) rather than a generic `map[string]any`. `MSSQLChangeEvent.Meta` is the one exception, because SQL Server's CDC `__$*` system columns are numerous and driver-specific rather than a small fixed set worth giving individual typed fields.
:::

### Record Position Metadata

`GenerateCDC` and `GenerateServiceBroker` reads each stamp their own key on the delivered record's `Meta`:

| Key | Constant | Description |
|-----|----------|--------------|
| `_mssql_lsn` | `models.MetaMSSQLLSN` | `GenerateCDC` reads: the LSN that produced this change, hex-encoded with a leading `0x` — the exact format `MicrosoftServerSourceCDCOptions.FromLSN` expects, reusable with zero conversion |
| `_mssql_conversation_handle` | `models.MetaMSSQLConversationHandle` | `GenerateServiceBroker` reads: the conversation handle, needed to end the conversation after processing |

`GenerateQuery` reads never set `Meta` — a one-shot query has no position to resume from.

:::note This is a different `Meta` than `MSSQLChangeEvent.Meta` above
The `MSSQLChangeEvent.Meta` field documented above is raw `__$*` system-column input handed to your `ParseFn`. `Record.Meta` (this section) is the engine's own output, attached to the record after your `ParseFn` has already run — the two only share a name, not a value.
:::

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *models.MicrosoftServerSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        rows, err := param.SourceDBConn.Query("SELECT TOP 5 id, name FROM " + param.State.GetName())
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

func (c *IUseConnector) GenerateQuery(param *models.MicrosoftServerSourceQuery) (*models.MicrosoftServerSourceQueryOptions, error) {
    query := fmt.Sprintf("SELECT TOP 10 * FROM %s", param.State.GetName())
    return &models.MicrosoftServerSourceQueryOptions{Query: query}, nil
}

func (c *IUseConnector) GenerateCDC(param *models.MicrosoftServerSourceCDC) (*models.MicrosoftServerSourceCDCOptions, error) {
    endTime := time.Now()
    startTime := endTime.Add(-1 * time.Hour)

    return &models.MicrosoftServerSourceCDCOptions{
        StartTime:    startTime,
        EndTime:      endTime,
        UseMinMaxLSN: true,
        QueryType:    models.MicrosoftServerCDCTypeAllChanges,
        InstanceName: fmt.Sprintf("dbo_%s", param.State.GetName()),
        ParseFn: func(event models.MSSQLChangeEvent) (map[string]any, error) {
            record := event.After
            if record == nil {
                record = event.Before
            }
            record["_op"] = string(event.Operation)
            record["_lsn"] = event.Position
            return record, nil
        },
    }, nil
}

func (c *IUseConnector) GenerateServiceBroker(param *models.MicrosoftServerSourceServiceBroker) (*models.MicrosoftServerServiceBrokerOptions, error) {
    return &models.MicrosoftServerServiceBrokerOptions{
        QueueName:  param.State.GetName() + "_queue",
        SchemaName: "dbo",
        Timeout:    30000, // 30 seconds; use a negative value instead to wait indefinitely
        ParseFn: func(msg models.MSSQLServiceBrokerRawMessage) (map[string]any, error) {
            return map[string]any{
                "body":         string(msg.Body),
                "message_type": msg.MessageTypeName,
                "service":      msg.ServiceName,
            }, nil
        },
    }, nil
}
```

## Destination Database Operations

Microsoft SQL Server databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The SQL Server destination interface provides structured data loading operations:

```go
type IClientDBMicrosoftServerDest interface {
    GenerateQuery(param *models.MicrosoftServerDestQuery) ([]*models.MicrosoftServerDestQueryPayload, error)
    GenerateOptions(param *models.MicrosoftServerDestQuery) (*models.MicrosoftServerDestOptions, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and MERGE operations
- **Batch Processing** - Receives a batch of records and returns one query payload per record
- **Options Generation** - Hook for destination-wide options (currently `MicrosoftServerDestOptions` carries no fields)

### Destination Configuration Structure

When using SQL Server as a destination, the system uses this struct definition:

```go
// Destination operations
type MicrosoftServerDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type MicrosoftServerDestQueryPayload struct {
    Query string
    Value []any
}

type MicrosoftServerDestOptions struct{}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` values (each wrapping a `Data` map) for transformation and loading
- **Connection Management** - Maintains auxiliary database connections for lookups
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.MicrosoftServerDestQuery) ([]*models.MicrosoftServerDestQueryPayload, error) {
    payloads := make([]*models.MicrosoftServerDestQueryPayload, 0, len(param.Records))

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

        payloads = append(payloads, &models.MicrosoftServerDestQueryPayload{
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
