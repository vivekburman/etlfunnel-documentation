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
func Checkpoint(param *models.CheckpointProps) (*models.CheckpointTune, error)
```

### Parameters

```go
type CheckpointProps struct {
	State              models.IPipelineRuntimeState
	SourceDBConn       models.IDatabaseEngine
	DestDBConn         models.IDatabaseEngine
	AuxiliaryDBConnMap map[string]models.IDatabaseEngine
	Records            []map[string]any
}
```

### Return Value

```go
type CheckpointTune struct {
	Action models.PipelineAction
}
```

### Referenced Types

```go
type PipelineAction int

const (
	ActionContinue PipelineAction = iota
	ActionStop
)

type IPipelineRuntimeState interface {
	GetName() string
	GetFlowName() string
	GetReplicaProps() map[string]any
	GetLogger() models.ILoggerContract
	GetDestinationWriteBatchSize() int
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
	"fmt"
	"time"
)

func Checkpoint(param *models.CheckpointProps) (*models.CheckpointTune, error) {
	mysqlConn, err := cast.CastAsMySQLDBConnection(param.AuxiliaryDBConnMap["mysql"])
	if err != nil {
		return nil, err
	}

	query := `
		INSERT INTO pipeline_audit_log
		(pipeline_name, record_id, commit_timestamp, record_data, processing_status)
		VALUES (?, ?, ?, ?, ?)
	`

	for _, record := range param.Records {
		recordJSON, _ := json.Marshal(record)
		recordID := fmt.Sprintf("%v", record["id"])

		_, err := mysqlConn.Exec(query,
			param.State.GetName(),
			recordID,
			time.Now().UTC(),
			string(recordJSON),
			"committed",
		)
		if err != nil {
			continue
		}
	}

	return &models.CheckpointTune{Action: models.ActionContinue}, nil
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