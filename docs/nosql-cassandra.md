# Cassandra

Apache Cassandra serves as a wide-column NoSQL component in ETL pipelines, functioning both as a source for CQL-based extraction and a destination for high-throughput writes. Our ETL tool provides Cassandra integration with CQL query mode, cursor-based pagination via page state, and a user-defined capture mode for full control.

## Source Operations

### Data Extraction Methods

The Cassandra source interface supports two extraction approaches:

```go
type IClientDBCassandraSource interface {
    GenerateCQLQuery(param *models.CassandraSourceQuery) (*models.CassandraSourceQueryTune, error)
    FetchRecords(param *models.CassandraSourceFetch) <-chan map[string]any
}
```

- **CQL Query** - Execute a CQL SELECT with configurable page size and continuation via page state tokens
- **Record Fetching** - User-defined capture mode providing full control over row iteration

### Source Configuration Structure

```go
type CassandraSourceQuery struct {
    State              IPipelineRuntimeState
    SourceDBConn       *gocql.Session
    AuxiliaryDBConnMap map[string]IDatabaseEngine
    DestDBConn         IDatabaseEngine
}

type CassandraSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *gocql.Session
    AuxiliaryDBConnMap map[string]IDatabaseEngine
    DestDBConn         IDatabaseEngine
}

// CassandraSourceQueryTune describes a CQL SELECT to execute against Cassandra.
// PageState is the continuation token returned by a previous page; leave nil for the first page.
type CassandraSourceQueryTune struct {
    Parameters []any
    PageState  []byte
    CQL        string
    PageSize   int
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source Connection** - GoCQL session instance for Cassandra queries
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for enrichment
- **PageState** - Opaque continuation token for cursor-based pagination across large result sets

### Example Source

```go
func (c *IUseConnector) GenerateCQLQuery(param *models.CassandraSourceQuery) (*models.CassandraSourceQueryTune, error) {
    cql := fmt.Sprintf(
        "SELECT * FROM %s WHERE status = ? ALLOW FILTERING",
        param.State.GetName(),
    )
    return &models.CassandraSourceQueryTune{
        CQL:        cql,
        Parameters: []any{"active"},
        PageSize:   500,
        PageState:  nil, // nil starts from the first page
    }, nil
}

func (c *IUseConnector) FetchRecords(param *models.CassandraSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

    go func() {
        defer close(ch)

        iter := param.SourceDBConn.Query(
            fmt.Sprintf("SELECT * FROM %s LIMIT 100", param.State.GetName()),
        ).Iter()

        row := map[string]interface{}{}
        for iter.MapScan(row) {
            record := make(map[string]any, len(row))
            for k, v := range row {
                record[k] = v
            }
            ch <- record
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
    GenerateQuery(param *models.CassandraDestQuery) ([]*models.CassandraDestQueryTune, error)
}
```

This interface enables:

- **Single CQL writes** - INSERT, UPDATE, DELETE with optional TTL and timestamp
- **Batch writes** - LOGGED or UNLOGGED BATCH statements for atomic or high-throughput bulk operations
- **Batch processing** - Receives a batch of records and returns one tune per record (or a BATCH tune for the whole set)

### Destination Configuration Structure

```go
// Destination operations
type CassandraDestQuery struct {
    State              IPipelineRuntimeState
    Records            []map[string]any
    SourceDBConn       IDatabaseEngine
    DestDBConn         *gocql.Session
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

// CassandraDestQueryTune describes a single CQL write statement.
// For BATCH operations set Operation to CassandraDestOpBatch and populate BatchStatements.
type CassandraDestQueryTune struct {
    Parameters      []any
    BatchStatements []*CassandraDestQueryTune // populated when Operation == BATCH
    CQL             string
    Operation       CassandraDestOperation
    TTL             int   // USING TTL <seconds>; 0 means no TTL
    Timestamp       int64 // USING TIMESTAMP <microseconds>; 0 means wall clock
    Logged          bool  // for BATCH: true = LOGGED (default), false = UNLOGGED
}

type CassandraDestOperation string

const (
    CassandraDestOpInsert CassandraDestOperation = "INSERT"
    CassandraDestOpUpdate CassandraDestOperation = "UPDATE"
    CassandraDestOpDelete CassandraDestOperation = "DELETE"
    CassandraDestOpBatch  CassandraDestOperation = "BATCH"
)
```

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.CassandraDestQuery) ([]*models.CassandraDestQueryTune, error) {
    tunes := make([]*models.CassandraDestQueryTune, 0, len(param.Records))

    for _, rec := range param.Records {
        cols := make([]string, 0, len(rec))
        placeholders := make([]string, 0, len(rec))
        args := make([]any, 0, len(rec))

        for k, v := range rec {
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

        tunes = append(tunes, &models.CassandraDestQueryTune{
            Operation:  models.CassandraDestOpInsert,
            CQL:        cql,
            Parameters: args,
            TTL:        86400, // 24-hour TTL; set 0 to disable
        })
    }

    return tunes, nil
}
```

#### Batch Write Example

Return a single `BATCH` tune to wrap all records in one atomic statement:

```go
func (c *IUseConnector) GenerateQuery(param *models.CassandraDestQuery) ([]*models.CassandraDestQueryTune, error) {
    stmts := make([]*models.CassandraDestQueryTune, 0, len(param.Records))

    for _, rec := range param.Records {
        stmts = append(stmts, &models.CassandraDestQueryTune{
            Operation:  models.CassandraDestOpInsert,
            CQL:        fmt.Sprintf("INSERT INTO %s (id, data) VALUES (?, ?)", param.State.GetName()),
            Parameters: []any{rec["id"], rec["data"]},
        })
    }

    return []*models.CassandraDestQueryTune{
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
// Cast IDatabaseEngine to Cassandra session
cassandraSession, err := CastAsCassandraDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Cassandra connection: %v", err)
}

// cassandraSession is of type *gocql.Session
```

:::tip Connection Casting
This automatically handles connection casting, allowing you to work with the generic database interface while maintaining access to Cassandra-specific functionality when required.
:::
