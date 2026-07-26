# Excel

Excel workbooks serve as file-based components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool reads and writes multi-part `.xlsx` directories, targeting a single sheet per connector, with an engine-driven full scan and a user-defined capture mode for full control over parsing.

## Source Operations

Excel workbooks can serve as data sources using two extraction approaches, each optimized for different use cases.

### Data Extraction Methods

The Excel source interface supports two extraction approaches through these interface methods:

```go
type IClientDBExcelSource interface {
    GenerateScan(param *models.ExcelSourceScan) (*models.ExcelSourceScanOptions, error)
    FetchRecords(param *models.ExcelSourceFetch) <-chan *models.Record
}
```

- **Full Scan** - The engine opens each part workbook in turn, reads the configured sheet with `excelize`, and streams rows as records — no client parsing code required
- **User-Defined** - Gives clients full control over parsing; the engine still calls `GenerateScan` first to resolve the file list, then hands your `FetchRecords` implementation the opened `*excelize.File` for each part in turn

### Source Configuration Structure

When configuring Excel as a source, the system uses these struct definitions:

```go
// Source operations
type ExcelSourceScan struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type ExcelSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *excelize.File
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type ExcelSourceScanOptions struct {
    Files          []string
    SheetName      string
    SheetIndex     int    // 0-based, used when SheetName is empty; 0 itself is treated as "unset" (checked as SheetIndex > 0)
    HasHeader      *bool  // defaults to true when nil
    RowLimit       int    // 0 = unlimited
    StartAfterPart int    // 0 = start from the first part
    StartAfterRow  int    // 0 = start from the first row
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - The opened `*excelize.File` handle for the part currently being streamed, available on `ExcelSourceFetch` (user-defined mode only)
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Files** - Part filenames (relative to the connector's configured directory) to read, in order
- **SheetName / SheetIndex** - Target sheet, by name or 0-based index (index used only when `SheetName` is empty). An empty `SheetName` falls through to `SheetIndex`, and `SheetIndex: 0` falls through to the first sheet — there is no way to explicitly target sheet 0 by index; use `SheetName` for that
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
func (c *IUseConnector) GenerateScan(param *models.ExcelSourceScan) (*models.ExcelSourceScanOptions, error) {
    hasHeader := true
    return &models.ExcelSourceScanOptions{
        Files:     []string{"orders_2024.xlsx"},
        SheetName: "Orders",
        HasHeader: &hasHeader,
    }, nil
}

// FetchRecords is only invoked in user-defined capture mode.
func (c *IUseConnector) FetchRecords(param *models.ExcelSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        rows, err := param.SourceDBConn.GetRows("Orders")
        if err != nil || len(rows) == 0 {
            return
        }

        header := rows[0]
        for _, row := range rows[1:] {
            data := make(map[string]any, len(header))
            for i, col := range header {
                if i < len(row) {
                    data[col] = row[i]
                }
            }
            ch <- &models.Record{Data: data}
        }
    }()

    return ch
}
```

## Destination Operations

Excel workbooks can also function as destinations for processed data, writing sequential, size-capped part workbooks.

### Data Loading Capabilities

The Excel destination interface provides structured data loading operations:

```go
type IClientDBExcelDest interface {
    GenerateQuery(param *models.ExcelDestQuery) ([]*models.ExcelDestWritePayload, error)
    GenerateOptions(param *models.ExcelDestQuery) (*models.ExcelDestOptions, error)
}
```

This interface enables:

- **Batch Processing** - Receives a batch of records and returns one write payload per record
- **Options Generation** - A one-time hook, called before the pipeline starts writing, that controls the target sheet and part-rotation behavior (`WriteMode`, `FilePrefix`, `MaxRecordsPerPart`)

### Destination Configuration Structure

When using Excel as a destination, the system uses these struct definitions:

```go
// Destination operations
type ExcelDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type ExcelDestOptions struct {
    SheetName         string
    SheetIndex        int       // 0-based, used when SheetName is empty; same "0 means unset" caveat as ExcelSourceScanOptions
    HasHeader         *bool     // defaults to true when nil
    MaxRecordsPerPart int       // 0 = unlimited records per part
    WriteMode         WriteMode // WriteModeOverwrite clears existing parts first; anything else (including WriteModeAppend, the zero value "") appends new parts
    FilePrefix        string    // "" resolves to "part"
}

type ExcelDestWritePayload struct {
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
func (c *IUseConnector) GenerateOptions(param *models.ExcelDestQuery) (*models.ExcelDestOptions, error) {
    hasHeader := true
    return &models.ExcelDestOptions{
        SheetName:         "Export",
        HasHeader:         &hasHeader,
        MaxRecordsPerPart: 50000,
        WriteMode:         models.WriteModeOverwrite,
        FilePrefix:        "export",
    }, nil
}

func (c *IUseConnector) GenerateQuery(param *models.ExcelDestQuery) ([]*models.ExcelDestWritePayload, error) {
    rows := make([]map[string]any, 0, len(param.Records))

    for _, rec := range param.Records {
        rows = append(rows, rec.Data)
    }

    return []*models.ExcelDestWritePayload{
        {Rows: rows},
    }, nil
}
```

## Connection Casting

Use the `cast/excel` helper to resolve a generic `IDatabaseConnInfo` (e.g. an auxiliary connection) to its Excel source's configured base directory:

```go
import castexcel "etlfunnel/execution/cast/excel"

// Cast IDatabaseConnInfo to an Excel file connector
excelConn, err := castexcel.CastAsExcelConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to Excel connection: %v", err)
}

// excelConn is of type models.FileConnector — Directory is the connect-time-
// resolved base directory, not a workbook handle
path := filepath.Join(excelConn.Directory, "export.xlsx")
```

:::tip Connection Casting
`FetchRecords` already receives the concrete `*excelize.File` for the record currently being streamed via `SourceDBConn` — you only need `CastAsExcelConnection` when working with an Excel connection reached through `AuxiliaryDBConnMap`, and it resolves the connector's base directory, not a specific workbook handle.
:::
