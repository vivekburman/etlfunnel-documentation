# Elasticsearch

Elasticsearch databases serve as versatile NoSQL components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive Elasticsearch integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

Elasticsearch databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The Elasticsearch source interface supports two primary extraction approaches through these interface methods:

```go
type IClientDBElasticSource interface {
    FetchRecords(param *models.ElasticSourceFetch) <-chan map[string]any
    GenerateQuery(request *models.ElasticSourceQuery) (*models.ElasticQueryTune, error)
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
    AuxiliaryDBConnMap map[string]IDatabaseEngine
    DestDBConn         IDatabaseEngine
}

type ElasticSourceQuery struct {
    State              IPipelineRuntimeState
    SourceDBConn       *elasticsearch.Client
    DestDBConn         IDatabaseEngine
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type ElasticQueryTune struct {
    Body          any
    QueryType     DBElasticsearchQueryType
    Index         string
    DocumentID    string
    ScrollTimeout time.Duration
}

const (
    ElasticsearchQueryTypeSearch   DBElasticsearchQueryType = "SEARCH"
    ElasticsearchQueryTypeScroll   DBElasticsearchQueryType = "SCROLL"
    ElasticsearchQueryTypeGet      DBElasticsearchQueryType = "GET"
    ElasticsearchQueryTypeMultiGet DBElasticsearchQueryType = "MGET"
    ElasticsearchQueryTypeSQL      DBElasticsearchQueryType = "SQL"
)
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - Direct Elasticsearch client connection for data extraction  
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Query Types** - Support for various Elasticsearch operations including search, scroll, get, multi-get, and SQL

### Example Source

```go
func (c *IUseConnector) FetchRecords(param *models.ElasticSourceFetch) <-chan map[string]any {
    ch := make(chan map[string]any)

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
            ch <- source
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
                ch <- source
            }

            scrollID = scrollResponse["_scroll_id"].(string)
        }
    }()

    return ch
}

func (c *IUseConnector) GenerateQuery(param *models.ElasticSourceQuery) (*models.ElasticQueryTune, error) {
    query := map[string]interface{}{
        "query": map[string]interface{}{
            "match_all": map[string]interface{}{},
        },
        "size": 10,
    }

    return &models.ElasticQueryTune{
        QueryType:     models.ElasticsearchQueryTypeSearch,
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
    GenerateQuery(param *models.ElasticDestQuery) ([]*models.ElasticDestQueryTune, error)
}
```

This interface enables:

- **Document Indexing** - Optimized CREATE, INDEX, and UPDATE operations
- **Bulk Processing** - Receives a batch of records and returns one query tune per record
- **Upsert Operations** - Combined insert and update functionality

### Destination Configuration Structure

When using Elasticsearch as a destination, the system uses these struct definitions:

```go
// Destination operations
type ElasticDestQuery struct {
    State              IPipelineRuntimeState
    Records            []map[string]any
    SourceDBConn       IDatabaseEngine
    DestDBConn         *elasticsearch.Client
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type ElasticDestQueryTune struct {
    Document      map[string]any
    Upsert        map[string]any
    ScriptParams  map[string]any
    Index         string
    DocID         string
    Operation     DBElasticWriteOperationType
    RefreshPolicy string
    Script        string
}

const (
    ElasticWriteIndex  DBElasticWriteOperationType = "INDEX"
    ElasticWriteCreate DBElasticWriteOperationType = "CREATE"
    ElasticWriteUpdate DBElasticWriteOperationType = "UPDATE"
    ElasticWriteDelete DBElasticWriteOperationType = "DELETE"
)
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of data records for transformation and loading
- **Connection Management** - Maintains source, destination, and auxiliary database connections
- **Operation Types** - Supports various Elasticsearch write operations
- **Refresh Policies** - Controls when documents become searchable

### Example Destination

```go
func (c *IUseConnector) GenerateQuery(param *models.ElasticDestQuery) ([]*models.ElasticDestQueryTune, error) {
    tunes := make([]*models.ElasticDestQueryTune, 0, len(param.Records))

    for _, rec := range param.Records {
        docID := ""
        if id, exists := rec["id"]; exists {
            docID = fmt.Sprintf("%v", id)
        } else {
            docID = fmt.Sprintf("%d", time.Now().UnixNano())
        }

        document := make(map[string]any)
        for k, v := range rec {
            document[k] = v
        }

        if _, exists := document["@timestamp"]; !exists {
            document["@timestamp"] = time.Now().UTC().Format(time.RFC3339)
        }

        tunes = append(tunes, &models.ElasticDestQueryTune{
            Index:         param.State.GetName(),
            DocID:         docID,
            Operation:     models.ElasticWriteIndex,
            Document:      document,
            RefreshPolicy: "false",
        })
    }

    return tunes, nil
}
```

## Database Connection Casting

### IDatabaseEngine Interface

The `IDatabaseEngine` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific Elasticsearch connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual Elasticsearch client instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to Elasticsearch connection
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
