# Incident Backlog

Backlog hooks are triggered when write operations to the destination fail, providing a critical safety net for handling failed records. These hooks enable incident management and failure tracking to ensure data integrity and pipeline reliability.

## Overview

While checkpoint hooks handle successful commits, backlog hooks are invoked when data writes fail. This complementary mechanism allows you to:

- Store failed records for later processing
- Maintain data integrity during system outages

## Backlog Specification

Your backlog function must implement the following signature:

```go
func Backlog(param *models.IBacklogParam)
```

### Parameters

The `IBacklogParam` struct provides access to:

```go
type IBacklogParam struct {
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
    "streamcraft/execution/models"
    "streamcraft/database/cast"
    "encoding/json"
    "time"
)

func Backlog(param *models.IBacklogParam) {
    param.Logger.Error("Write failure detected", zap.Any("record_id", param.Record["id"]))
    
    // Cast auxiliary database connection
    mysqlConn, err := cast.CastAsMySQLDBConnection(param.AuxilaryDB["mysql"])
    if err != nil {
        param.Logger.Error("Failed to cast MySQL connection", zap.Error(err))
        return
    }
    
    // Store failed record for retry
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
        param.Logger.Error("Failed to store backlog record", zap.Error(err))
        return
    }
    
    // Update failure statistics
    updateFailureStats(mysqlConn, param.Ctx.GetName())
    
    // Send alert for critical records
    if isCriticalRecord(param.Record) {
        sendFailureAlert(param.Ctx, param.Record, param.Ctx.GetName())
    }
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
    // Integration with alerting systems (Slack, PagerDuty, etc.)
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