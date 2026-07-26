# CSV

CSV files serve as file-based components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool reads and writes multi-part CSV directories, supporting both an engine-driven full scan and a user-defined capture mode for full control over parsing. Only UTF-8 encoded files are currently supported.

## Source Operations

CSV files can serve as data sources using two extraction approaches, each optimized for different use cases.

### Data Extraction Methods

The CSV source interface supports two extraction approaches through these interface methods:

```go
type IClientDBCSVSource interface {
    GenerateScan(param *models.CSVSourceScan) (*models.CSVSourceScanOptions, error)
    FetchRecords(param *models.CSVSourceFetch) <-chan *models.Record
}
```

- **Full Scan** - The engine opens each part file in turn, parses rows with `encoding/csv` using your delimiter/header settings, and streams them as records — no client parsing code required
- **User-Defined** - Gives clients full control over parsing; the engine still calls `GenerateScan` first to resolve the file list, then hands your `FetchRecords` implementation the raw `*os.File` for each part in turn

### Source Configuration Structure

When configuring CSV as a source, the system uses these struct definitions:

```go
// Source operations
type CSVSourceScan struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type CSVSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *os.File
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type CSVSourceScanOptions struct {
    Files          []string
    Delimiter      string // defaults to ',' when empty
    HasHeader      *bool  // defaults to true when nil
    RowLimit       int    // 0 = unlimited
    StartAfterPart int    // 0 = start from the first part
    StartAfterRow  int    // 0 = start from the first row
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - The `*os.File` handle for the part currently being streamed, available on `CSVSourceFetch` (user-defined mode only)
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Files** - Part filenames (relative to the connector's configured directory) to read, in order
- **Delimiter** - Field separator character; defaults to `,` when left empty
- **HasHeader** - Whether the first row is a header; defaults to `true` when `nil`
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
func (c *IUseConnector) GenerateScan(param *models.CSVSourceScan) (*models.CSVSourceScanOptions, error) {
    hasHeader := true
    return &models.CSVSourceScanOptions{
        Files:     []string{"orders_2024.csv"},
        Delimiter: ",",
        HasHeader: &hasHeader,
        RowLimit:  0, // 0 = unlimited
    }, nil
}

// FetchRecords is only invoked in user-defined capture mode.
func (c *IUseConnector) FetchRecords(param *models.CSVSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        reader := csv.NewReader(param.SourceDBConn)
        header, err := reader.Read()
        if err != nil {
            return
        }

        for {
            row, err := reader.Read()
            if err != nil {
                return
            }

            data := make(map[string]any, len(row))
            for i, v := range row {
                data[header[i]] = v
            }
            ch <- &models.Record{Data: data}
        }
    }()

    return ch
}
```

## Destination Operations

CSV files can also function as destinations for processed data, writing sequential, size-capped part files.

### Data Loading Capabilities

The CSV destination interface provides structured data loading operations:

```go
type IClientDBCSVDest interface {
    GenerateQuery(param *models.CSVDestQuery) ([]*models.CSVDestWritePayload, error)
    GenerateOptions(param *models.CSVDestQuery) (*models.CSVDestOptions, error)
}
```

This interface enables:

- **Batch Processing** - Receives a batch of records and returns one write payload per record
- **Options Generation** - A one-time hook, called before the pipeline starts writing, that controls delimiter/header/encoding and part-rotation behavior (`WriteMode`, `FilePrefix`, `MaxRecordsPerPart`)

### Destination Configuration Structure

When using CSV as a destination, the system uses these struct definitions:

```go
// Destination operations
type CSVDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type CSVDestOptions struct {
    Delimiter         string    // defaults to ',' when empty
    HasHeader         *bool     // defaults to true when nil
    MaxRecordsPerPart int       // 0 = unlimited records per part
    WriteMode         WriteMode // WriteModeOverwrite clears existing parts first; anything else (including WriteModeAppend, the zero value "") appends new parts
    FilePrefix        string    // "" resolves to "part"
}

type CSVDestWritePayload struct {
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
func (c *IUseConnector) GenerateOptions(param *models.CSVDestQuery) (*models.CSVDestOptions, error) {
    hasHeader := true
    return &models.CSVDestOptions{
        HasHeader:         &hasHeader,
        MaxRecordsPerPart: 50000,
        WriteMode:         models.WriteModeOverwrite,
        FilePrefix:        "export",
    }, nil
}

func (c *IUseConnector) GenerateQuery(param *models.CSVDestQuery) ([]*models.CSVDestWritePayload, error) {
    rows := make([]map[string]any, 0, len(param.Records))

    for _, rec := range param.Records {
        rows = append(rows, rec.Data)
    }

    return []*models.CSVDestWritePayload{
        {Rows: rows},
    }, nil
}
```

## Connection Casting

Unlike database connectors, file connectors have no dedicated per-connector cast helper in `cast/`. When you need the underlying `*os.File` from a generic `IDatabaseConnInfo` (e.g. an auxiliary connection), use the shared generic helper directly:

```go
// Cast IDatabaseConnInfo to the underlying CSV file handle
file, err := cast.FromPointer[os.File](engine)
if err != nil {
    return fmt.Errorf("failed to cast to CSV file handle: %v", err)
}

// file is of type *os.File
```

:::tip Connection Casting
`FetchRecords` already receives the concrete `*os.File` via `SourceDBConn` — you only need `cast.FromPointer` when working with a CSV connection reached through `AuxiliaryDBConnMap`.
:::
