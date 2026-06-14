# Incident Backlog

Backlog hooks are triggered when write operations to the destination fail, providing a critical safety net for handling failed records. These hooks enable incident management and failure tracking to ensure data integrity and pipeline reliability.

## Overview

While checkpoint hooks handle successful commits, backlog hooks are invoked when data writes fail. This complementary mechanism allows you to:

- Store failed records for later processing
- Maintain data integrity during system outages

## Backlog Specification

Your backlog function must implement the following signature:

```go
func Backlog(param *models.BacklogProps) (*models.BacklogTune, error)
```

### Parameters

```go
type BacklogProps struct {
	State              models.IPipelineRuntimeState
	SourceDBConn       models.IDatabaseEngine
	DestDBConn         models.IDatabaseEngine
	AuxiliaryDBConnMap map[string]models.IDatabaseEngine
	Records            []map[string]any
	FailureStage       models.FailureStage
	Err                error
}
```

### Return Value

```go
type BacklogTune struct {
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

type FailureStage int

const (
	FailureStageNone        FailureStage = iota
	FailureStageTransform
	FailureStageDestination
)

type IPipelineRuntimeState interface {
	GetName() string
	GetFlowName() string
	GetReplicaProps() map[string]any
	GetLogger() models.ILoggerContract
	GetDestinationWriteBatchSize() int
}
```

## Benefits of Using Backlog Hooks

- **Incident Management**: Capture and track failed records for operational visibility
- **Data Recovery**: Store failed records for manual review and reprocessing

## Implementation Example

```go
import (
	"encoding/json"
	"etlfunnel/execution/models"
	"etlfunnel/database/cast"
	"fmt"
	"time"
)

func Backlog(param *models.BacklogProps) (*models.BacklogTune, error) {
	mysqlConn, err := cast.CastAsMySQLDBConnection(param.AuxiliaryDBConnMap["mysql"])
	if err != nil {
		return nil, err
	}

	query := `
		INSERT INTO failed_records
		(pipeline_name, record_id, record_data, failure_timestamp, retry_count, status)
		VALUES (?, ?, ?, ?, 0, 'pending')
	`

	for _, record := range param.Records {
		recordJSON, _ := json.Marshal(record)
		recordID := fmt.Sprintf("%v", record["id"])

		_, err := mysqlConn.Exec(query,
			param.State.GetName(),
			recordID,
			string(recordJSON),
			time.Now().UTC(),
		)
		if err != nil {
			continue
		}
	}

	return &models.BacklogTune{Action: models.ActionContinue}, nil
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