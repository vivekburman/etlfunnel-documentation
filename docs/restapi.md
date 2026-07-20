# REST API

REST APIs serve as flexible connectors in ETL pipelines, functioning both as sources for pulling data over HTTP and destinations for pushing records to external services. Our ETL tool supports pagination-based, cursor-based, and webhook-based source modes — plus a user-defined capture mode for full control — and HTTP-based destination writes.

## Source Operations

### Data Extraction Methods

The REST API source interface supports four extraction approaches:

```go
type IClientRESTAPISource interface {
    GeneratePaginateRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourcePaginateOptions, error)
    GenerateWebhookRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourceWebhookOptions, error)
    GenerateCursorRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourceCursorOptions, error)
    FetchRecords(param *models.RESTAPISourceFetch) <-chan *models.Record
}
```

- **Pagination** - Offset/token-based pagination; the engine injects `PageToken` per page and calls `NextPageToken` to advance
- **Cursor** - Cursor-based incremental extraction; the engine injects the cursor value and advances via `NextPageToken`
- **Webhook** - Starts a local HTTP listener; incoming POST requests are fed into the pipeline as records
- **Record Fetching** - User-defined mode giving full control over the HTTP client

### Source Configuration Structure

```go
type RESTAPISourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *http.Client
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

// RESTAPIRawResponse carries the raw HTTP response passed to ParseFn.
type RESTAPIRawResponse struct {
    Body       []byte
    Headers    http.Header
    StatusCode int
}

type RESTAPISourcePaginateOptions struct {
    Headers       map[string]string // nil/empty means no extra headers are added
    QueryParams   map[string]string // nil/empty means no extra query params are added
    Body          map[string]any    // for POST-based pagination; nil means no body is sent
    Method        string            // GET, POST — "" has no app default and is passed to http.NewRequestWithContext, which the Go stdlib treats as GET
    Path          string            // relative path, e.g. "/v1/reports" — no default, required
    PageToken     string            // injected by engine per page
    MaxPages      int               // 0 = unlimited
    ParseFn       func(RESTAPIRawResponse) ([]map[string]any, error) // required; the source errors if nil
    NextPageToken func(body []byte, headers http.Header) (string, bool) // required; the source errors if nil
}

type RESTAPISourceCursorOptions struct {
    Path          string // no default, required
    CursorParam   string // e.g. "since", "after", "start_date" — no default, used verbatim as the query-param key
    CursorValue   string // initial cursor value — "" is simply the initial value sent on the first request
    ParseFn       func(RESTAPIRawResponse) ([]map[string]any, error) // required; the source errors if nil
    NextPageToken func(body []byte, headers http.Header) (string, bool) // required; the source errors if nil
}

type RESTAPISourceWebhookOptions struct {
    ListenAddr       string // e.g. ":8081" — "" has no app default; passed to http.Server{Addr: ""}, which the Go stdlib defaults to ":http" (port 80)
    Path             string // e.g. "/webhook" — no default, required
    Secret           string // for HMAC verification — "" (the default) skips HMAC verification entirely; all requests are accepted
    RecordBufferSize int    // channel buffer size; 0 = unbuffered
    ParseFn          func(RESTAPIRawResponse) ([]map[string]any, error) // required; the source errors if nil
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source Connection** - `*http.Client` configured with auth transport and base URL
- **Auxiliary DB Connections** - Additional database connections for enrichment
- **ParseFn** - Controls how raw HTTP response bytes become pipeline records; the engine never decides the record shape
- **NextPageToken** - Controls pagination advance; return `("", false)` to signal the source is exhausted
- **Method** - Left as `""`, requests are sent as GET (the Go stdlib's treatment of an empty method) — there is no app-level default beyond that
- **MaxPages** - `0` means unlimited pages
- **Secret** (webhook) - `""` (the zero value) disables HMAC verification entirely, accepting all incoming requests
- **ListenAddr** (webhook) - `""` is passed straight to `http.Server{Addr: ""}`, which the Go stdlib binds to `:http` (port 80)

### Record Position Metadata

Pagination and cursor reads stamp each delivered record's `Meta` with the token/cursor value that fetched its page:

| Key | Constant | Description |
|-----|----------|--------------|
| `_restapi_page_token` | `models.MetaRESTAPIPageToken` | The `PageToken` that fetched the record's current page (pagination mode) |
| `_restapi_cursor` | `models.MetaRESTAPICursor` | The cursor value that fetched the record's current page (cursor mode) |

Like Cassandra's page state, this is page-granularity, not row-granularity: resuming a checkpoint hook with this value re-fetches the whole page from the top rather than risk skipping a row not yet delivered before a crash. Webhook reads never set either key — a webhook delivery has no pagination position to resume from.

### Example Source

```go
// Cursor-based incremental extraction
func (c *IUseConnector) GenerateCursorRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourceCursorOptions, error) {
    startCursor, _ := param.State.GetReplicaProps()["start_cursor"].(string)

    return &models.RESTAPISourceCursorOptions{
        Path:        "/api/v1/events?limit=200",
        CursorParam: "cursor",
        CursorValue: startCursor,
        ParseFn: func(raw models.RESTAPIRawResponse) ([]map[string]any, error) {
            var resp struct {
                Events     []map[string]any `json:"events"`
                NextCursor string           `json:"next_cursor"`
                HasMore    bool             `json:"has_more"`
            }
            if err := json.Unmarshal(raw.Body, &resp); err != nil {
                return nil, fmt.Errorf("unmarshal response: %w", err)
            }
            return resp.Events, nil
        },
        NextPageToken: func(body []byte, _ http.Header) (string, bool) {
            var resp struct {
                NextCursor string `json:"next_cursor"`
                HasMore    bool   `json:"has_more"`
            }
            json.Unmarshal(body, &resp)
            return resp.NextCursor, resp.HasMore
        },
    }, nil
}

// Offset-based pagination
func (c *IUseConnector) GeneratePaginateRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourcePaginateOptions, error) {
    return &models.RESTAPISourcePaginateOptions{
        Method:   "GET",
        Path:     "/api/v1/records",
        MaxPages: 0, // unlimited
        ParseFn: func(raw models.RESTAPIRawResponse) ([]map[string]any, error) {
            var resp struct {
                Data []map[string]any `json:"data"`
            }
            if err := json.Unmarshal(raw.Body, &resp); err != nil {
                return nil, fmt.Errorf("unmarshal response: %w", err)
            }
            return resp.Data, nil
        },
        NextPageToken: func(body []byte, headers http.Header) (string, bool) {
            var resp struct {
                NextPage string `json:"next_page_token"`
            }
            json.Unmarshal(body, &resp)
            return resp.NextPage, resp.NextPage != ""
        },
    }, nil
}

// Webhook listener
func (c *IUseConnector) GenerateWebhookRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourceWebhookOptions, error) {
    return &models.RESTAPISourceWebhookOptions{
        ListenAddr:       ":8080",
        Path:             "/webhook/events",
        Secret:           "my-webhook-secret",
        RecordBufferSize: 100,
        ParseFn: func(raw models.RESTAPIRawResponse) ([]map[string]any, error) {
            var events []map[string]any
            if err := json.Unmarshal(raw.Body, &events); err != nil {
                // single-object payload
                var single map[string]any
                if err2 := json.Unmarshal(raw.Body, &single); err2 != nil {
                    return nil, fmt.Errorf("parse webhook payload: %w", err2)
                }
                return []map[string]any{single}, nil
            }
            return events, nil
        },
    }, nil
}

func (c *IUseConnector) FetchRecords(param *models.RESTAPISourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)
    close(ch) // not used when Generate* methods are active
    return ch
}
```

## Destination Operations

### Data Publishing Capabilities

The REST API destination interface provides HTTP write operations:

```go
type IClientRESTAPIDest interface {
    GenerateQuery(param *models.RESTAPIDestQuery) ([]*models.RESTAPIDestQueryPayload, error)
    GenerateOptions(param *models.RESTAPIDestQuery) (*models.RESTAPIDestOptions, error)
}
```

This interface enables:

- **Per-record HTTP requests** - Method, path, headers, and body per record
- **Batch processing** - Receives a batch of records and returns one payload per HTTP request
- **One-time write tuning** - `GenerateOptions` runs once, before the pipeline starts consuming records

### Destination Configuration Structure

```go
// Destination operations
type RESTAPIDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type RESTAPIDestQueryPayload struct {
    Headers map[string]string // nil means no headers are sent
    Body    map[string]any    // nil means no body is sent
    Method  string            // POST, PUT, PATCH, DELETE — "" has no app default and is passed to http.NewRequestWithContext, which the Go stdlib treats as GET
    Path    string            // e.g. "/v1/events" — no default, required
}

// RESTAPIDestOptions has no settings today: ApplyOptions is a no-op regardless of content.
type RESTAPIDestOptions struct{}
```

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.RESTAPIDestQuery) ([]*models.RESTAPIDestQueryPayload, error) {
    payloads := make([]*models.RESTAPIDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        payloads = append(payloads, &models.RESTAPIDestQueryPayload{
            Method: "POST",
            Path:   "/api/v1/ingest",
            Headers: map[string]string{
                "Content-Type": "application/json",
            },
            Body: rec.Data,
        })
    }

    return payloads, nil
}

func (c *IUseConnector) GenerateOptions(param *models.RESTAPIDestQuery) (*models.RESTAPIDestOptions, error) {
    return nil, nil // no one-time write tuning needed
}
```

## Connection Casting

```go
// Cast IDatabaseEngine to HTTP client
httpClient, err := CastAsRESTAPIConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to REST API connection: %v", err)
}

// httpClient is of type *http.Client
```

:::tip Connection Casting
This automatically handles connection casting, allowing you to work with the generic database interface while maintaining access to the configured HTTP client (auth transport, base URL, timeouts) when required.
:::
