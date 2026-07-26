# Avro

Avro object container files serve as file-based components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool reads and writes multi-part Avro directories, with an engine-driven full scan and a user-defined capture mode for full control over parsing.

## Source Operations

Avro files can serve as data sources using two extraction approaches, each optimized for different use cases.

### Data Extraction Methods

The Avro source interface supports two extraction approaches through these interface methods:

```go
type IClientDBAvroSource interface {
    GenerateScan(param *models.AvroSourceScan) (*models.AvroSourceScanOptions, error)
    FetchRecords(param *models.AvroSourceFetch) <-chan *models.Record
}
```

- **Full Scan** - The engine opens each part file in turn and streams rows as records, deriving the schema from the object container file's own header — no client parsing code required
- **User-Defined** - Gives clients full control over parsing; the engine still calls `GenerateScan` first to resolve the file list, then hands your `FetchRecords` implementation an opened `*ocf.Decoder` for each part in turn

### Source Configuration Structure

When configuring Avro as a source, the system uses these struct definitions:

```go
// Source operations
type AvroSourceScan struct {
    State              IPipelineRuntimeState
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type AvroSourceFetch struct {
    State              IPipelineRuntimeState
    SourceDBConn       *ocf.Decoder
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type AvroSourceScanOptions struct {
    Files          []string
    RowLimit       int // 0 = unlimited
    StartAfterPart int // 0 = start from the first part
    StartAfterRow  int // 0 = start from the first row
}
```

These structures provide:

- **Pipeline State** - Runtime state interface providing pipeline context, logger, and replica metadata
- **Source DB Connection** - The opened `*ocf.Decoder` for the part currently being streamed, available on `AvroSourceFetch` (user-defined mode only)
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment
- **Files** - Part filenames (relative to the connector's configured directory) to read, in order
- **RowLimit / StartAfterPart / StartAfterRow** - Resume support: cap how many rows to deliver, and skip ahead to a specific part/row (e.g. after a checkpoint); `0` means unlimited / start from the very first part or row

Note there is no schema-configuration field here — schema comes from the object container file header, so there is nothing equivalent to a query to author.

### Record Position Metadata

Full-scan reads stamp each delivered record's `Meta` with its position, using the shared file-source Meta-key constants:

| Key | Constant | Description |
|-----|----------|--------------|
| `_file_part` | `models.MetaFilePart` | 0-based index into `Files` |
| `_file_row` | `models.MetaFileRow` | 0-based row index within that file, resets per file |

Client-authored checkpoint hooks should reference these constants rather than raw string literals so producer and consumer can't drift apart.

### Example Source

```go
func (c *IUseConnector) GenerateScan(param *models.AvroSourceScan) (*models.AvroSourceScanOptions, error) {
    return &models.AvroSourceScanOptions{
        Files: []string{"orders_2024.avro"},
    }, nil
}

// FetchRecords is only invoked in user-defined capture mode.
func (c *IUseConnector) FetchRecords(param *models.AvroSourceFetch) <-chan *models.Record {
    ch := make(chan *models.Record)

    go func() {
        defer close(ch)

        for param.SourceDBConn.HasNext() {
            var data map[string]any
            if err := param.SourceDBConn.Decode(&data); err != nil {
                return
            }
            ch <- &models.Record{Data: data}
        }
    }()

    return ch
}
```

## Destination Operations

Avro files can also function as destinations for processed data, writing sequential, size-capped part files.

### Data Loading Capabilities

The Avro destination interface provides structured data loading operations:

```go
type IClientDBAvroDest interface {
    GenerateQuery(param *models.AvroDestQuery) ([]*models.AvroDestWritePayload, error)
    GenerateOptions(param *models.AvroDestQuery) (*models.AvroDestOptions, error)
}
```

This interface enables:

- **Batch Processing** - Receives a batch of records and returns one write payload per record
- **Options Generation** - A one-time hook, called before the pipeline starts writing, that controls part-rotation behavior (`WriteMode`, `FilePrefix`, `MaxRecordsPerPart`)

### Destination Configuration Structure

When using Avro as a destination, the system uses these struct definitions:

```go
// Destination operations
type AvroDestQuery struct {
    State              IPipelineRuntimeState
    Records            []*models.Record
    AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}

type AvroDestOptions struct {
    SchemaPath        string                // path to a .avsc file used verbatim as the schema for the whole run, instead of inferring one from the first row; "" (default) keeps the inference behavior
    CompressionCodec  AvroCompressionCodec  // OCF block compression codec; "" (default) means uncompressed
    MaxRecordsPerPart int                   // 0 = unlimited records per part
    WriteMode         WriteMode             // WriteModeOverwrite clears existing parts first; anything else (including WriteModeAppend, the zero value "") appends new parts
    FilePrefix        string                // "" resolves to "part"
}

type AvroDestWritePayload struct {
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

// AvroCompressionCodec selects the OCF block compression codec applied by an
// Avro destination. The zero value (AvroCompressionCodecNull) and "null"
// both mean uncompressed; matching is case-insensitive. Resolved once per
// run — hamba/avro's ocf.Encoder takes one codec per encoder, so this can't
// vary per record.
type AvroCompressionCodec string

const (
    AvroCompressionCodecNull      AvroCompressionCodec = ""
    AvroCompressionCodecDeflate   AvroCompressionCodec = "deflate"
    AvroCompressionCodecSnappy    AvroCompressionCodec = "snappy"
    AvroCompressionCodecZStandard AvroCompressionCodec = "zstandard"
)
```

This structure manages:

- **Pipeline State** - Runtime state interface providing pipeline context and logger
- **Records Processing** - Handles a batch of `*models.Record` for transformation and loading; use `Record.Data` to access field values
- **Part Rotation** - Once a part reaches `MaxRecordsPerPart` rows, the engine closes it and opens the next one automatically; `MaxRecordsPerPart: 0` means unlimited rows per part, and `FilePrefix: ""` resolves to `"part"`
- **Schema** - By default the engine auto-infers the Avro schema from the first row of the run via `buildAvroSchema`. Setting `SchemaPath` to a `.avsc` file path reads and validates that schema once and uses it verbatim for the entire run instead — mutually exclusive with inference, not layered on top of it; when set, inference never runs at all
- **CompressionCodec** - `AvroCompressionCodecDeflate`/`Snappy`/`ZStandard` (case-insensitive); `""` (default, `AvroCompressionCodecNull`) or `"null"` means uncompressed

### Example Destination

```go
func (c *IUseConnector) GenerateOptions(param *models.AvroDestQuery) (*models.AvroDestOptions, error) {
    return &models.AvroDestOptions{
        CompressionCodec:  models.AvroCompressionCodecSnappy,
        MaxRecordsPerPart: 50000,
        WriteMode:         models.WriteModeOverwrite,
        FilePrefix:        "export",
    }, nil
}

// Using a fixed schema instead of per-run inference:
func (c *IUseConnector) GenerateOptionsWithSchema(param *models.AvroDestQuery) (*models.AvroDestOptions, error) {
    return &models.AvroDestOptions{
        SchemaPath:        "schemas/orders.avsc",
        MaxRecordsPerPart: 50000,
        WriteMode:         models.WriteModeOverwrite,
        FilePrefix:        "export",
    }, nil
}

func (c *IUseConnector) GenerateQuery(param *models.AvroDestQuery) ([]*models.AvroDestWritePayload, error) {
    rows := make([]map[string]any, 0, len(param.Records))

    for _, rec := range param.Records {
        rows = append(rows, rec.Data)
    }

    return []*models.AvroDestWritePayload{
        {Rows: rows},
    }, nil
}
```

## Connection Casting

Unlike database connectors, file connectors have no dedicated per-connector cast helper in `cast/`. When you need the underlying `*ocf.Decoder` from a generic `IDatabaseConnInfo` (e.g. an auxiliary connection), use the shared generic helper directly:

```go
// Cast IDatabaseConnInfo to the underlying Avro decoder
decoder, err := cast.FromPointer[ocf.Decoder](engine)
if err != nil {
    return fmt.Errorf("failed to cast to Avro decoder: %v", err)
}

// decoder is of type *ocf.Decoder
```

:::tip Connection Casting
`FetchRecords` already receives the concrete `*ocf.Decoder` via `SourceDBConn` — you only need `cast.FromPointer` when working with an Avro connection reached through `AuxiliaryDBConnMap`.
:::
