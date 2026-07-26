# Postgres

PostgreSQL databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive PostgreSQL integration capabilities, supporting multiple data extraction methods including advanced features like WAL streaming and notification systems.

## Source Database Operations

PostgreSQL databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The PostgreSQL source interface supports four primary extraction approaches through these interface methods:

```go
type IClientDBPostgresSource interface {
    FetchRecords(param *models.PostgresSourceFetch) <-chan *models.Record
    GenerateQuery(param *models.PostgresSourceQuery) (*models.PostgresSourceQueryOptions, error)
    GenerateNotification(param *models.PostgresSourceNotification) (*models.PostgresSourceNotificationOptions, error)
    GenerateWAL(param *models.PostgresSourceWAL) (*models.PostgresSourceWALOptions, error)
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
    State              IPipelineRuntimeState
    SourceDBConn       *pgx.Conn
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type PostgresSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type PostgresSourceNotification struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type PostgresSourceWAL struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type PostgresSourceQueryOptions struct {
    Query string
}

type PostgresSourceNotificationOptions struct {
    ParseFn     func(PostgresRawNotification) (map[string]any, error)
    ChannelName string
}

type PostgresSourceWALOptions struct {
    ParseFn         func(PostgresChangeEvent) (map[string]any, error) // required; the source errors if nil
    SlotName        string                       // no default — required, used as-is in START_REPLICATION SLOT
    OutputPlugin    PostgresCDCOutputPluginType   // required to be PG_OUTPUT or WAL2JSON; any other value (including "") errors without starting replication
    PublicationName string                       // no default — required, used as-is
    Streaming       bool                         // defaults to false, selecting the v1 logical replication protocol; true selects the streaming (v2) protocol
}

const (
    PostgresCDCTypePGOutput PostgresCDCOutputPluginType = "PG_OUTPUT"
    PostgresCDCTypeWAL2JSON PostgresCDCOutputPluginType = "WAL2JSON"
)

// PostgresRawNotification carries a raw LISTEN/NOTIFY payload from Postgres.
type PostgresRawNotification struct {
    Channel string
    Payload string
    PID     int
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct PostgreSQL connection instance using pgx driver, available on `PostgresSourceFetch`
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **WAL Configuration** - Advanced replication settings with support for multiple output plugins and a `ParseFn` for shaping change events into records. `Streaming` defaults to `false` (v1 logical replication protocol); set it to `true` to opt into the streaming v2 protocol
- **Notification Channels** - Real-time event processing with a `ParseFn` to transform raw payloads into records

### PostgresChangeEvent

`PostgresChangeEvent` is the typed value the engine passes to the `ParseFn` of `PostgresSourceWALOptions`. All fields are populated by the engine before your function is called.

```go
type PostgresChangeEvent struct {
    Before      map[string]any
    After       map[string]any
    Operation   ChangeEventOperation
    Database    string
    Table       string
    Position    string // LSN represented as string
    RelationOID uint32 // relation OID from the replication protocol
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
| `Position` | Postgres LSN at the time of the change. |
| `RelationOID` | Relation OID from the logical replication protocol. |

### Record Position Metadata

`GenerateNotification` and `GenerateWAL` reads each stamp their own key(s) on the delivered record's `Meta`:

| Key | Constant | Description |
|-----|----------|--------------|
| `_pg_notify_channel` | `models.MetaPGNotifyChannel` | `GenerateNotification` reads: the channel name that matched |
| `_pg_notify_pid` | `models.MetaPGNotifyPID` | `GenerateNotification` reads: the sending backend's PID |
| `_pg_wal_lsn` | `models.MetaPGWALLSN` | `GenerateWAL` reads: the LSN that produced this change (both `PG_OUTPUT` and `WAL2JSON` output plugins) |

`GenerateQuery` reads never set `Meta` — a one-shot query has no position to resume from.

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *models.PostgresSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        rows, err := param.SourceDBConn.Query(context.Background(),
            "SELECT id, name FROM "+param.State.GetName()+" LIMIT 5")
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
                record[string(col.Name)] = values[i]
            }
            ch <- &models.Record{Data: record}
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.PostgresSourceQuery) (*models.PostgresSourceQueryOptions, error) {
    query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.State.GetName())
    return &models.PostgresSourceQueryOptions{Query: query}, nil
}

func (c *IUseConnector) GenerateNotification(param *models.PostgresSourceNotification) (*models.PostgresSourceNotificationOptions, error) {
    channelName := fmt.Sprintf("%s_changes", param.State.GetName())
    return &models.PostgresSourceNotificationOptions{
        ChannelName: channelName,
        ParseFn: func(n models.PostgresRawNotification) (map[string]any, error) {
            return map[string]any{
                "channel": n.Channel,
                "payload": n.Payload,
            }, nil
        },
    }, nil
}

func (c *IUseConnector) GenerateWAL(param *models.PostgresSourceWAL) (*models.PostgresSourceWALOptions, error) {
    slotName := fmt.Sprintf("%s_slot", param.State.GetName())
    publicationName := fmt.Sprintf("%s_pub", param.State.GetName())

    return &models.PostgresSourceWALOptions{
        SlotName:        slotName,
        OutputPlugin:    models.PostgresCDCTypePGOutput,
        Streaming:       true,
        PublicationName: publicationName,
        ParseFn: func(event models.PostgresChangeEvent) (map[string]any, error) {
            return map[string]any{
                "operation": string(event.Operation),
                "table":     event.Table,
                "position":  event.Position,
                "data":      event.After,
            }, nil
        },
    }, nil
}
```

## Destination Database Operations

PostgreSQL databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The PostgreSQL destination interface provides structured data loading operations:

```go
type IClientDBPostgresDest interface {
    GenerateQuery(param *models.PostgresDestQuery) ([]*models.PostgresDestQueryPayload, error)
    GenerateOptions(param *models.PostgresDestQuery) (*models.PostgresDestOptions, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and UPSERT operations with PostgreSQL-specific features
- **Batch Processing** - Receives a batch of records and returns one query payload per record
- **Options Generation** - Hook for destination-wide options (currently `PostgresDestOptions` carries no fields)

### Destination Configuration Structure

When using PostgreSQL as a destination, the system uses these struct definitions:

```go
// Destination operations
type PostgresDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type PostgresDestQueryPayload struct {
    Query string
    Value []any
}

type PostgresDestOptions struct{}
```

These structures manage:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` values (each wrapping a `Data` map) for transformation and loading
- **Connection Management** - Maintains auxiliary database connections for lookups
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.PostgresDestQuery) ([]*models.PostgresDestQueryPayload, error) {
    payloads := make([]*models.PostgresDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        cols := make([]string, 0, len(rec.Data))
        placeholders := make([]string, 0, len(rec.Data))
        updates := make([]string, 0, len(rec.Data))
        args := make([]any, 0, len(rec.Data))

        i := 1
        for k, v := range rec.Data {
            cols = append(cols, k)
            placeholders = append(placeholders, fmt.Sprintf("$%d", i))
            updates = append(updates, fmt.Sprintf("%s = EXCLUDED.%s", k, k))
            args = append(args, v)
            i++
        }

        query := fmt.Sprintf(
            `INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (id) DO UPDATE SET %s`,
            param.State.GetName(),
            strings.Join(cols, ", "),
            strings.Join(placeholders, ", "),
            strings.Join(updates, ", "),
        )

        payloads = append(payloads, &models.PostgresDestQueryPayload{
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

The system includes built-in functionality to cast generic database engine interfaces to specific PostgreSQL connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual PostgreSQL connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseConnInfo to PostgreSQL connection
pgConn, err := CastAsPostgresConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to PostgreSQL connection: %v", err)
}

// pgConn is of type models.DBConnector[*pgx.Conn] — unwrap the driver client
// via .Client
rows, err := pgConn.Client.Query(context.Background(), "SELECT 1")
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Capability Assertion** - Type-asserts the engine against the `IPostgresConnector` capability interface (`GetPostgresClient()`)
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to PostgreSQL-specific functionality including advanced features like WAL streaming and notification channels.
:::
