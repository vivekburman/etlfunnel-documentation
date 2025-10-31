# Save Checkpoint

Checkpoint hooks are triggered automatically by the pipeline whenever data is committed to the destination. These hooks provide a powerful mechanism to track data lineage, maintain audit logs, and perform post-commit operations across your ETL workflow.

## Overview

Every time your pipeline commits data to the destination database—whether in bulk or as individual records—the checkpoint hook is invoked. This happens after successful data writes, making it ideal for tracking committed records, maintaining synchronization states, and triggering downstream processes.

The commit behavior depends on your destination connector configuration:
- **Bulk commits**: Process multiple records in a single transaction
- **Individual commits**: Process one record at a time for real-time scenarios

## Checkpoint Specification

Your checkpoint function must implement the following signature:

```go
func Checkpoint(param *models.ICheckpointProps) (*models.CheckpointTune, error)
```

### Parameters

The `ICheckpointProps` struct provides access to:

```go
type PipelineAction int

const (
	ActionContinue PipelineAction = iota
	ActionStop
)

type ICheckpointProps struct {
    Ctx           IPipelineContextContract          // Request context for logging and operations
    Logger        ILoggerContract                   // Logger for logging any message
    Records       []map[string]any                  // Committed data records
    SourceDB      IDatabaseEngine                   // Source database connection
    DestinationDB IDatabaseEngine                   // Destination database connection
    AuxilaryDB    map[string]IDatabaseEngine        // Additional database connections
}

type CheckpointTune struct {
	Action PipelineAction
}
```

## Benefits of Using Checkpoints

- **Data Lineage Tracking**: Maintain complete audit trails for compliance and debugging
- **State Management**: Track processing states and resume points for pipeline recovery
- **Cross-System Synchronization**: Coordinate with external systems via notifications and updates
- **Metrics and Monitoring**: Collect real-time statistics on throughput, processing times, and success rates

## Implementation Example

```go
import (
	"encoding/json"
	"etlfunnel/execution/models"
	"etlfunnel/database/cast"
	"fmt"
	"time"

	"go.uber.org/zap"
)

func Checkpoint(param *models.ICheckpointProps) (*models.CheckpointTune, error) {
	param.Logger.Info("Checkpoint triggered",
		zap.Int("record_count", len(param.Records)),
		zap.String("pipeline", param.Ctx.GetName()),
	)

	mysqlConn, err := cast.CastAsMySQLDBConnection(param.AuxilaryDB["mysql"])
	if err != nil {
		param.Logger.Error("Failed to cast MySQL connection for audit log", zap.Error(err))
		return nil, err
	}

	query := `
		INSERT INTO pipeline_audit_log 
		(pipeline_name, record_id, commit_timestamp, record_data, processing_status)
		VALUES (?, ?, ?, ?, ?)
	`

	inserted := 0
	for _, record := range param.Records {
		recordJSON, _ := json.Marshal(record)
		recordID := "<unknown>"
		if id, ok := record["id"]; ok {
			recordID = toString(id)
		}

		_, err := mysqlConn.Exec(query,
			param.Ctx.GetName(),
			recordID,
			time.Now().UTC(),
			string(recordJSON),
			"committed",
		)

		if err != nil {
			param.Logger.Error("Failed to insert audit log record",
				zap.String("record_id", recordID),
				zap.Error(err),
			)
			continue
		}

		inserted++
		updatePipelineStats(mysqlConn, param.Ctx.GetName())

		if shouldTriggerNotification(record) {
			sendDownstreamNotification(param, record)
		}
	}

	param.Logger.Info("Checkpoint completed",
		zap.Int("total_records", len(param.Records)),
		zap.Int("audited_records", inserted),
	)

	return &models.CheckpointTune{Action: models.ActionContinue}, nil
}

func updatePipelineStats(conn any, pipelineName string) {
	query := `
		INSERT INTO pipeline_stats (pipeline_name, last_commit_time, record_count)
		VALUES (?, ?, 1)
		ON DUPLICATE KEY UPDATE
			last_commit_time = VALUES(last_commit_time),
			record_count = record_count + 1
	`
	conn.Exec(query, pipelineName, time.Now().UTC())
}

func shouldTriggerNotification(record map[string]any) bool {
	if amount, ok := record["transaction_amount"].(float64); ok {
		return amount > 10000.0
	}
	return false
}

func sendDownstreamNotification(param *models.ICheckpointProps, record map[string]any) {
	param.Logger.Info("Triggering downstream notification",
		zap.String("pipeline", param.Ctx.GetName()),
		zap.Any("record", record),
	)
}

func toString(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case []byte:
		return string(val)
	default:
		return fmt.Sprintf("%v", val)
	}
}

```

## Creating a Checkpoint Hook

1. Navigate to **Checkpoints** in the left navigation panel
2. Click **Create New** and provide a unique name
3. Implement your logic in the code editor using the function signature above
4. Configure auxiliary databases in pipeline settings if needed

## Best Practices

- **Error Handling**: Handle auxiliary database connection failures gracefully
- **Performance**: Keep checkpoint operations lightweight to avoid slowing down the pipeline
- **Idempotency**: Design checkpoints to handle duplicate executions safely
- **Monitoring**: Log checkpoint activities for debugging and performance analysis
- **Resource Management**: Properly manage database connections and close resources when needed