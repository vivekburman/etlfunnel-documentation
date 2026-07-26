# JSON

JSON files serve as file-based components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool reads and writes multi-part JSON directories — supporting both a single JSON array per file and JSONL/NDJSON — with an engine-driven full scan and a user-defined capture mode for full control over parsing.

## Source Operations

JSON files can serve as data sources using two extraction approaches, each optimized for different use cases.

### Data Extraction Methods

The JSON source interface supports two extraction approaches through these interface methods:

```go
type IClientDBJSONSource interface {
    GenerateScan(param *models.JSONSourceScan) (*models.JSONSourceScanOptions, error)
    FetchRecords(param *models.JSONSourceFetch) <-chan *models.Record
}
```

- **Full Scan** - The engine opens each part file in turn and parses it as either a single JSON array or JSONL/NDJSON (per `DBJSONConfig.Lines`), streaming rows as records — no client parsing code required
- **User-Defined** - Gives clients full control over parsing; the engine still calls `GenerateScan` first to resolve the file list, then hands your `FetchRecords` implementation the raw `*os.File` for each part in turn

### Source Configuration Structure

When configuring JSON as a source, the system uses these struct definitions:

```go
// Source operations
type JSONSourceScan struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type JSONSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *os.File
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type JSONSourceScanOptions struct {
    Files          []string
    Lines          *bool  // defaults to false (nil) — whole-file JSON array mode rather than JSONL
    RootPath       string // dot-separated key path to the row array within a non-array-root document; "" (default) means the document root itself is the row array
    RowLimit       int    // 0 = unlimited
    StartAfterPart int    // 0 = start from the first part
    StartAfterRow  int    // 0 = start from the first row
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - The `*os.File` handle for the part currently being streamed, available on `JSONSourceFetch` (user-defined mode only)
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Files** - Part filenames (relative to the connector's configured directory) to read, in order
- **Lines** - `true` for JSONL/NDJSON (one object per line), `false`/`nil` (the default) for a single top-level JSON array
- **RootPath** - Only consulted in whole-file JSON array mode (`Lines` false/nil; ignored in JSONL mode, since each line is already one row with no enclosing document to navigate). A dot-separated key path selecting the row array within a non-array-root document — e.g. `"meta.results"` reads the array at `doc["meta"]["results"]`. `""` (the default) means the document root itself is the row array. Each element the path resolves to must be a JSON object; a non-object element or a path segment that doesn't resolve to an array returns an error
- **RowLimit / StartAfterPart / StartAfterRow** - Resume support: cap how many rows to deliver, and skip ahead to a specific part/row (e.g. after a checkpoint); `0` means unlimited / start from the very first part or row

### Record Position Metadata

Full-scan reads stamp each delivered record's `Meta` with its position, using the shared file-source Meta-key constants:

| Key | Constant | Description |
|-----|----------|--------------|
| `_file_part` | `models.MetaFilePart` | 0-based index into `Files` |
| `_file_row` | `models.MetaFileRow` | 0-based row index within that file, resets per file |

Client-authored checkpoint hooks should reference these constants rather than raw string literals so producer and consumer can't drift apart.

### Example Source

```go
func (c *IUseConnector) GenerateScan(param *models.JSONSourceScan) (*models.JSONSourceScanOptions, error) {
    lines := true // JSONL/NDJSON
    return &models.JSONSourceScanOptions{
        Files: []string{"events_2024.jsonl"},
        Lines: &lines,
    }, nil
}

// A whole-file JSON array nested under a wrapper object instead of at the
// document root — e.g. `{"meta": {...}, "results": [...]}` — needs RootPath
// to locate the row array (Lines left nil/false):
func (c *IUseConnector) GenerateScanNested(param *models.JSONSourceScan) (*models.JSONSourceScanOptions, error) {
    return &models.JSONSourceScanOptions{
        Files:    []string{"orders_2024.json"},
        RootPath: "results",
    }, nil
}

// FetchRecords is only invoked in user-defined capture mode.
func (c *IUseConnector) FetchRecords(param *models.JSONSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        decoder := json.NewDecoder(param.SourceDBConn)
        for decoder.More() {
            var data map[string]any
            if err := decoder.Decode(&data); err != nil {
                return
            }
            ch <- &models.Record{Data: data}
        }
    }()

    return ch
}
```

## Destination Operations

JSON files can also function as destinations for processed data, writing sequential, size-capped part files.

### Data Loading Capabilities

The JSON destination interface provides structured data loading operations:

```go
type IClientDBJSONDest interface {
    GenerateQuery(param *models.JSONDestQuery) ([]*models.JSONDestWritePayload, error)
    GenerateOptions(param *models.JSONDestQuery) (*models.JSONDestOptions, error)
}
```

This interface enables:

- **Batch Processing** - Receives a batch of records and returns one write payload per record
- **Options Generation** - A one-time hook, called before the pipeline starts writing, that controls part-rotation behavior (`WriteMode`, `FilePrefix`, `MaxRecordsPerPart`)

Unlike the source, the destination always writes JSONL — one object per line, streamed as records arrive — so there is no `Lines` option here. A bare JSON array was considered but rejected: a JSON array is one value, so writing it means buffering the entire part in memory until rotation or `Close`, which is unbounded when `MaxRecordsPerPart` is `0`.

### Destination Configuration Structure

When using JSON as a destination, the system uses these struct definitions:

```go
// Destination operations
type JSONDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type JSONDestOptions struct {
    MaxRecordsPerPart int       // 0 = unlimited records per part
    WriteMode         WriteMode // WriteModeOverwrite clears existing parts first; anything else (including WriteModeAppend, the zero value "") appends new parts
    FilePrefix        string    // "" resolves to "part"
}

type JSONDestWritePayload struct {
    Rows []map[string]any
}

// WriteMode controls whether a file destination appends to or clears
// existing part files before writing. The zero value (WriteModeAppend)
// preserves existing parts.
type WriteMode string

const (
    WriteModeAppend    WriteMode = ""
    WriteModeOverwrite WriteMode = "overwrite"
)
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` for transformation and loading; use `Record.Data` to access field values
- **Part Rotation** - Once a part reaches `MaxRecordsPerPart` rows, the engine closes it and opens the next one automatically; `MaxRecordsPerPart: 0` means unlimited rows per part, and `FilePrefix: ""` resolves to `"part"`

### Example Destination

```go
func (c *IUseConnector) GenerateOptions(param *models.JSONDestQuery) (*models.JSONDestOptions, error) {
    return &models.JSONDestOptions{
        MaxRecordsPerPart: 50000,
        WriteMode:         models.WriteModeOverwrite,
        FilePrefix:        "export",
    }, nil
}

func (c *IUseConnector) GenerateQuery(param *models.JSONDestQuery) ([]*models.JSONDestWritePayload, error) {
    rows := make([]map[string]any, 0, len(param.Records))

    for _, rec := range param.Records {
        rows = append(rows, rec.Data)
    }

    return []*models.JSONDestWritePayload{
        {Rows: rows},
    }, nil
}
```

## Connection Casting

Use the `cast/json` helper to resolve a generic `IDatabaseConnInfo` (e.g. an auxiliary connection) to its JSON source's configured base directory:

```go
import castjson "etlfunnel/execution/cast/json"

// Cast IDatabaseConnInfo to a JSON file connector
jsonConn, err := castjson.CastAsJSONConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to JSON connection: %v", err)
}

// jsonConn is of type models.FileConnector — Directory is the connect-time-
// resolved base directory, not a file handle
path := filepath.Join(jsonConn.Directory, "export.json")
```

:::tip Connection Casting
`FetchRecords` already receives the concrete `*os.File` for the record currently being streamed via `SourceDBConn` — you only need `CastAsJSONConnection` when working with a JSON connection reached through `AuxiliaryDBConnMap`, and it resolves the connector's base directory, not a specific file handle.
:::
