# Fixed-Width

Fixed-width text files serve as file-based components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool reads and writes multi-part fixed-width directories, using byte-offset field definitions, with an engine-driven full scan and a user-defined capture mode for full control over parsing. Only UTF-8 encoded files are currently supported.

## Source Operations

Fixed-width files can serve as data sources using two extraction approaches, each optimized for different use cases.

### Data Extraction Methods

The Fixed-Width source interface supports two extraction approaches through these interface methods:

```go
type IClientDBFixedWidthSource interface {
    GenerateScan(param *models.FixedWidthSourceScan) (*models.FixedWidthSourceScanOptions, error)
    FetchRecords(param *models.FixedWidthSourceFetch) <-chan *models.Record
}
```

- **Full Scan** - The engine opens each part file in turn, slices each line by the byte offsets in `Fields`, and streams rows as records — no client parsing code required
- **User-Defined** - Gives clients full control over parsing; the engine still calls `GenerateScan` first to resolve the file list, then hands your `FetchRecords` implementation the raw `*os.File` for each part in turn

### Source Configuration Structure

When configuring Fixed-Width as a source, the system uses these struct definitions:

```go
// Source operations
type FixedWidthSourceScan struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type FixedWidthSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *os.File
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type FixedWidthSourceScanOptions struct {
    Files          []string
    Fields         []FixedWidthField
    TrimOnRead     *bool // defaults to true when nil
    RowLimit       int   // 0 = unlimited
    StartAfterPart int   // 0 = start from the first part
    StartAfterRow  int   // 0 = start from the first row
}

// FixedWidthField describes one column's byte-offset position within a line.
type FixedWidthField struct {
    Name   string
    Start  int // 0-based byte offset
    Length int
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - The `*os.File` handle for the part currently being streamed, available on `FixedWidthSourceFetch` (user-defined mode only)
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Files** - Part filenames (relative to the connector's configured directory) to read, in order
- **Fields** - Column name plus byte `Start`/`Length` defining where each field sits within a line
- **TrimOnRead** - Whether to trim surrounding whitespace from each sliced field value; defaults to `true` when `nil`
- **RowLimit / StartAfterPart / StartAfterRow** - Resume support: cap how many rows to deliver, and skip ahead to a specific part/row (e.g. after a checkpoint); `0` means unlimited / start from the very first part or row

Note there is no delimiter/query field here — field positions come entirely from `DBFixedWidthConfig.Fields`, so there is nothing equivalent to a query to author.

### Record Position Metadata

Full-scan reads stamp each delivered record's `Meta` with its position, using the shared file-source Meta-key constants:

| Key | Constant | Description |
|-----|----------|--------------|
| `_file_part` | `models.MetaFilePart` | 0-based index into `Files` |
| `_file_row` | `models.MetaFileRow` | 0-based row index within that file, resets per file |

Client-authored checkpoint hooks should reference these constants rather than raw string literals so producer and consumer can't drift apart.

### Example Source

```go
func (c *IUseConnector) GenerateScan(param *models.FixedWidthSourceScan) (*models.FixedWidthSourceScanOptions, error) {
    trim := true
    return &models.FixedWidthSourceScanOptions{
        Files: []string{"orders_2024.txt"},
        Fields: []models.FixedWidthField{
            {Name: "id", Start: 0, Length: 10},
            {Name: "name", Start: 10, Length: 30},
            {Name: "updated_at", Start: 40, Length: 19},
        },
        TrimOnRead: &trim,
    }, nil
}

// FetchRecords is only invoked in user-defined capture mode.
func (c *IUseConnector) FetchRecords(param *models.FixedWidthSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)
    fields := []models.FixedWidthField{
        {Name: "id", Start: 0, Length: 10},
        {Name: "name", Start: 10, Length: 30},
        {Name: "updated_at", Start: 40, Length: 19},
    }

    go func() {
        defer close(ch)

        scanner := bufio.NewScanner(param.SourceDBConn)
        for scanner.Scan() {
            line := scanner.Text()
            data := make(map[string]any, len(fields))
            for _, f := range fields {
                if f.Start+f.Length <= len(line) {
                    data[f.Name] = strings.TrimSpace(line[f.Start : f.Start+f.Length])
                }
            }
            ch <- &models.Record{Data: data}
        }
    }()

    return ch
}
```

## Destination Operations

Fixed-width files can also function as destinations for processed data, writing sequential, size-capped part files.

### Data Loading Capabilities

The Fixed-Width destination interface provides structured data loading operations:

```go
type IClientDBFixedWidthDest interface {
    GenerateQuery(param *models.FixedWidthDestQuery) ([]*models.FixedWidthDestWritePayload, error)
    GenerateOptions(param *models.FixedWidthDestQuery) (*models.FixedWidthDestOptions, error)
}
```

This interface enables:

- **Batch Processing** - Receives a batch of records and returns one write payload per record
- **Options Generation** - A one-time hook, called before the pipeline starts writing, that controls field layout, padding, and part-rotation behavior (`WriteMode`, `FilePrefix`, `MaxRecordsPerPart`)

### Destination Configuration Structure

When using Fixed-Width as a destination, the system uses these struct definitions:

```go
// Destination operations
type FixedWidthDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type FixedWidthDestOptions struct {
    Fields            []FixedWidthField
    PadChar           string // defaults to ' ' (space) when empty
    MaxRecordsPerPart int    // 0 = unlimited records per part
    WriteMode         string // "overwrite" clears existing parts first; anything else (including "") appends new parts
    FilePrefix        string // "" resolves to "part"
}

type FixedWidthDestWritePayload struct {
    Rows []map[string]any
}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` for transformation and loading; use `Record.Data` to access field values
- **Field Layout** - `Fields` defines the byte `Start`/`Length` each column is written into; `PadChar` fills unused bytes in a field and defaults to `' '` (space) when left empty
- **Part Rotation** - Once a part reaches `MaxRecordsPerPart` rows, the engine closes it and opens the next one automatically; `MaxRecordsPerPart: 0` means unlimited rows per part, and `FilePrefix: ""` resolves to `"part"`

### Example Destination

```go
func (c *IUseConnector) GenerateOptions(param *models.FixedWidthDestQuery) (*models.FixedWidthDestOptions, error) {
    return &models.FixedWidthDestOptions{
        Fields: []models.FixedWidthField{
            {Name: "id", Start: 0, Length: 10},
            {Name: "name", Start: 10, Length: 30},
            {Name: "updated_at", Start: 40, Length: 19},
        },
        PadChar:           " ",
        MaxRecordsPerPart: 50000,
        WriteMode:         "overwrite",
        FilePrefix:        "export",
    }, nil
}

func (c *IUseConnector) GenerateQuery(param *models.FixedWidthDestQuery) ([]*models.FixedWidthDestWritePayload, error) {
    rows := make([]map[string]any, 0, len(param.Records))

    for _, rec := range param.Records {
        rows = append(rows, rec.Data)
    }

    return []*models.FixedWidthDestWritePayload{
        {Rows: rows},
    }, nil
}
```

## Connection Casting

Unlike database connectors, file connectors have no dedicated per-connector cast helper in `cast/`. When you need the underlying `*os.File` from a generic `IDatabaseEngine` (e.g. an auxiliary connection), use the shared generic helper directly:

```go
// Cast IDatabaseEngine to the underlying fixed-width file handle
file, err := cast.FromPointer[os.File](engine)
if err != nil {
    return fmt.Errorf("failed to cast to fixed-width file handle: %v", err)
}

// file is of type *os.File
```

:::tip Connection Casting
`FetchRecords` already receives the concrete `*os.File` via `SourceDBConn` — you only need `cast.FromPointer` when working with a fixed-width connection reached through `AuxiliaryDBConnMap`.
:::
