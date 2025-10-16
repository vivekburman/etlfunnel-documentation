# MySQL

MySQL databases serve as versatile components in ETL pipelines, functioning both as source systems for data extraction and destination systems for data loading. Our ETL tool provides comprehensive MySQL integration capabilities, supporting multiple data extraction methods and efficient data loading operations.

## Source Database Operations

MySQL databases can serve as data sources using several extraction methods, each optimized for different use cases and performance requirements.

### Data Extraction Methods

The MySQL source interface supports three primary extraction approaches through these interface methods:

```go
type IClientDBMySQLSource interface {
    FetchRecords(param *models.MySQLSourceFetch) <-chan map[string]any
    GenerateQuery(param *models.MySQLSourceQuery) (*models.MySQLSourceQueryTune, error)
    GenerateBinLog(pram *models.MySQLSourceBinlog) (*models.MySQLSourceBinlogTune, error)
}
```

- **Record Fetching** - Provides full control over data reading, streaming records one at a time via channels
- **Query Generation** - Dynamic query construction for complex data transformations  
- **Binary Log Processing** - Real-time change data capture using MySQL's binlog functionality

### Source Configuration Structure

When configuring MySQL as a source database, the system uses these struct definitions:

```go
// Source operations
type MySQLSourceFetch struct {
    PipelineName      string
    SourceDBConn      *client.Conn
    AuxilaryDBConnMap map[string]IDatabaseEngine
    DestDBConn        IDatabaseEngine
}

type MySQLSourceQuery struct {
    PipelineName      string
    SourceDBConn      *client.Conn
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}

type MySQLSourceBinlog struct {
    PipelineName      string
    SourceDBConn      *client.Conn
    DestDBConn        IDatabaseEngine
    AuxilaryDBConnMap map[string]IDatabaseEngine
}
type MySQLSourceQueryTune struct {
	Query string
}

type MySQLSourceBinlogTune struct {
	ServerID uint32
}
```

These structures provide:

- **Pipeline Name** - Unique identifier for the ETL operation
- **Source DB Connection** - Direct MySQL connection instance for data extraction
- **Destination DB Connection** - Target database interface for processed data
- **Auxiliary DB Connections** - Additional database connections for lookup operations and data enrichment

### Example Source
```go
func (c *IUseConnector) FetchRecords(param *MySQLSourceFetch) <-chan map[string]any {
	ch := make(chan map[string]any)

	go func() {
		defer close(ch)

		rows, err := param.SourceDBConn.Query("SELECT id, name FROM " + param.Ctx.GetName() + " LIMIT 5")
		if err != nil {
			log.Println("query error:", err)
			return
		}
		defer rows.Close()

		cols, _ := rows.Columns()
		for rows.Next() {
			// create a slice of interface{} to hold each column value
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}

			if err := rows.Scan(ptrs...); err != nil {
				log.Println("scan error:", err)
				continue
			}

			// map column names to values
			record := map[string]any{}
			for i, col := range cols {
				record[col] = vals[i]
			}
			ch <- record
		}
	}()

	return ch
}

func (c *IUseConnector) GenerateQuery(param *MySQLSourceQuery) (*MySQLSourceQueryTune, error) {
	query := fmt.Sprintf("SELECT * FROM %s LIMIT 10", param.Ctx.GetName())
	return &MySQLSourceQueryTune{Query: query}, nil
}

func (c *IUseConnector) GenerateBinLog(param *MySQLSourceBinlog) (*MySQLSourceBinlogTune, error) {
	// To establish a replication connection with a unique server ID.
	// Here we mock with a static server ID for simplicity.
	return &MySQLSourceBinlogTune{
		ServerID: 1234, // unique replication client ID
	}, nil
}
```

## Destination Database Operations

MySQL databases can also function as destinations for processed data, supporting efficient data loading and transformation operations.

### Data Loading Capabilities

The MySQL destination interface provides structured data loading operations:

```go
type IClientDBMySQLDest interface {
    GenerateQuery(param *models.MySQLDestQuery) (*models.MySQLDestQueryTune, error)
}
```

This interface enables:

- **Query Generation** - Optimized INSERT, UPDATE, and UPSERT operations
- **Batch Processing** - Efficient handling of large record sets

### Destination Configuration Structure

When using MySQL as a destination, the system uses this struct definition:

```go
// Destination operations
type MySQLDestQuery struct {
    PipelineName      string
    Record            map[string]any
    SourceDBConn      IDatabaseEngine
    DestDBConn        *client.Conn
    AuxilaryDBConnMap map[string]IDatabaseEngine
}
```

This structure manages:

- **Pipeline Identification** - Links destination operations to specific ETL workflows
- **Record Processing** - Handles individual data records for transformation and loading
- **Connection Management** - Maintains source, destination, and auxiliary database connections
- **Data Mapping** - Ensures proper field mapping between source and destination schemas

### Example Destination
```go
func (c *IUseConnector) GenerateQuery(param *models.MySQLDestQuery) (*models.MySQLDestQueryTune, error) {
// Example: simple INSERT query generator
	columns := ""
	values := ""
	args := []any{}

	i := 0
	for k, v := range param.Record {
		if i > 0 {
			columns += ", "
			values += ", "
		}
		columns += k
		values += "?"
		args = append(args, v)
		i++
	}

	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		param.Ctx.GetName(), columns, values)

	return &models.MySQLDestQueryTune{
		Query:           query,
		Value:           args,
		RecordsPerBatch: 100, // Example batch size
	}, nil
}
```

## Database Connection Casting

### IDatabaseEngine Interface

The `IDatabaseEngine` interface provides a unified abstraction layer for database connections, enabling seamless integration across different database types while maintaining type safety.

### Connection Management

The system includes built-in functionality to cast generic database engine interfaces to specific MySQL connections when needed. This allows developers to:

- **Access Underlying Connections** - Retrieve the actual MySQL connection instance for advanced operations
- **Maintain Type Safety** - Ensure proper connection types throughout the ETL pipeline
- **Handle Connection Validation** - Verify connection integrity before performing database operations

#### Connection Casting Example

```go
// Cast IDatabaseEngine to MySQL connection
mysqlConn, err := CastAsMySQLDBConnection(engine)
if err != nil {
    return fmt.Errorf("failed to cast to MySQL connection: %v", err)
}

// Now you can use the underlying MySQL connection directly
// mysqlConn is of type *client.Conn
```

The casting function handles:
- **Nil Safety** - Validates input parameters before processing
- **Type Validation** - Ensures the interface contains a valid MySQL connection
- **Field Extraction** - Retrieves the ConnectorInstance field from the database engine
- **Error Handling** - Provides detailed error messages for troubleshooting

:::tip Connection Casting
This automatically handles database connection casting, allowing you to work with generic database interfaces while maintaining access to MySQL-specific functionality when required.
:::