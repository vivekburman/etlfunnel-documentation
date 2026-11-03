# Qdrant

Qdrant is a vector database. In a pipeline it works as a **source** that reads points by scroll, by ID, or by vector search, and as a **destination** that writes points — vectors and payload — in batches grouped by collection.

## Source Operations

### Data Extraction Methods

```go
type IClientDBQdrantSource interface {
    FetchRecords(param *models.QdrantSourceFetch) <-chan *models.Record
    GenerateQuery(request *models.QdrantSourceQuery) (*models.QdrantQueryOptions, error)
}
```

- **Query** returns a `QdrantQueryOptions` describing a scroll, a get-by-ID, or a vector search.
- **Record Fetching** is the user-defined capture mode, with the live `*qdrant.Client` in your hands.

### Source Configuration Structure

```go
type QdrantSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type QdrantSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *qdrant.Client
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type QdrantQueryOptions struct {
    Collection     string
    QueryType      QdrantQueryType // SCROLL, GET or SEARCH
    Match          map[string]any  // field = value equality, ANDed together
    Filter         *qdrant.Filter  // a raw Qdrant filter; ANDed with Match if both are set
    OmitPayload    bool
    WithVectors    bool
    PageSize       uint32    // SCROLL only; default 256
    Limit          uint64    // SCROLL: total points to emit; SEARCH: result count, default 10
    PointIDs       []any     // GET only; required — unsigned integers or UUID strings
    Vector         []float32 // SEARCH only; required
    VectorName     string    // SEARCH only; selects a named vector on a multi-vector collection
    ScoreThreshold *float32  // SEARCH only
}
```

### Query types

| `QueryType` | Behaviour |
|---|---|
| `SCROLL` | Pages through every point in the collection (or every point matching `Match`/`Filter`), `PageSize` at a time, until `Limit` points have been emitted or the collection is exhausted. The default fit for a full or filtered read. |
| `GET` | Fetches exactly the points named in `PointIDs`; an ID that doesn't exist is silently skipped. |
| `SEARCH` | Nearest-neighbor search for `Vector`, nearest first, each record carrying a `_score`. `Limit` caps the result count; `ScoreThreshold` drops anything below it. |

`Match` values are equality conditions, string, bool or whole-number only, ANDed together; set `Filter` instead (or alongside `Match`) for anything Qdrant's filter syntax can express but a plain equality can't.

### Example Source

```go
func (d *IUseConnector) GenerateQuery(request *models.QdrantSourceQuery) (*models.QdrantQueryOptions, error) {
    return &models.QdrantQueryOptions{
        Collection: "orders",
        QueryType:  models.QdrantQueryTypeScroll,
        Match:      map[string]any{"status": "pending"},
        PageSize:   256,
    }, nil
}
```

Implement only the method for the capture mode you use; return an error from the other, as in the [Postgres](./sql-postgres) example.

### What a record looks like

Each point becomes one record. `Data` carries the point's payload fields plus `_id` (the point ID — a number or a UUID string); a `SEARCH` adds `_score`. `WithVectors` adds `_vector` for a single/default vector, or `_vectors` (a map) for named or sparse vectors — a sparse vector arrives as `{"indices": [...], "values": [...]}`. `Meta` carries the collection name and point ID for engine bookkeeping.

## Destination Operations

```go
type IClientDBQdrantDest interface {
    GenerateQuery(param *models.QdrantDestQuery) ([]*models.QdrantDestQueryPayload, error)
    GenerateOptions(param *models.QdrantDestQuery) (*models.QdrantDestOptions, error)
}

type QdrantDestQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
    Records            []*Record
}

type QdrantDestQueryPayload struct {
    Collection    string
    Operation     QdrantWriteOperationType // UPSERT, DELETE, SET_PAYLOAD, OVERWRITE_PAYLOAD or DELETE_PAYLOAD
    PointID       any                      // required — unsigned integer or UUID string
    Vector        []float32                // UPSERT: single/default vector
    Vectors       map[string][]float32     // UPSERT: named dense vectors; mutually exclusive with Vector
    SparseVectors map[string]QdrantSparseVector // UPSERT: named sparse vectors
    Payload       map[string]any
    PayloadKeys   []string // DELETE_PAYLOAD only; required
}

type QdrantDestOptions struct {
    Async    bool
    Ordering QdrantWriteOrdering // "" (default), WEAK, MEDIUM or STRONG
}
```

Return one payload per point operation. Payloads are grouped by `Collection` and sent as batched update calls, one call per collection, with consecutive same-operation payloads inside a collection merged into a single batch operation. If the first collection's batch fails, the whole write fails. If a later collection's batch fails, its rows are marked failed, every row in a collection queued after it is marked not-attempted, and collections that already succeeded stay committed. `Async` makes the write return without waiting for Qdrant to apply it; `Ordering` trades write consistency for latency across a multi-node cluster.

### Example Destination

```go
func (d *IUseConnector) GenerateQuery(param *models.QdrantDestQuery) ([]*models.QdrantDestQueryPayload, error) {
    out := make([]*models.QdrantDestQueryPayload, 0, len(param.Records))
    for _, r := range param.Records {
        out = append(out, &models.QdrantDestQueryPayload{
            Collection: "orders",
            Operation:  models.QdrantWriteUpsert,
            PointID:    r.Data["id"],
            Vector:     r.Data["embedding"].([]float32),
            Payload:    r.Data,
        })
    }
    return out, nil
}
```

## Connection Parameters

Set these on the hub (see [Connector Hub](./connector-hub#qdrant-connector)): host, port (default 6334, Qdrant's gRPC port), API key, and whether to use TLS, with an option to skip certificate verification.
