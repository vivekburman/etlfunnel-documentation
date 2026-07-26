# Cassandra

Apache Cassandra serves as a wide-column NoSQL component in ETL pipelines, functioning both as a source for CQL-based extraction and a destination for high-throughput writes. Our ETL tool provides Cassandra integration with CQL query mode, cursor-based pagination via page state, and a user-defined capture mode for full control.

## Source Operations

### Data Extraction Methods

The Cassandra source interface supports two extraction approaches:

```go
type IClientDBCassandraSource interface {
    GenerateCQLQuery(param *models.CassandraSourceQuery) (*models.CassandraSourceQueryOptions, error)
    FetchRecords(param *models.CassandraSourceFetch) <-chan *models.Record
}
```

- **CQL Query** - Execute a CQL SELECT with configurable page size and continuation via page state tokens
- **Record Fetching** - User-defined capture mode providing full control over row iteration

### Source Configuration Structure

```go
type CassandraSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type CassandraSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *gocql.Session
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

// CassandraSourceQueryOptions describes a CQL SELECT to execute against Cassandra.
// PageState is the continuation token returned by a previous page; leave nil for the first page.
type CassandraSourceQueryOptions struct {
    Parameters []any
    PageState  []byte
    CQL        string
    PageSize   int
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source Connection** - GoCQL session instance for Cassandra queries, available on `CassandraSourceFetch` (used by the user-defined capture mode)
- **Auxiliary DB Connections** - Additional database connections for enrichment
- **PageState** - Opaque continuation token for cursor-based pagination across large result sets

### Record Position Metadata

Query reads stamp each delivered record's `Meta` with the page state that fetched its page:

| Key | Constant | Description |
|-----|----------|--------------|
| `_cassandra_page_state` | `models.MetaCassandraPageState` | The `PageState` that fetched the record's current page |

This is page-granularity, not row-granularity: gocql only hands back a page state per page fetched, so the value is deliberately lagged by one page boundary rather than using the iterator's own (already-advanced) next-page state. Resuming a checkpoint hook with this value re-fetches the whole page from the top — safe against duplicates, but it means a resume never skips a row that hadn't been delivered yet before a crash.

### Example Source

```go
func (c *IUseConnector) GenerateCQLQuery(param *models.CassandraSourceQuery) (*models.CassandraSourceQueryOptions, error) {
    cql := fmt.Sprintf(
        "SELECT * FROM %s WHERE status = ? ALLOW FILTERING",
        param.State.GetName(),
    )
    return &models.CassandraSourceQueryOptions{
        CQL:        cql,
        Parameters: []any{"active"},
        PageSize:   500,
        PageState:  nil, // nil starts from the first page
    }, nil
}

func (c *IUseConnector) FetchRecords(param *models.CassandraSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        iter := param.SourceDBConn.Query(
            fmt.Sprintf("SELECT * FROM %s LIMIT 100", param.State.GetName()),
        ).Iter()

        row := map[string]interface{}{}
        for iter.MapScan(row) {
            data := make(map[string]any, len(row))
            for k, v := range row {
                data[k] = v
            }
            ch <- &models.Record{Data: data}
            row = map[string]interface{}{}
        }

        if err := iter.Close(); err != nil {
            log.Println("cassandra iter error:", err)
        }
    }()

    return ch
}
```

## Destination Operations

### Data Loading Capabilities

The Cassandra destination interface provides structured write operations:

```go
type IClientDBCassandraDest interface {
    GenerateQuery(param *models.CassandraDestQuery) ([]*models.CassandraDestQueryPayload, error)
    GenerateOptions(param *models.CassandraDestQuery) (*models.CassandraDestOptions, error)
}
```

This interface enables:

- **Single CQL writes** - INSERT, UPDATE, DELETE with optional TTL and timestamp
- **Batch writes** - LOGGED or UNLOGGED BATCH statements for atomic or high-throughput bulk operations
- **Batch processing** - Receives a batch of records and returns one payload per record (or a BATCH payload for the whole set)
- **Batching controls** - `GenerateOptions` returns `CassandraDestOptions`, capping how many same-partition payloads are folded into one physical CQL BATCH and how many partition groups execute concurrently

### Destination Configuration Structure

```go
// Destination operations
type CassandraDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

// CassandraDestQueryPayload describes a single CQL write statement.
// For BATCH operations set Operation to CassandraDestOpBatch and populate BatchStatements.
type CassandraDestQueryPayload struct {
    Parameters      []any
    BatchStatements []*CassandraDestQueryPayload // populated when Operation == BATCH
    CQL             string
    Operation       CassandraDestOperation
    TTL             int   // USING TTL <seconds>; 0 means no TTL
    Timestamp       int64 // USING TIMESTAMP <microseconds>; 0 means wall clock
    Logged          bool  // for BATCH: true = LOGGED (default), false = UNLOGGED
    // PartitionKey is required when Operation != BATCH. Payloads sharing the
    // same PartitionKey value are safe to fold into one physical CQL BATCH
    // and are what the engine groups by when executing. Payloads with
    // Operation == BATCH are already a fully-formed atomic unit via
    // BatchStatements and don't need it.
    PartitionKey any
}

type CassandraDestOperation string

const (
    CassandraDestOpInsert CassandraDestOperation = "INSERT"
    CassandraDestOpUpdate CassandraDestOperation = "UPDATE"
    CassandraDestOpDelete CassandraDestOperation = "DELETE"
    CassandraDestOpBatch  CassandraDestOperation = "BATCH"
)

// CassandraDestOptions is returned by GenerateOptions.
type CassandraDestOptions struct {
    // MaxBatchStatements caps how many payloads sharing a PartitionKey are
    // folded into one physical CQL BATCH. Defaults to 32 when <= 0.
    MaxBatchStatements int
    // Concurrency caps how many distinct PartitionKey groups execute in
    // parallel within one flush. Defaults to 1 (sequential) when <= 0.
    Concurrency int
}
```

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.CassandraDestQuery) ([]*models.CassandraDestQueryPayload, error) {
    payloads := make([]*models.CassandraDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        cols := make([]string, 0, len(rec.Data))
        placeholders := make([]string, 0, len(rec.Data))
        args := make([]any, 0, len(rec.Data))

        for k, v := range rec.Data {
            cols = append(cols, k)
            placeholders = append(placeholders, "?")
            args = append(args, v)
        }

        cql := fmt.Sprintf(
            "INSERT INTO %s (%s) VALUES (%s)",
            param.State.GetName(),
            strings.Join(cols, ", "),
            strings.Join(placeholders, ", "),
        )

        payloads = append(payloads, &models.CassandraDestQueryPayload{
            Operation:    models.CassandraDestOpInsert,
            CQL:          cql,
            Parameters:   args,
            TTL:          86400, // 24-hour TTL; set 0 to disable
            PartitionKey: rec.Data["id"],
        })
    }

    return payloads, nil
}

func (c *IUseConnector) GenerateOptions(param *models.CassandraDestQuery) (*models.CassandraDestOptions, error) {
    return &models.CassandraDestOptions{
        MaxBatchStatements: 32,
        Concurrency:        4,
    }, nil
}
```

#### Batch Write Example

Return a single `BATCH` tune to wrap all records in one atomic statement:

```go
func (c *IUseConnector) GenerateQuery(param *models.CassandraDestQuery) ([]*models.CassandraDestQueryPayload, error) {
    stmts := make([]*models.CassandraDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        stmts = append(stmts, &models.CassandraDestQueryPayload{
            Operation:  models.CassandraDestOpInsert,
            CQL:        fmt.Sprintf("INSERT INTO %s (id, data) VALUES (?, ?)", param.State.GetName()),
            Parameters: []any{rec.Data["id"], rec.Data["data"]},
        })
    }

    return []*models.CassandraDestQueryPayload{
        {
            Operation:       models.CassandraDestOpBatch,
            BatchStatements: stmts,
            Logged:          false, // UNLOGGED for higher throughput
        },
    }, nil
}
```

## Connection Casting

```go
// Cast IDatabaseConnInfo to Cassandra session
cassandraConn, err := CastAsCassandraConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Cassandra connection: %v", err)
}

// cassandraConn is of type models.DBConnector[*gocql.Session] — unwrap the
// underlying session via .Client
iter := cassandraConn.Client.Query("SELECT * FROM keyspace.table").Iter()
```

:::tip Connection Casting
This automatically handles connection casting, allowing you to work with the generic database interface while maintaining access to Cassandra-specific functionality when required.
:::
