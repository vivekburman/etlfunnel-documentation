# Incident Backlog

Backlog hooks are triggered when write operations to the destination fail, providing a critical safety net for handling failed records. These hooks enable incident management and failure tracking to ensure data integrity and pipeline reliability.

## Overview

While checkpoint hooks handle successful commits, backlog hooks are invoked when data writes fail. This complementary mechanism allows you to:

- Store failed records for later processing
- Maintain data integrity during system outages

## Backlog Specification

Your backlog function must implement the following signature:

```go
func Backlog(param *models.IBacklogProps) (*models.BacklogTune, error)
```

### Parameters

The `IBacklogProps` struct provides access to:

```go
type PipelineAction int

const (
	ActionContinue PipelineAction = iota
	ActionStop
)

type BacklogTune struct {
	Action PipelineAction
}

type IBacklogProps struct {
    Ctx           IPipelineContextContract          // Request context for logging and operations
    Logger        ILoggerContract                   // Logger for logging any message
    Record        map[string]any                    // Failed data record
    SourceDB      IDatabaseEngine                   // Source database connection
    DestinationDB IDatabaseEngine                   // Destination database connection
    AuxilaryDB    map[string]IDatabaseEngine        // Additional database connections
}

```

## Benefits of Using Backlog Hooks

- **Incident Management**: Capture and track failed records for operational visibility
- **Data Recovery**: Store failed records for manual review and reprocessing

## Implementation Example

```go
import (
    "etlfunnel/execution/models"
    "etlfunnel/database/cast"
    "encoding/json"
    "time"
)

func Backlog(param *models.IBacklogProps) (*models.BacklogTune, error) {
	param.Logger.Error("Write failure detected, attempting to backlog record", zap.Any("record_id", param.Record["id"]))

	mysqlConn, err := cast.CastAsMySQLDBConnection(param.AuxilaryDB["mysql"])
	if err != nil {
		param.Logger.Error("Failed to cast MySQL connection for backlog", zap.Error(err))
		// CRITICAL FAILURE: Cannot even connect to the backlog DB. STOP.
		return nil, err
	}

	recordJSON, _ := json.Marshal(param.Record)

	query := `
		INSERT INTO failed_records 
		(pipeline_name, record_id, record_data, failure_timestamp, retry_count, status)
		VALUES (?, ?, ?, ?, 0, 'pending')
	`

	_, err = mysqlConn.Exec(query,
		param.Ctx.GetName(),
		param.Record["id"],
		string(recordJSON),
		time.Now().UTC(),
	)

	if err != nil {
		param.Logger.Error("Failed to store backlog record (Database EXEC failed)", zap.Error(err))
		return nil, err 
	}
    
	updateFailureStats(mysqlConn, param.Ctx.GetName())

	if isCriticalRecord(param.Record) {
		sendFailureAlert(param.Ctx, param.Record, param.Ctx.GetName())
	}

	param.Logger.Info("Record successfully backlogged. Continuing pipeline.", zap.Any("record_id", param.Record["id"]))
	return &models.BacklogTune{Action: ActionContinue}, nil 
}

func updateFailureStats(conn *client.Conn, pipelineName string) {
    query := `
        INSERT INTO pipeline_failure_stats (pipeline_name, last_failure_time, failure_count)
        VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE
        last_failure_time = VALUES(last_failure_time),
        failure_count = failure_count + 1
    `
    
    conn.Exec(query, pipelineName, time.Now().UTC())
}

func isCriticalRecord(record map[string]any) bool {
    // Example: mark high-value transactions as critical
    if priority, ok := record["priority"].(string); ok {
        return priority == "critical" || priority == "high"
    }
    return false
}

func sendFailureAlert(ctx context.Context, record map[string]any, pipeline string) {
    param.Logger.Error("Critical record failure alert"zap.String("pipeline", pipeline), zap.Any("record", record))
}
```

## Creating a Backlog Hook

1. Navigate to **Backlog** in the left navigation panel
2. Click **Create New** and provide a unique name
3. Implement your failure handling logic using the function signature above
4. Configure auxiliary databases for storing failed records and metrics

## Best Practices

- **Error Handling**: Handle auxiliary database failures gracefully to avoid cascading issues
- **Monitoring**: Track failure rates and patterns for operational insights