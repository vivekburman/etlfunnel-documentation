# Google Cloud Storage

Google Cloud Storage (GCS) can act as both a source and a destination in an ETL pipeline. It is an object store, not a database, so it works differently from the SQL connectors:

- **As a source** it *lists* objects under a prefix. Each object becomes one record describing the object (bucket, name, size, updated). **The object's contents are not read.**
- **As a destination** it *writes objects*: every payload you return is one object.

It works with Google Cloud Storage and with emulators such as fake-gcs-server.

## Connection Configuration

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Credentials | Select | Yes | **Service Account Key** or **Application Default Credentials** |
| Credentials JSON | Password | With Service Account Key | The full text of a service account key |
| Endpoint | Text | No | Base URL of an alternative API endpoint such as fake-gcs-server. A set endpoint without a service account key sends no credentials |

**Authentication.** Give exactly one of a service account key or Application Default Credentials (ADC). There is deliberately no key-file path option. A connection with neither is refused at connect time.

:::info Where ADC resolves
With ADC, credentials come from the machine where the job runs (`GOOGLE_APPLICATION_CREDENTIALS`, `gcloud` login, or the attached service account), which is the [runner](runner.md) host, not the ETLFunnel server.
:::

### Required permissions

| Used as | IAM permission |
|---|---|
| Source | `storage.objects.list` on the bucket |
| Destination | `storage.objects.create` on the bucket (and `storage.objects.delete` to overwrite an existing object) |

## Source Operations

### Data Extraction Methods

```go
type IClientDBGCSSource interface {
    GeneratePrefixScan(param *models.GCSSourcePrefixScan) (*models.GCSSourcePrefixOptions, error)
    FetchRecords(param *models.GCSSourceFetch) <-chan *models.Record
}
```

- **Prefix Scan** — lists the objects under a bucket prefix. Select the **By Prefix** data processing strategy
- **Record Fetching** (**By Custom Function**) — full control: stream records yourself through a channel, given the raw `*storage.Client`. Use this to read object contents

### Source Configuration Structure

```go
type GCSSourcePrefixScan struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type GCSSourcePrefixOptions struct {
    Bucket     string // required
    Prefix     string // only names beginning with this are listed; empty lists the whole bucket
    MaxResults int32  // stops the listing after this many objects; 0 lists every object
}

type GCSSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *storage.Client
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}
```

:::note `MaxResults` is a limit
Unlike the [S3](s3.md) `MaxKeys` page size, `MaxResults` **stops the listing** after that many objects. Use `0` to list everything under the prefix.
:::

### Example Source

```go
func (c *IUseConnector) GeneratePrefixScan(param *models.GCSSourcePrefixScan) (*models.GCSSourcePrefixOptions, error) {
    return &models.GCSSourcePrefixOptions{
        Bucket: "my-data-lake",
        Prefix: "logs/2026/",
    }, nil
}
```

### Record Shape

One record per object, with these fields:

| Field | Type | Description |
|---|---|---|
| `bucket` | string | Bucket name |
| `name` | string | Full object name |
| `size` | integer | Size in bytes |
| `updated` | string | UTC timestamp, for example `"2026-01-02T03:04:05Z"` |

Matching is by plain string prefix, so `logs/2026` also matches `logs/2026-archive/...`. Add a trailing slash (`logs/2026/`) to match only that folder.

### Reading Object Contents

The prefix scan gives you the *list* of objects. To read what is inside them, use `FetchRecords` with the `*storage.Client` it provides. To load the listed files into BigQuery without reading them yourself, feed a GCS source into a [BigQuery load job](dw-bigquery.md#load-jobs).

## Destination Operations

### Data Loading Capabilities

```go
type IClientDBGCSDest interface {
    GenerateQuery(param *models.GCSDestQuery) ([]*models.GCSDestQueryPayload, error)
    GenerateOptions(param *models.GCSDestQuery) (*models.GCSDestOptions, error)
}
```

- **Query Generation** — receives a batch of records and returns the objects to write
- **Options Generation** — `GCSDestOptions` carries no fields, so `GenerateOptions` is not needed

### Destination Configuration Structure

```go
type GCSDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type GCSDestQueryPayload struct {
    Bucket string // must already exist
    Key    string // object name; an existing object with this name is overwritten
    Body   []byte // empty or nil writes an empty object
}

type GCSDestOptions struct{}
```

:::warning Uploads are not transactional
Payloads are uploaded **in order, and each upload commits on its own**. If one fails, the objects before it stay written and the ones after it are not attempted. Use deterministic names (for example a batch number or a hash of the content) so a retry overwrites the same objects instead of duplicating them.
:::

### Example Destination

This writes each batch as one JSON Lines object:

```go
func (c *IUseConnector) GenerateQuery(param *models.GCSDestQuery) ([]*models.GCSDestQueryPayload, error) {
    var buf bytes.Buffer
    enc := json.NewEncoder(&buf)
    for _, rec := range param.Records {
        if err := enc.Encode(rec.Data); err != nil {
            return nil, err
        }
    }

    key := fmt.Sprintf("exports/%s/%d.jsonl", param.State.GetName(), time.Now().UnixNano())
    return []*models.GCSDestQueryPayload{
        {Bucket: "my-data-lake", Key: key, Body: buf.Bytes()},
    }, nil
}
```

## Connection Casting

A GCS connection reached through `AuxiliaryHub` can be cast to its client from a transformer or other hook:

```go
// Cast IDatabaseConnInfo to a GCS connection
gcsConn, err := CastAsGCSConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to GCS connection: %v", err)
}

// gcsConn is of type models.DBConnector[*storage.Client] — unwrap the client via .Client
r, err := gcsConn.Client.Bucket(bucket).Object(name).NewReader(ctx)
```

The casting function type-asserts the engine against the `IGCSConnector` capability interface (`GetGCSClient()`) and fails if the engine isn't connected yet. The `cloud.google.com/go/storage` package and `google.golang.org/api/iterator` are available to hooks. Do not close the client: the engine owns it.

## Errors and Observability

GCS failures are logged with dedicated [EF codes](ef-codes.md):

| Code | Category |
|------|----------|
| `EF-E657` | Source: dispatch/config error (unknown capture method, or your `GeneratePrefixScan` hook returned an error) |
| `EF-E658` | Source: list/read error. A bucket that can't be listed (missing, or no permission) ends the run as a failure at the source stage |
| `EF-E717` | Destination: upload error (the bucket and name that failed are logged) |

A bucket that can't be listed is not treated as a connection error. A network-level failure (timeout, refused or reset connection, unavailable service) is additionally classified as a connection error, which triggers the `EF-E301`–`EF-E306` connection handling.
