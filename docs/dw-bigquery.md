# Google BigQuery

Google BigQuery is Google Cloud's serverless data warehouse and can act as both a source and a destination in an ETL pipeline. As a source it runs one SQL query per pipeline run, reads a table directly through the Storage Read API, or hands you the client for a custom fetch. As a destination it streams rows into existing tables, or loads files from Cloud Storage with a load job.

BigQuery has no TCP connection to hold open: the connector creates one client, and every query, insert and load job is an independent API call over it.

## Connection Configuration

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Project ID | Text | Yes | Google Cloud project that runs the jobs and is billed for them |
| Dataset | Text | Yes | Dataset the connector writes to by default |
| Location | Text | No | Location of query and load jobs, such as `US` or `asia-south1`. Empty lets BigQuery pick it from the tables a query names |
| Credentials | Select | Yes | **Service Account Key** or **Application Default Credentials** |
| Credentials JSON | Password | With Service Account Key | The full text of a service account key |
| Endpoint | Text | No | Base URL of an alternative API endpoint such as an emulator. A set endpoint without a service account key sends no credentials |

**Authentication.** Give exactly one of a service account key or Application Default Credentials (ADC). There is deliberately no key-file path option. With ADC, credentials come from the machine where the job runs (`GOOGLE_APPLICATION_CREDENTIALS`, `gcloud` login, or the attached service account), which is the [runner](runner.md) host, not the ETLFunnel server. A connection with neither is refused at connect time.

:::note Streaming inserts need billing
Streaming inserts (the default write mode) need a project with billing enabled. The BigQuery sandbox rejects them.
:::

### Required permissions

| Used for | IAM permission |
|---|---|
| Query source | `bigquery.jobs.create` on the project and read access on the tables queried |
| Storage API source | `bigquery.readsessions.create` on the project (the **BigQuery Read Session User** role), plus read access on the table |
| Streaming-insert destination | `bigquery.tables.updateData` on the target tables |
| Load-job destination | `bigquery.jobs.create`, write access on the target table, and read access on the Cloud Storage objects |

## Source Database Operations

### Data Extraction Methods

```go
type IClientDBBigQuerySource interface {
    GenerateQuery(param *models.BigQuerySourceQuery) (*models.BigQuerySourceQueryOptions, error)
    GenerateStorageRead(param *models.BigQuerySourceStorage) (*models.BigQuerySourceStorageOptions, error)
    FetchRecords(param *models.BigQuerySourceFetch) <-chan *models.Record
}
```

- **Query Generation** (**By Query**) — returns one standard SQL statement that runs once per pipeline run
- **Storage Read** (**By Storage API**) — reads a table directly through the BigQuery Storage Read API instead of a query job. Faster for large tables, and it avoids query-job cost
- **Record Fetching** (**By Custom Function**) — full control over data reading, streaming records one at a time via a channel, given the raw `*bigquery.Client`

BigQuery has no change-data-capture mode. To load new data incrementally, filter in your query (for example on a `TIMESTAMP` column) and keep the high-water mark in a [checkpoint](checkpoint-hook.md).

### Source Configuration Structure

```go
type BigQuerySourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type BigQuerySourceQueryOptions struct {
    Query string // required
}

type BigQuerySourceStorage struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type BigQuerySourceStorageOptions struct {
    TableID        string   // required: "table", "dataset.table" or "project.dataset.table"
    SelectedFields []string // columns to read; empty reads every column
    RowRestriction string   // SQL filter evaluated by BigQuery, e.g. "id > 100"; empty reads every row
}

type BigQuerySourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *bigquery.Client
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}
```

`Query` must be **exactly one standard SQL statement**, sent as written. A bare `TableID` is resolved in the connection's dataset.

### Example Source (query)

```go
func (c *IUseConnector) GenerateQuery(param *models.BigQuerySourceQuery) (*models.BigQuerySourceQueryOptions, error) {
    query := "SELECT order_id, amount, created_at FROM `my-project.sales.orders` WHERE created_at >= TIMESTAMP('2026-01-01')"
    return &models.BigQuerySourceQueryOptions{Query: query}, nil
}
```

### Example Source (Storage API)

```go
func (c *IUseConnector) GenerateStorageRead(param *models.BigQuerySourceStorage) (*models.BigQuerySourceStorageOptions, error) {
    return &models.BigQuerySourceStorageOptions{
        TableID:        "orders",
        SelectedFields: []string{"order_id", "amount", "created_at"},
        RowRestriction: "amount > 100",
    }, nil
}
```

:::info Storage read notes
One stream reads the table, so rows arrive in the table's storage order, which is not guaranteed to be any particular order. A table that does not exist, a missing `bigquery.readsessions.create` permission, or a restriction BigQuery rejects fails the run before any row is read (`EF-E663`). It never falls back to the query read.
:::

### How Values Arrive

Each record has one key per column. Values reach hooks as Go values:

| BigQuery type | Arrives as |
|---|---|
| `INT64` | `int64` (the maximum survives intact) |
| `FLOAT64` | `float64` |
| `NUMERIC`, `BIGNUMERIC` | exact `*big.Rat` |
| `BOOL` | `true` / `false` |
| `STRING` | string |
| `TIMESTAMP` | `time.Time` with microseconds |
| `DATE` | `civil.Date` (`cloud.google.com/go/civil`) |
| `DATETIME` | `civil.DateTime` |
| `TIME` | `civil.Time` |
| `BYTES` | `[]byte` |
| `JSON` | **string** of the document text; parse it in a [transformer](transformer-hook.md) if you need the structure |
| `STRUCT` | map keyed by field name |
| `ARRAY` | list |
| NULL | `null` |

## Destination Database Operations

### Data Loading Capabilities

```go
type IClientDBBigQueryDest interface {
    GenerateQuery(param *models.BigQueryDestQuery) ([]*models.BigQueryDestQueryPayload, error)
    GenerateOptions(param *models.BigQueryDestQuery) (*models.BigQueryDestOptions, error)
    GenerateLoadOpts(param *models.BigQueryLoadJobQuery) (*models.BigQueryLoadOpts, error)
}
```

- **Query Generation** — receives a batch of records and returns the rows to insert (streaming mode)
- **Options Generation** — destination-wide options such as the write mode
- **Load Options Generation** — used only with `WriteMode: "load-job"`; returns the load job to run

### Destination Configuration Structure

```go
type BigQueryDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type BigQueryDestQueryPayload struct {
    TableID  string         // table in the connection's dataset; must already exist
    Row      map[string]any // keyed by column name; a nested record is a map, a repeated column a list
    InsertID string         // optional; best-effort de-duplication when non-empty
}

type BigQueryDestOptions struct {
    WriteMode           string // "streaming" (default, also empty) or "load-job"
    SkipInvalidRows     bool   // true commits the valid rows and fails only the invalid ones
    IgnoreUnknownValues bool   // true drops values that match no column
}

type BigQueryLoadJobQuery struct {
    State   IPipelineRuntimeState
    Records []*models.Record
}

type BigQueryLoadOpts struct {
    TableID          string
    SourceFormat     string   // e.g. "CSV", "NEWLINE_DELIMITED_JSON", "AVRO", "PARQUET"
    WriteDisposition string   // "WRITE_APPEND", "WRITE_TRUNCATE" or "WRITE_EMPTY"; empty uses BigQuery's default
    SourceURIs       []string // gs://bucket/object URIs
    AutoDetectSchema bool
}
```

### Streaming inserts (default)

Payloads are grouped by `TableID`, and each table gets one streaming insert. The table **must already exist**; the connector does not create it.

:::warning Invalid rows reject the whole call
Without `SkipInvalidRows`, one invalid row rejects the whole insert call for its table: that row fails with its reason, the other rows fail with reason `stopped`, and nothing is written. With `SkipInvalidRows: true` the valid rows commit and only the invalid ones fail. Tables are independent: a failure in one table's group does not stop the others.
:::

A `*big.Rat` in `Row` (what the BigQuery source emits for `NUMERIC` and `BIGNUMERIC`) is written as an exact decimal at any depth of the row. Rows that share an `InsertID` are de-duplicated by BigQuery on a best-effort basis.

### Example Destination (streaming)

```go
func (c *IUseConnector) GenerateQuery(param *models.BigQueryDestQuery) ([]*models.BigQueryDestQueryPayload, error) {
    payloads := make([]*models.BigQueryDestQueryPayload, 0, len(param.Records))
    for _, rec := range param.Records {
        payloads = append(payloads, &models.BigQueryDestQueryPayload{
            TableID:  "orders",
            Row:      rec.Data,
            InsertID: fmt.Sprint(rec.Data["order_id"]),
        })
    }
    return payloads, nil
}

func (c *IUseConnector) GenerateOptions(param *models.BigQueryDestQuery) (*models.BigQueryDestOptions, error) {
    return &models.BigQueryDestOptions{SkipInvalidRows: true}, nil
}
```

### Load jobs

Set `WriteMode: "load-job"` to load files already in Cloud Storage instead of streaming rows. The records the destination receives are listings of Cloud Storage objects, such as a [GCS source](gcs.md) emits (`bucket` and `name`). `GenerateLoadOpts` turns them into the load job. `GenerateQuery` is still required by the pipeline but is not called in this mode.

```go
func (c *IUseConnector) GenerateOptions(param *models.BigQueryDestQuery) (*models.BigQueryDestOptions, error) {
    return &models.BigQueryDestOptions{WriteMode: "load-job"}, nil
}

func (c *IUseConnector) GenerateLoadOpts(param *models.BigQueryLoadJobQuery) (*models.BigQueryLoadOpts, error) {
    uris := make([]string, 0, len(param.Records))
    for _, rec := range param.Records {
        uris = append(uris, fmt.Sprintf("gs://%s/%s", rec.Data["bucket"], rec.Data["name"]))
    }
    return &models.BigQueryLoadOpts{
        TableID:          "orders",
        SourceFormat:     "PARQUET",
        WriteDisposition: "WRITE_APPEND",
        SourceURIs:       uris,
    }, nil
}
```

A load that fails (malformed file, schema mismatch, missing object) returns a failed batch with an error and loads nothing (`EF-E718`).

## Database Connection Casting

A BigQuery connection reached through `AuxiliaryHub` can be cast to its client from a transformer or other hook:

```go
// Cast IDatabaseConnInfo to a BigQuery connection
bqConn, err := CastAsBigQueryConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to BigQuery connection: %v", err)
}

// bqConn is of type models.DBConnector[*bigquery.Client] — unwrap the client via .Client
it, err := bqConn.Client.Query("SELECT 1").Read(ctx)
```

The casting function type-asserts the engine against the `IBigQueryConnector` capability interface (`GetBigQueryClient()`) and fails if the engine isn't connected yet. The `cloud.google.com/go/bigquery` package and `google.golang.org/api/iterator` are available to hooks. Do not close the client: the engine owns it.

## Errors and Observability

BigQuery failures are logged with dedicated [EF codes](ef-codes.md):

| Code | Category |
|------|----------|
| `EF-E662` | Source: query error (syntax error, missing table, no permission) |
| `EF-E663` | Source: Storage API read error |
| `EF-E715` | Destination: streaming insert error |
| `EF-E718` | Destination: load job error |

A failed query is not treated as a connection error. A network-level failure (timeout, refused or reset connection, unavailable service) is additionally classified as a connection error, which triggers the `EF-E301`–`EF-E306` connection handling and retry behavior.
