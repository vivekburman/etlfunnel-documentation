# Postgres

PostgreSQL databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive PostgreSQL integration capabilities, supporting multiple data extraction methods including advanced features like WAL streaming and notification systems.

## Source Database Operations

PostgreSQL databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The PostgreSQL source interface supports four primary extraction approaches through these interface methods:

```go
type IClientDBPostgresSource interface {
    FetchRecords(param *models.PostgresSourceFetch) <-chan map[string]any
    GenerateQuery(param *models.PostgresSourceQuery) (*models.PostgresSourceQueryTune, error)
    GenerateNotification(param *models.PostgresSourceNotification) (*models.PostgresSourceNotificationTune, error)
    GenerateWAL(param *models.PostgresSourceWAL) (*models.PostgresSourceWALTune, error)
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
    AuxiliaryDBConnMap map[string]IDatabaseEngine
    DestDBConn         IDatabaseEngine
}

type PostgresSourceQuery struct {
    State              IPipelineRuntimeState
    SourceDBConn       *pgx.Conn
    DestDBConn         IDatabaseEngine
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type PostgresSourceNotification struct {
    State              IPipelineRuntimeState
    SourceDBConn       *pgx.Conn
    DestDBConn         IDatabaseEngine
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type PostgresSourceWAL struct {
    State              IPipelineRuntimeState
    SourceDBConn       *pgx.Conn
    DestDBConn         IDatabaseEngine
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type PostgresSourceQueryTune struct {
    Query string
}

type PostgresSourceNotificationTune struct {
    ParseFn     func(PostgresRawNotification) (map[string]any, error)
    ChannelName string
}

type PostgresSourceWALTune struct {
    ParseFn         func(ChangeEvent) (map[string]any, error)
    SlotName        string
    OutputPlugin    PostgresCDCOutputPluginType
    PublicationName string
    Streaming       bool
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
- **Source DB Connection** - Direct PostgreSQL connection instance using pgx driver
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **WAL Configuration** - Advanced replication settings with support for multiple output plugins and a `ParseFn` for shaping change events into records
- **Notification Channels** - Real-time event processing with a `ParseFn` to transform raw payloads into records

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
func (c *IUseConnector) FetchRecords(param *models.PostgresSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

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
            ch <- record
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.PostgresSourceQuery) (*models.PostgresSourceQueryTune, error) {
    query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.State.GetName())
    return &models.PostgresSourceQueryTune{Query: query}, nil
}

func (c *IUseConnector) GenerateNotification(param *models.PostgresSourceNotification) (*models.PostgresSourceNotificationTune, error) {
    channelName := fmt.Sprintf("%s_changes", param.State.GetName())
    return &models.PostgresSourceNotificationTune{
        ChannelName: channelName,
        ParseFn: func(n models.PostgresRawNotification) (map[string]any, error) {
            return map[string]any{
                "channel": n.Channel,
                "payload": n.Payload,
            }, nil
        },
    }, nil
}

func (c *IUseConnector) GenerateWAL(param *models.PostgresSourceWAL) (*models.PostgresSourceWALTune, error) {
    slotName := fmt.Sprintf("%s_slot", param.State.GetName())
    publicationName := fmt.Sprintf("%s_pub", param.State.GetName())

    return &models.PostgresSourceWALTune{
        SlotName:        slotName,
        OutputPlugin:    models.PostgresCDCTypePGOutput,
        Streaming:       true,
        PublicationName: publicationName,
        ParseFn: func(event models.ChangeEvent) (map[string]any, error) {
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
    GenerateQuery(param *models.PostgresDestQuery) ([]*models.PostgresDestQueryTune, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and UPSERT operations with PostgreSQL-specific features
- **Batch Processing** - Receives a batch of records and returns one query tune per record

### Destination Configuration Structure

When using PostgreSQL as a destination, the system uses these struct definitions:

```go
// Destination operations
type PostgresDestQuery struct {
    State              IPipelineRuntimeState
    Records            []map[string]any
    SourceDBConn       IDatabaseEngine
    DestDBConn         *pgx.Conn
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type PostgresDestQueryTune struct {
    Query string
    Value []any
}
```

These structures manage:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of data records for transformation and loading
- **Connection Management** - Maintains source, destination, and auxiliary database connections using pgx driver
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.PostgresDestQuery) ([]*models.PostgresDestQueryTune, error) {
    tunes := make([]*models.PostgresDestQueryTune, 0, len(param.Records))

    for _, rec := range param.Records {
        cols := make([]string, 0, len(rec))
        placeholders := make([]string, 0, len(rec))
        updates := make([]string, 0, len(rec))
        args := make([]any, 0, len(rec))

        i := 1
        for k, v := range rec {
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

        tunes = append(tunes, &models.PostgresDestQueryTune{
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

The system includes built-in functionality to cast generic database engine interfaces to specific PostgreSQL connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual PostgreSQL connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to PostgreSQL connection
pgConn, err := CastAsPostgresDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to PostgreSQL connection: %v", err)
}

// Now you can use the underlying PostgreSQL connection directly
// pgConn is of type *pgx.Conn
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid PostgreSQL connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to PostgreSQL-specific functionality including advanced features like WAL streaming and notification channels.
:::
