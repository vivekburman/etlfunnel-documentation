# REST API

REST APIs serve as flexible connectors in ETL pipelines, functioning both as sources for pulling data over HTTP and destinations for pushing records to external services. Our ETL tool supports pagination-based, cursor-based, and webhook-based source modes — plus a user-defined capture mode for full control — and HTTP-based destination writes.

## Source Operations

### Data Extraction Methods

The REST API source interface supports four extraction approaches:

```go
type IClientRESTAPISource interface {
    GeneratePaginateRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourcePaginateTune, error)
    GenerateWebhookRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourceWebhookTune, error)
    GenerateCursorRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourceCursorTune, error)
    FetchRecords(param *models.RESTAPISourceFetch) <-chan map[string]any
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
    DestDBConn         IDatabaseEngine
}

// RESTAPIRawResponse carries the raw HTTP response passed to ParseFn.
type RESTAPIRawResponse struct {
    Body       []byte
    Headers    http.Header
    StatusCode int
}

type RESTAPISourcePaginateTune struct {
    Headers       map[string]string
    QueryParams   map[string]string
    Body          map[string]any // for POST-based pagination
    Method        string         // GET, POST
    Path          string         // relative path, e.g. "/v1/reports"
    PageToken     string         // injected by engine per page
    MaxPages      int            // 0 = unlimited
    ParseFn       func(RESTAPIRawResponse) ([]map[string]any, error)
    NextPageToken func(body []byte, headers http.Header) (string, bool)
}

type RESTAPISourceCursorTune struct {
    Path          string
    CursorParam   string // e.g. "since", "after", "start_date"
    CursorValue   string // initial cursor value
    ParseFn       func(RESTAPIRawResponse) ([]map[string]any, error)
    NextPageToken func(body []byte, headers http.Header) (string, bool)
}

type RESTAPISourceWebhookTune struct {
    ListenAddr       string // e.g. ":8081"
    Path             string // e.g. "/webhook"
    Secret           string // for HMAC verification
    RecordBufferSize int    // channel buffer size; 0 = unbuffered
    ParseFn          func(RESTAPIRawResponse) ([]map[string]any, error)
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source Connection** - `*http.Client` configured with auth transport and base URL
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for enrichment
- **ParseFn** - Controls how raw HTTP response bytes become pipeline records; the engine never decides the record shape
- **NextPageToken** - Controls pagination advance; return `("", false)` to signal the source is exhausted

### Example Source

```go
// Cursor-based incremental extraction
func (c *IUseConnector) GenerateCursorRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourceCursorTune, error) {
    startCursor, _ := param.State.GetReplicaProps()["start_cursor"].(string)

    return &models.RESTAPISourceCursorTune{
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
func (c *IUseConnector) GeneratePaginateRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourcePaginateTune, error) {
    return &models.RESTAPISourcePaginateTune{
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
func (c *IUseConnector) GenerateWebhookRequest(param *models.RESTAPISourceFetch) (*models.RESTAPISourceWebhookTune, error) {
    return &models.RESTAPISourceWebhookTune{
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

func (c *IUseConnector) FetchRecords(param *models.RESTAPISourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)
    close(ch) // not used when Generate* methods are active
    return ch
}
```

## Destination Operations

### Data Publishing Capabilities

The REST API destination interface provides HTTP write operations:

```go
type IClientRESTAPIDest interface {
    GenerateQuery(param *models.RESTAPIDestQuery) ([]*models.RESTAPIDestQueryTune, error)
}
```

This interface enables:

- **Per-record HTTP requests** - Method, path, headers, and body per record
- **Batch processing** - Receives a batch of records and returns one tune per HTTP request

### Destination Configuration Structure

```go
// Destination operations
type RESTAPIDestQuery struct {
    State              IPipelineRuntimeState
    Records            []map[string]any
    SourceDBConn       IDatabaseEngine
    DestDBConn         *http.Client
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type RESTAPIDestQueryTune struct {
    Headers map[string]string
    Body    map[string]any
    Method  string // POST, PUT, PATCH, DELETE
    Path    string // e.g. "/v1/events"
}
```

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.RESTAPIDestQuery) ([]*models.RESTAPIDestQueryTune, error) {
    tunes := make([]*models.RESTAPIDestQueryTune, 0, len(param.Records))

    for _, rec := range param.Records {
        tunes = append(tunes, &models.RESTAPIDestQueryTune{
            Method: "POST",
            Path:   "/api/v1/ingest",
            Headers: map[string]string{
                "Content-Type": "application/json",
            },
            Body: rec,
        })
    }

    return tunes, nil
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
