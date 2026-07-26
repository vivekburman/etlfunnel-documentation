# Elasticsearch

Elasticsearch databases serve as versatile NoSQL components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive Elasticsearch integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

Elasticsearch databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The Elasticsearch source interface supports two primary extraction approaches through these interface methods:

```go
type IClientDBElasticSource interface {
    FetchRecords(param *models.ElasticSourceFetch) <-chan *models.Record
    GenerateQuery(request *models.ElasticSourceQuery) (*models.ElasticQueryOptions, error)
}
```

- **Record Fetching** - Provides full control over data reading, streaming records one at a time via channels
- **Query Generation** - Dynamic query construction for complex data transformations and search operations

### Source Configuration Structure

When configuring Elasticsearch as a source database, the system uses these struct definitions:

```go
// Source operations
type ElasticSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *elasticsearch.Client
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type ElasticSourceQuery struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type ElasticQueryOptions struct {
    Body          any
    QueryType     ElasticQueryType
    Index         string
    DocumentID    string
    ScrollTimeout time.Duration // no default; passed directly as Scroll: ScrollTimeout — the zero value sends no scroll duration to the ES client
}

const (
    ElasticQueryTypeSearch   ElasticQueryType = "SEARCH"
    ElasticQueryTypeScroll   ElasticQueryType = "SCROLL"
    ElasticQueryTypeGet      ElasticQueryType = "GET"
    ElasticQueryTypeMultiGet ElasticQueryType = "MGET"
    ElasticQueryTypeSQL      ElasticQueryType = "SQL"
)
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct Elasticsearch client connection for data extraction, available on `ElasticSourceFetch` (used by the user-defined capture mode)
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Query Types** - Support for various Elasticsearch operations including search, scroll, get, multi-get, and SQL
- **ScrollTimeout** - Left at its zero value, no scroll duration is sent to the client at all — there is no substituted default

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *models.ElasticSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        searchQuery := map[string]interface{}{
            "query": map[string]interface{}{
                "match_all": map[string]interface{}{},
            },
            "size": 100,
        }

        body, _ := json.Marshal(searchQuery)
        res, err := param.SourceDBConn.Search(
            param.SourceDBConn.Search.WithIndex(param.State.GetName()),
            param.SourceDBConn.Search.WithBody(bytes.NewReader(body)),
            param.SourceDBConn.Search.WithScroll(time.Minute),
        )

        if err != nil {
            log.Println("search error:", err)
            return
        }
        defer res.Body.Close()

        var searchResponse map[string]interface{}
        json.NewDecoder(res.Body).Decode(&searchResponse)

        hits := searchResponse["hits"].(map[string]interface{})["hits"].([]interface{})
        for _, hit := range hits {
            hitMap := hit.(map[string]interface{})
            source := hitMap["_source"].(map[string]interface{})
            ch <- &models.Record{Data: source}
        }

        scrollID := searchResponse["_scroll_id"].(string)
        for scrollID != "" {
            scrollRes, err := param.SourceDBConn.Scroll(
                param.SourceDBConn.Scroll.WithScrollID(scrollID),
                param.SourceDBConn.Scroll.WithScroll(time.Minute),
            )
            if err != nil {
                break
            }
            defer scrollRes.Body.Close()

            var scrollResponse map[string]interface{}
            json.NewDecoder(scrollRes.Body).Decode(&scrollResponse)

            scrollHits := scrollResponse["hits"].(map[string]interface{})["hits"].([]interface{})
            if len(scrollHits) == 0 {
                break
            }

            for _, hit := range scrollHits {
                hitMap := hit.(map[string]interface{})
                source := hitMap["_source"].(map[string]interface{})
                ch <- &models.Record{Data: source}
            }

            scrollID = scrollResponse["_scroll_id"].(string)
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.ElasticSourceQuery) (*models.ElasticQueryOptions, error) {
    query := map[string]interface{}{
        "query": map[string]interface{}{
            "match_all": map[string]interface{}{},
        },
        "size": 10,
    }

    return &models.ElasticQueryOptions{
        QueryType:     models.ElasticQueryTypeSearch,
        Index:         param.State.GetName(),
        Body:          query,
        ScrollTimeout: time.Minute,
    }, nil
}
```

## Destination Database Operations

Elasticsearch databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The Elasticsearch destination interface provides structured data loading operations:

```go
type IClientDBElasticDest interface {
    GenerateQuery(param *models.ElasticDestQuery) ([]*models.ElasticDestQueryPayload, error)
    GenerateOptions(param *models.ElasticDestQuery) (*models.ElasticDestOptions, error)
}
```

This interface enables:

- **Document Indexing** - Optimized CREATE, INDEX, and UPDATE operations
- **Bulk Processing** - Receives a batch of records and returns one query payload per record
- **Upsert Operations** - Combined insert and update functionality
- **Refresh Policy Configuration** - `GenerateOptions` returns an `ElasticDestOptions` value that sets the refresh policy for the whole bulk request

### Destination Configuration Structure

When using Elasticsearch as a destination, the system uses these struct definitions:

```go
// Destination operations
type ElasticDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type ElasticDestQueryPayload struct {
    Document     map[string]any
    Upsert       map[string]any
    ScriptParams map[string]any
    Index        string
    DocID        string
    Operation    ElasticWriteOperationType
    Script       string
}

const (
    ElasticWriteIndex  ElasticWriteOperationType = "INDEX"
    ElasticWriteCreate ElasticWriteOperationType = "CREATE"
    ElasticWriteUpdate ElasticWriteOperationType = "UPDATE"
    ElasticWriteDelete ElasticWriteOperationType = "DELETE"
)

// ElasticDestOptions is returned by GenerateOptions and applies to the whole
// Bulk() request rather than a single payload.
type ElasticDestOptions struct {
    RefreshPolicy string // only overwritten when non-empty; "" (the zero value) is passed to Bulk.WithRefresh(""), which Elasticsearch treats as no-refresh — not an app-set default
}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` values (each with a `Data` map and a `Meta` map) for transformation and loading
- **Connection Management** - Maintains auxiliary database connections for lookups; the destination Elasticsearch connection itself is managed internally and is not passed through this struct
- **Operation Types** - Supports various Elasticsearch write operations
- **Refresh Policies** - Controlled via `ElasticDestOptions.RefreshPolicy` from `GenerateOptions`, applied to the whole bulk request; `""` (the zero value) is treated by Elasticsearch as no-refresh, not an app-substituted default

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.ElasticDestQuery) ([]*models.ElasticDestQueryPayload, error) {
    payloads := make([]*models.ElasticDestQueryPayload, 0, len(param.Records))

    for _, rec := range param.Records {
        docID := ""
        if id, exists := rec.Data["id"]; exists {
            docID = fmt.Sprintf("%v", id)
        } else {
            docID = fmt.Sprintf("%d", time.Now().UnixNano())
        }

        document := make(map[string]any)
        for k, v := range rec.Data {
            document[k] = v
        }

        if _, exists := document["@timestamp"]; !exists {
            document["@timestamp"] = time.Now().UTC().Format(time.RFC3339)
        }

        payloads = append(payloads, &models.ElasticDestQueryPayload{
            Index:     param.State.GetName(),
            DocID:     docID,
            Operation: models.ElasticWriteIndex,
            Document:  document,
        })
    }

    return payloads, nil
}

func (c *IUseConnector) GenerateOptions(param *models.ElasticDestQuery) (*models.ElasticDestOptions, error) {
    return &models.ElasticDestOptions{
        RefreshPolicy: "false",
    }, nil
}
```

## Database Connection Casting

### IDatabaseConnInfo Interface

The `IDatabaseConnInfo` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific Elasticsearch connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual Elasticsearch client instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseConnInfo to Elasticsearch connection
elasticConn, err := CastAsElasticsearchConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Elasticsearch connection: %v", err)
}

// Now you can use the underlying Elasticsearch client directly
// elasticConn is of type *elasticsearch.Client
info, err := elasticConn.Info()
if err != nil {
    return fmt.Errorf("failed to get cluster info: %v", err)
}
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid Elasticsearch connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to Elasticsearch-specific functionality when required.
:::
