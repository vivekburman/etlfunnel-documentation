# Amazon Redshift

Amazon Redshift is AWS's cloud data warehouse and can act as both a source and a destination in an ETL pipeline. As a source it runs one SQL query per pipeline run (or a user-defined fetch); as a destination it accepts batched, templated writes the same way the SQL-family connectors do. It works with provisioned clusters and Redshift Serverless workgroups.

## Connection Configuration

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Host | Text | Yes | Endpoint host name of the cluster or serverless workgroup, **without** the port (for example `mycluster.abc123.us-east-1.redshift.amazonaws.com`) |
| Port | Number | Yes | TCP port, usually `5439` |
| Username | Text | Yes | Database user |
| Password | Password | No | Password for that user |
| Database | Text | Yes | Database to connect to |
| SSL Mode | Select | Yes | `disable`, `require`, `verify-ca` or `verify-full`. Redshift endpoints expect `require` or stricter |

:::info Plain PostgreSQL-protocol login
The connector logs in over the PostgreSQL wire protocol with a database user and password. It does not use the Redshift Data API or IAM database authentication, so the endpoint must be reachable on its port from the machine where the [runner](runner.md) executes the job (check security groups, VPC routing and the "publicly accessible" setting).
:::

## Source Database Operations

### Data Extraction Methods

```go
type IClientDBRedshiftSource interface {
    GenerateQuery(param *models.RedshiftSourceQuery) (*models.RedshiftSourceQueryOptions, error)
    FetchRecords(param *models.RedshiftSourceFetch) <-chan *models.Record
}
```

- **Query Generation** — returns one SQL statement that runs once per pipeline run
- **Record Fetching** — full control over data reading, streaming records one at a time via a channel, given the raw `*sql.DB` connection

Redshift has no change-data-capture mode. To load new data incrementally, filter in your query (for example on an `updated_at` column) and keep the high-water mark in a [checkpoint](checkpoint-hook.md).

### Source Configuration Structure

```go
type RedshiftSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type RedshiftSourceQueryOptions struct {
    Query string
}

type RedshiftSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *sql.DB
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}
```

`Query` is required and must be **exactly one SQL statement with literals instead of placeholders**.

### Example Source

```go
func (c *IUseConnector) GenerateQuery(param *models.RedshiftSourceQuery) (*models.RedshiftSourceQueryOptions, error) {
    query := fmt.Sprintf("SELECT * FROM %s WHERE created_at >= '2026-01-01'", param.State.GetName())
    return &models.RedshiftSourceQueryOptions{Query: query}, nil
}
```

### How Values Arrive

Each record has one key per column. Values arrive as follows:

| Redshift type | Arrives as |
|---|---|
| `SMALLINT`, `INTEGER`, `BIGINT` | number |
| `REAL`, `DOUBLE PRECISION` | number |
| `DECIMAL` / `NUMERIC` | **string** with every digit (`"12345678901234567890.1234567890"`); the value is not changed |
| `BOOLEAN` | `true` / `false` |
| `CHAR`, `VARCHAR` | string; `CHAR(n)` keeps its space padding |
| `DATE`, `TIMESTAMP`, `TIMESTAMPTZ` | timestamp (`"...Z"` in JSON) |
| `TIME` | a timestamp in year 0000; the engine does not reshape it, so use a [transformer](transformer-hook.md) |
| `TIMETZ` | string such as `"10:20:30+05:30"`, with the offset as the server returns it |
| `INTERVAL YEAR TO MONTH` | string such as `"1 year 2 mons"` |
| `SUPER` | **string** of the value's JSON text (`"{\"a\":1}"`); parse it in a transformer if you need the structure |
| `VARBYTE` | **string** of Redshift's hex text (`"616263"`), not decoded to bytes |
| NULL | `null` |

## Destination Database Operations

### Data Loading Capabilities

```go
type IClientDBRedshiftDest interface {
    GenerateQuery(param *models.RedshiftDestQuery) ([]*models.RedshiftDestQueryPayload, error)
    GenerateOptions(param *models.RedshiftDestQuery) (*models.RedshiftDestOptions, error)
}
```

- **Query Generation** — receives a batch of records and returns the statements to run, each with its bind values
- **Options Generation** — hook for destination-wide options. `RedshiftDestOptions` currently carries no fields, so `GenerateOptions` is not needed

All payloads returned for a batch run inside a **single transaction** (`BeginTx`/`Commit`). That includes any DDL or `COPY` statements you return. If one payload fails, the whole batch is rolled back, so either the batch lands or none of it does.

### Destination Configuration Structure

```go
type RedshiftDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type RedshiftDestQueryPayload struct {
    Query string
    Value []any
}

type RedshiftDestOptions struct{}
```

Bind values use **numbered placeholders**: `$1`, `$2`, ... (not `?`).

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.RedshiftDestQuery) ([]*models.RedshiftDestQueryPayload, error) {
    payloads := make([]*models.RedshiftDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        cols := make([]string, 0, len(rec.Data))
        placeholders := make([]string, 0, len(rec.Data))
        args := make([]any, 0, len(rec.Data))

        for k, v := range rec.Data {
            cols = append(cols, k)
            args = append(args, v)
            placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
        }

        query := fmt.Sprintf(
            "INSERT INTO %s (%s) VALUES (%s)",
            param.State.GetName(),
            strings.Join(cols, ", "),
            strings.Join(placeholders, ", "),
        )

        payloads = append(payloads, &models.RedshiftDestQueryPayload{
            Query: query,
            Value: args,
        })
    }

    return payloads, nil
}
```

:::tip Row-by-row inserts are slow on Redshift
Redshift is a columnar warehouse, and single-row `INSERT` statements are its slowest way to load data. For large volumes, return a multi-row `INSERT ... VALUES (...), (...)` per batch, or, if your data is already in S3, load it with a `COPY` statement returned as a payload.
:::

## Database Connection Casting

A Redshift connection reached through `AuxiliaryHub` can be cast to its real driver handle from a transformer or other hook:

```go
// Cast IDatabaseConnInfo to a Redshift connection
rsConn, err := CastAsRedshiftConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Redshift connection: %v", err)
}

// rsConn is of type models.DBConnector[*sql.DB] — unwrap the driver client via .Client
rows, err := rsConn.Client.QueryContext(ctx, "SELECT 1")
```

The casting function type-asserts the engine against the `IRedshiftConnector` capability interface (`GetRedshiftClient()`) and fails if the engine isn't connected yet.

## Errors and Observability

Redshift failures are logged with dedicated [EF codes](ef-codes.md):

| Code | Category |
|------|----------|
| `EF-E659` | Source: read/query error |
| `EF-E711` | Destination: commit/transaction error |
| `EF-E712` | Destination: write/execute error (the failing `query` is logged) |

A connection-level failure (network drop, timeout, refused or reset connection) is additionally classified as a connection error, which triggers the `EF-E301`–`EF-E306` connection handling and retry behavior rather than a plain read/write error.
