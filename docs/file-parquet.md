# Parquet

Parquet files serve as file-based components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool reads and writes multi-part Parquet directories, with an engine-driven full scan and a user-defined capture mode for full control over parsing.

## Source Operations

Parquet files can serve as data sources using two extraction approaches, each optimized for different use cases.

### Data Extraction Methods

The Parquet source interface supports two extraction approaches through these interface methods:

```go
type IClientDBParquetSource interface {
    GenerateScan(param *models.ParquetSourceScan) (*models.ParquetSourceScanOptions, error)
    FetchRecords(param *models.ParquetSourceFetch) <-chan *models.Record
}
```

- **Full Scan** - The engine opens each part file in turn and streams rows as records, deriving column names/types from the file's own embedded schema — no client parsing code required
- **User-Defined** - Gives clients full control over parsing; the engine still calls `GenerateScan` first to resolve the file list, then hands your `FetchRecords` implementation the opened `*parquet.File` for each part in turn

### Source Configuration Structure

When configuring Parquet as a source, the system uses these struct definitions:

```go
// Source operations
type ParquetSourceScan struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type ParquetSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *parquet.File
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type ParquetSourceScanOptions struct {
    Files          []string
    RowLimit       int
    StartAfterPart int
    StartAfterRow  int
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - The opened `*parquet.File` handle for the part currently being streamed, available on `ParquetSourceFetch` (user-defined mode only)
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Files** - Part filenames (relative to the connector's configured directory) to read, in order
- **RowLimit / StartAfterPart / StartAfterRow** - Resume support: cap how many rows to deliver, and skip ahead to a specific part/row (e.g. after a checkpoint)

Note there is no `Delimiter`/`HasHeader`-style shape configuration here — schema comes from the Parquet file itself, so there is nothing equivalent to a query to author.

### Record Position Metadata

Full-scan reads stamp each delivered record's `Meta` with its position, using the shared file-source Meta-key constants:

| Key | Constant | Description |
|-----|----------|--------------|
| `_file_part` | `models.MetaFilePart` | 0-based index into `Files` |
| `_file_row` | `models.MetaFileRow` | 0-based row index within that file, resets per file |

Client-authored checkpoint hooks should reference these constants rather than raw string literals so producer and consumer can't drift apart.

### Example Source

```go
func (c *IUseConnector) GenerateScan(param *models.ParquetSourceScan) (*models.ParquetSourceScanOptions, error) {
    return &models.ParquetSourceScanOptions{
        Files: []string{"orders_2024.parquet"},
    }, nil
}

// FetchRecords is only invoked in user-defined capture mode.
func (c *IUseConnector) FetchRecords(param *models.ParquetSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        reader := parquet.NewGenericReader[map[string]any](param.SourceDBConn)
        defer reader.Close()

        rows := make([]map[string]any, 1)
        for {
            n, err := reader.Read(rows)
            for i := 0; i < n; i++ {
                ch <- &models.Record{Data: rows[i]}
            }
            if err != nil {
                return
            }
        }
    }()

    return ch
}
```

## Destination Operations

Parquet files can also function as destinations for processed data, writing sequential, size-capped part files.

### Data Loading Capabilities

The Parquet destination interface provides structured data loading operations:

```go
type IClientDBParquetDest interface {
    GenerateQuery(param *models.ParquetDestQuery) ([]*models.ParquetDestWritePayload, error)
    GenerateOptions(param *models.ParquetDestQuery) (*models.ParquetDestOptions, error)
}
```

This interface enables:

- **Batch Processing** - Receives a batch of records and returns one write payload per record
- **Options Generation** - A one-time hook, called before the pipeline starts writing, that controls compression and part-rotation behavior (`WriteMode`, `FilePrefix`, `MaxRecordsPerPart`)

### Destination Configuration Structure

When using Parquet as a destination, the system uses these struct definitions:

```go
// Destination operations
type ParquetDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type ParquetDestOptions struct {
    CompressionCodec  string
    MaxRecordsPerPart int
    WriteMode         string // "overwrite" clears existing parts first; anything else appends new parts
    FilePrefix        string
}

type ParquetDestWritePayload struct {
    Rows []map[string]any
}
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` for transformation and loading; use `Record.Data` to access field values
- **Part Rotation** - Once a part reaches `MaxRecordsPerPart` rows, the engine closes it and opens the next one automatically

### Example Destination

```go
func (c *IUseConnector) GenerateOptions(param *models.ParquetDestQuery) (*models.ParquetDestOptions, error) {
    return &models.ParquetDestOptions{
        CompressionCodec:  "snappy",
        MaxRecordsPerPart: 50000,
        WriteMode:         "overwrite",
        FilePrefix:        "export",
    }, nil
}

func (c *IUseConnector) GenerateQuery(param *models.ParquetDestQuery) ([]*models.ParquetDestWritePayload, error) {
    rows := make([]map[string]any, 0, len(param.Records))

    for _, rec := range param.Records {
        rows = append(rows, rec.Data)
    }

    return []*models.ParquetDestWritePayload{
        {Rows: rows},
    }, nil
}
```

## Connection Casting

Unlike database connectors, file connectors have no dedicated per-connector cast helper in `cast/`. When you need the underlying `*parquet.File` from a generic `IDatabaseEngine` (e.g. an auxiliary connection), use the shared generic helper directly:

```go
// Cast IDatabaseEngine to the underlying Parquet file handle
file, err := cast.FromPointer[parquet.File](engine)
if err != nil {
    return fmt.Errorf("failed to cast to Parquet file handle: %v", err)
}

// file is of type *parquet.File
```

:::tip Connection Casting
`FetchRecords` already receives the concrete `*parquet.File` via `SourceDBConn` — you only need `cast.FromPointer` when working with a Parquet connection reached through `AuxiliaryDBConnMap`.
:::
