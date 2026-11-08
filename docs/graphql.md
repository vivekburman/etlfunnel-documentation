# GraphQL

GraphQL serves as a connector in ETL pipelines, functioning both as a **source** that pages through a query's results and as a **destination** that runs one mutation per record batch. It shares its HTTP transport and authentication (including OAuth2 and OAuth2 refresh-token) with the [REST API](./restapi) connector.

## Source Operations

### Data Extraction Methods

```go
type IClientGraphQLSource interface {
    GenerateQuery(param *models.GraphQLSourceQuery) (*models.GraphQLQueryOptions, error)
    FetchRecords(param *models.GraphQLSourceFetch) <-chan *models.Record
}
```

- **Query** — runs a GraphQL query, optionally paging through a `nodes`/`edges` connection by cursor
- **Record Fetching** — the user-defined capture mode, with the live `*http.Client` in your hands

### Source Configuration Structure

```go
type GraphQLSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type GraphQLSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *http.Client
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

// GraphQLRawResponse carries the raw HTTP response passed to ParseFn.
type GraphQLRawResponse struct {
    Headers    http.Header
    Body       []byte
    StatusCode int
}

type GraphQLQueryOptions struct {
    Query          string                                                 // required
    OperationName  string
    Variables      map[string]any
    Headers        map[string]string
    DataPath       string                                                 // e.g. "orders" or "data.orders"; required unless ParseFn is set
    CursorVariable string                                                 // name of the variable the engine sets to page forward; "" means a single request, no paging
    MaxPages       int                                                    // 0 = unlimited
    ParseFn        func(GraphQLRawResponse) ([]map[string]any, error)     // optional; bypasses DataPath entirely when set
    NextPageToken  func(body []byte, headers http.Header) (string, bool)  // optional; required alongside ParseFn when CursorVariable is set
}
```

### How paging works

Leave `CursorVariable` empty for a single request with no paging. Set it to page: on each page after the first, the engine assigns the latest cursor to that variable name in `Variables` and reissues the query.

Without `ParseFn`, the value at `DataPath` must be a **connection object** — `{ nodes: [...], pageInfo: { hasNextPage, endCursor } }` or `{ edges: [{ node: {...} }, ...], pageInfo: {...} }` — so select `pageInfo { hasNextPage endCursor }` in the query. A plain list at `DataPath` works only when `CursorVariable` is empty. With `ParseFn`, you decode the page yourself and supply `NextPageToken` to read the next cursor out of the raw body or headers; return `("", false)` once exhausted.

A response is rejected before any paging logic runs if it carries a top-level `errors` array ([EF-E670](./ef-codes#ef-e6xx--source-connector-errors)) — none of its (possibly partial) `data` is read.

### Example Source

```go
func (c *IUseConnector) GenerateQuery(param *models.GraphQLSourceQuery) (*models.GraphQLQueryOptions, error) {
    return &models.GraphQLQueryOptions{
        Query: `query Orders($after: String) {
            orders(first: 100, after: $after) {
                nodes { id status total }
                pageInfo { hasNextPage endCursor }
            }
        }`,
        DataPath:       "orders",
        CursorVariable: "after",
    }, nil
}
```

Implement only the method for the capture mode you use; return an error from the other, as in the [Postgres](./sql-postgres) example.

### What a record looks like

Each node under `DataPath` (or each entry your `ParseFn` returns) becomes one record's `Data`. `Meta` carries the cursor that fetched the record's page under `models.MetaGraphQLCursor` (`_graphql_cursor`) for engine bookkeeping — resuming from it re-fetches the whole page, the same page-granularity behavior as the REST API connector's position metadata.

## Destination Operations

```go
type IClientGraphQLDest interface {
    GenerateQuery(param *models.GraphQLDestQuery) ([]*models.GraphQLDestQueryPayload, error)
    GenerateOptions(param *models.GraphQLDestQuery) (*models.GraphQLDestOptions, error)
}

type GraphQLDestQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
    Records            []*Record
}

type GraphQLDestQueryPayload struct {
    Mutation      string         // required
    OperationName string
    Variables     map[string]any
    Headers       map[string]string
}

// GraphQLDestOptions has no settings today: ApplyOptions is a no-op regardless of content.
type GraphQLDestOptions struct{}
```

Return one payload per mutation call. Payloads run **in order**; if one fails, the mutations before it are already applied, that one and everything after it are marked failed/not-attempted, same as the REST API destination.

### Example Destination

```go
func (d *IUseConnector) GenerateQuery(param *models.GraphQLDestQuery) ([]*models.GraphQLDestQueryPayload, error) {
    out := make([]*models.GraphQLDestQueryPayload, 0, len(param.Records))
    for _, r := range param.Records {
        out = append(out, &models.GraphQLDestQueryPayload{
            Mutation: `mutation UpdateOrder($id: ID!, $status: String!) {
                updateOrder(id: $id, status: $status) { id }
            }`,
            Variables: map[string]any{
                "id":     r.Data["id"],
                "status": r.Data["status"],
            },
        })
    }
    return out, nil
}
```

## Connection Parameters

Set these on the hub (see [Connector Hub](./connector-hub#graphql-connector)): endpoint URL, and the same auth options as [REST API](./connector-hub#rest-api-connector) — none, bearer, basic, API key, OAuth2 (client credentials), OAuth2 refresh-token, or custom.
