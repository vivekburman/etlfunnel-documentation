# SOAP

SOAP serves as a connector in ETL pipelines, functioning both as a **source** that pages through an operation's response and as a **destination** that sends one request per record batch. It shares its HTTP transport and authentication (including OAuth2 and OAuth2 refresh-token) with the [REST API](./restapi) connector, wrapping each call in a SOAP 1.1 or 1.2 envelope.

## Source Operations

### Data Extraction Methods

```go
type IClientSOAPSource interface {
    GenerateQuery(param *models.SOAPSourceQuery) (*models.SOAPQueryOptions, error)
    FetchRecords(param *models.SOAPSourceFetch) <-chan *models.Record
}
```

- **Query** — sends a SOAP request body, optionally re-sending it with an advancing cursor placeholder to page
- **Record Fetching** — the user-defined capture mode, with the live `*http.Client` in your hands

### Source Configuration Structure

```go
type SOAPSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type SOAPSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *http.Client
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

// SOAPRawResponse carries the raw HTTP response passed to ParseFn.
type SOAPRawResponse struct {
    Headers    http.Header
    Body       []byte
    StatusCode int
}

type SOAPQueryOptions struct {
    Action            string                                                 // SOAPAction (1.1) / Content-Type action param (1.2)
    Body              string                                                 // the <soap:Body> inner XML; required
    HeaderXML         string                                                 // optional <soap:Header> inner XML
    Headers           map[string]string
    DataPath          string                                                 // dot path from Body to the repeated element, e.g. "GetOrdersResponse.Order"; required unless ParseFn is set
    CursorPlaceholder string                                                 // a token inside Body replaced with the cursor on each page; "" means a single request, no paging
    CursorPath        string                                                 // dot path from Body to the next-cursor element; required when CursorPlaceholder is set and NextPageToken is nil
    InitialCursor     string
    MaxPages          int                                                    // 0 = unlimited
    ParseFn           func(SOAPRawResponse) ([]map[string]any, error)        // optional; bypasses DataPath entirely when set
    NextPageToken     func(body []byte, headers http.Header) (string, bool)  // optional alternative to CursorPath
}
```

### How paging works

Leave `CursorPlaceholder` empty for a single request with no paging. Set it to page: `Body` must contain that placeholder string somewhere (the source errors at dispatch if it doesn't), and on each request the engine substitutes the current cursor — XML-escaped — in its place, starting from `InitialCursor`. After the response comes back, the next cursor is read from `CursorPath` (a plain text element under `Body`) unless `NextPageToken` is set, which reads it from the raw body/headers instead. Paging stops when the next cursor is empty or identical to the current one, or when `MaxPages` is reached.

Each element selected at `DataPath` becomes one row via its XML-to-map conversion: attributes become `@attr` keys, repeated child elements become a list, and a leaf with no children or attributes becomes its text. A fault in the response (`<soap:Fault>` / `<soap:Reason>`) is returned as an error before `DataPath` is evaluated — see [EF-E673](./ef-codes#ef-e6xx--source-connector-errors).

### Example Source

```go
func (c *IUseConnector) GenerateQuery(param *models.SOAPSourceQuery) (*models.SOAPQueryOptions, error) {
    return &models.SOAPQueryOptions{
        Action: "http://example.com/GetOrders",
        Body: `<GetOrders xmlns="http://example.com/">
            <PageToken>{{cursor}}</PageToken>
        </GetOrders>`,
        DataPath:          "GetOrdersResponse.Order",
        CursorPlaceholder: "{{cursor}}",
        CursorPath:        "GetOrdersResponse.NextPageToken",
    }, nil
}
```

Implement only the method for the capture mode you use; return an error from the other, as in the [Postgres](./sql-postgres) example.

### What a record looks like

Each element matched at `DataPath` (or each entry your `ParseFn` returns) becomes one record's `Data`. `Meta` carries the cursor that fetched the record's page under `models.MetaSOAPCursor` (`_soap_cursor`) for engine bookkeeping — resuming from it re-sends the whole page's request, the same page-granularity behavior as the REST API connector's position metadata.

## Destination Operations

```go
type IClientSOAPDest interface {
    GenerateQuery(param *models.SOAPDestQuery) ([]*models.SOAPDestQueryPayload, error)
    GenerateOptions(param *models.SOAPDestQuery) (*models.SOAPDestOptions, error)
}

type SOAPDestQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
    Records            []*Record
}

type SOAPDestQueryPayload struct {
    Action    string
    Body      string // the <soap:Body> inner XML; required
    HeaderXML string
    Headers   map[string]string
}

// SOAPDestOptions has no settings today: ApplyOptions is a no-op regardless of content.
type SOAPDestOptions struct{}
```

Return one payload per request. Payloads run **in order**; if one fails, the requests before it are already sent, that one and everything after it are marked failed/not-attempted, same as the REST API destination.

### Example Destination

```go
func (d *IUseConnector) GenerateQuery(param *models.SOAPDestQuery) ([]*models.SOAPDestQueryPayload, error) {
    out := make([]*models.SOAPDestQueryPayload, 0, len(param.Records))
    for _, r := range param.Records {
        out = append(out, &models.SOAPDestQueryPayload{
            Action: "http://example.com/UpdateOrder",
            Body: fmt.Sprintf(`<UpdateOrder xmlns="http://example.com/">
                <OrderID>%v</OrderID>
                <Status>%v</Status>
            </UpdateOrder>`, r.Data["id"], r.Data["status"]),
        })
    }
    return out, nil
}
```

## Connection Parameters

Set these on the hub (see [Connector Hub](./connector-hub#soap-connector)): endpoint URL, SOAP version (1.1 or 1.2, default 1.1), and the same auth options as [REST API](./connector-hub#rest-api-connector) — none, bearer, basic, API key, OAuth2 (client credentials), OAuth2 refresh-token, or custom.
