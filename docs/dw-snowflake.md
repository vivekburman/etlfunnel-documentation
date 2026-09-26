# Snowflake

Snowflake is a cloud data warehouse and can act as both a source and a destination in an ETL pipeline. As a source it supports one-shot queries and Snowflake Streams (change tracking on a table); as a destination it accepts batched, templated writes the same way the SQL-family connectors do.

## Connection Configuration

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Account | Text | Yes | Snowflake account identifier |
| Username | Text | Yes | Snowflake username |
| Database | Text | Yes | Target database name |
| Schema | Text | Yes | Target schema name |
| Warehouse | Text | Yes | Virtual warehouse to run queries on |
| Role | Text | No | Role to assume for the session |
| Password | Password | No | Password — used when neither Private Key nor OAuth Token is set |
| Private Key | Text | No | Base64-encoded PKCS8 RSA private key, for key-pair (JWT) authentication |
| OAuth Token | Text | No | OAuth access token |

**Authentication precedence:** the connector picks exactly one authenticator per connection, in this order:

1. **Private Key** set → key-pair (JWT) authentication
2. else **OAuth Token** set → OAuth authentication
3. else → username/password authentication

Only one of Private Key, OAuth Token, or Password should be supplied; whichever comes first in that order wins.

## Source Database Operations

### Data Extraction Methods

The Snowflake source interface supports two extraction approaches:

```go
type IClientDBSnowflakeSource interface {
    FetchRecords(param *models.SnowflakeSourceFetch) <-chan *models.Record
    GenerateQuery(param *models.SnowflakeSourceQuery) (*models.SnowflakeSourceQueryOptions, error)
    GenerateStream(param *models.SnowflakeSourceStream) (*models.SnowflakeSourceStreamOptions, error)
}
```

- **Record Fetching** — full control over data reading, streaming records one at a time via a channel, given the raw `*sql.DB` connection
- **Query Generation** — one-shot SQL query, run once per pipeline run
- **Stream Generation** — reads from a [Snowflake Stream](https://docs.snowflake.com/en/user-guide/streams-intro) and advances its offset only once the destination has confirmed the rows

### Source Configuration Structure

```go
type SnowflakeSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *sql.DB
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type SnowflakeSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type SnowflakeSourceStream struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type SnowflakeSourceQueryOptions struct {
    Query string
}

type SnowflakeSourceStreamOptions struct {
    StreamName   string
    ConsumeTable string
}
```

:::info `ConsumeTable` is required
`SnowflakeSourceStreamOptions.ConsumeTable` must not be empty — `GenerateStream` returning an empty value fails the pipeline at startup with `SnowflakeSourceStreamOptions.ConsumeTable must not be empty`. It names any real table the stream is defined against (or another table in the same schema); the engine only ever runs `INSERT INTO <ConsumeTable> SELECT COUNT(*) FROM <StreamName>` against it as the mechanism that consumes the stream (see below), so its own contents don't matter.
:::

### How Stream Consumption Works

A Snowflake Stream's offset only advances when a transaction that reads it **and then writes to the table it's defined against** commits — reading the stream alone, even in a committed transaction, leaves the offset untouched. `ReadByStream` handles this by opening one transaction per read:

1. `SELECT * FROM <StreamName>` inside the transaction; every row is pushed to the destination as it's scanned.
2. Once every row from that read has reached the destination pipeline and been confirmed committed there, the engine issues `INSERT INTO <ConsumeTable> SELECT COUNT(*) FROM <StreamName>` — a write against `ConsumeTable` that both consumes the stream and commits the transaction.
3. If the destination never fully confirms (e.g. some rows permanently backlog) or the pipeline is cancelled first, the transaction is rolled back instead, so the stream's offset does **not** advance and those rows are re-read on the next run — no data is silently dropped.

This resolution is deferred and asynchronous with respect to the read loop itself: the read can finish sending rows to the channel well before the destination has confirmed all of them, and the commit/rollback decision only happens once confirmations catch up (or the pipeline shuts down without them ever catching up).

### Example Source

```go
func (c *IUseConnector) GenerateQuery(param *models.SnowflakeSourceQuery) (*models.SnowflakeSourceQueryOptions, error) {
    query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.State.GetName())
    return &models.SnowflakeSourceQueryOptions{Query: query}, nil
}

func (c *IUseConnector) GenerateStream(param *models.SnowflakeSourceStream) (*models.SnowflakeSourceStreamOptions, error) {
    return &models.SnowflakeSourceStreamOptions{
        StreamName:   fmt.Sprintf("%s_stream", param.State.GetName()),
        ConsumeTable: param.State.GetName(),
    }, nil
}
```

## Destination Database Operations

### Data Loading Capabilities

```go
type IClientDBSnowflakeDest interface {
    GenerateQuery(param *models.SnowflakeDestQuery) ([]*models.SnowflakeDestQueryPayload, error)
    GenerateOptions(param *models.SnowflakeDestQuery) (*models.SnowflakeDestOptions, error)
}
```

- **Query Generation** — receives a batch of records and returns one query payload per record
- **Options Generation** — hook for destination-wide options (currently `SnowflakeDestOptions` carries no fields)

Batched writes are flushed transactionally: all payloads returned for a batch run inside a single `BeginTx`/`Commit`, so either the whole batch lands or none of it does.

### Destination Configuration Structure

```go
type SnowflakeDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type SnowflakeDestQueryPayload struct {
    Query string
    Value []any
}

type SnowflakeDestOptions struct{}
```

:::warning Bind numbers as strings, not float64
The Snowflake Go driver (`gosnowflake` v1.19.1) formats a bound `float64` at `float32` precision, so only about 8 significant digits actually reach Snowflake. If a value needs to stay exact, bind it as a string rather than a raw `float64`.
:::

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.SnowflakeDestQuery) ([]*models.SnowflakeDestQueryPayload, error) {
    payloads := make([]*models.SnowflakeDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        cols := make([]string, 0, len(rec.Data))
        placeholders := make([]string, 0, len(rec.Data))
        args := make([]any, 0, len(rec.Data))

        for k, v := range rec.Data {
            cols = append(cols, k)
            placeholders = append(placeholders, "?")
            args = append(args, v)
        }

        query := fmt.Sprintf(
            "INSERT INTO %s (%s) VALUES (%s)",
            param.State.GetName(),
            strings.Join(cols, ", "),
            strings.Join(placeholders, ", "),
        )

        payloads = append(payloads, &models.SnowflakeDestQueryPayload{
            Query: query,
            Value: args,
        })
    }

    return payloads, nil
}
```

## Database Connection Casting

Like the other SQL-family connectors, a Snowflake connection reached through `AuxiliaryHub` can be cast to its real driver handle from a transformer or other hook:

```go
// Cast IDatabaseConnInfo to a Snowflake connection
sfConn, err := CastAsSnowflakeConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Snowflake connection: %v", err)
}

// sfConn is of type models.DBConnector[*sql.DB] — unwrap the driver client via .Client
rows, err := sfConn.Client.QueryContext(ctx, "SELECT 1")
```

The casting function type-asserts the engine against the `ISnowflakeConnector` capability interface (`GetSnowflakeClient()`) and fails if the engine isn't connected yet.

## Errors and Observability

Snowflake source/destination failures are logged with dedicated [EF codes](ef-codes.md):

| Code | Category |
|------|----------|
| `EF-E660` | Source: read/query error (`ReadByQuery`, and `ReadByStream` setup/scan/iteration failures) |
| `EF-E661` | Source: stream read error (transaction begin, consume-and-commit, rollback failures) |
| `EF-E713` | Destination: commit/transaction error |
| `EF-E714` | Destination: write/execute error |

A connection-level failure (network drop, session expiry, service unavailability) is additionally classified via `IsSnowflakeConnectionError`, which recognizes the relevant `gosnowflake.SnowflakeError` codes as well as generic closed-connection/DNS/network errors — this is what triggers `EF-E301`–`EF-E306`-style connection handling rather than a plain read/write error.
