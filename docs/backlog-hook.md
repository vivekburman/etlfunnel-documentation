# Incident Backlog

Backlog hooks are triggered when a record fails during the pipeline — either during transformation or during the destination write — providing a critical safety net for handling failed records. These hooks enable incident management and failure tracking to ensure data integrity and pipeline reliability.

## Overview

While checkpoint hooks handle successful commits, backlog hooks are invoked when a record fails, whether that failure happened during transformation (`FailureStageTransform`) or during the destination write (`FailureStageDestination`). This complementary mechanism allows you to:

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
	AuxiliaryDBConnMap map[string]models.IDatabaseConnInfo
	Records            []*models.Record
	FailureStage       models.FailureStage
}
```

The failure reason for each record is not on `BacklogProps` — it's on the record itself, via `Record.OutcomeError` (see below), since a single backlog batch can contain records that failed for different reasons.

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

// String returns "transform", "destination", or "none".
func (fs FailureStage) String() string

type Record struct {
	Data          map[string]any     // User-facing data that goes through transformations
	Meta          map[string]any     // Internal metadata preserved throughout pipeline
	OutcomeError  error              // Set by the framework once this record exits the transform or destination stage; nil until then
	OutcomeStatus RecordResultStatus // Set by the framework alongside OutcomeError; RecordResultUnset (zero value) until then
}

type RecordResultStatus int

const (
	RecordResultUnset RecordResultStatus = iota // zero value — no outcome recorded yet
	RecordResultCommitted
	RecordResultFailed
	RecordResultNotAttempted // batch aborted before this row was reached
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
	castmysql "etlfunnel/execution/cast/mysql"
	"etlfunnel/execution/models"
	"fmt"
	"time"
)

func Backlog(param *models.BacklogProps) (*models.BacklogTune, error) {
	mysqlConn, err := castmysql.CastAsMySQLConnection(param.AuxiliaryDBConnMap["mysql"])
	if err != nil {
		return nil, err
	}

	query := `
		INSERT INTO failed_records
		(pipeline_name, record_id, record_data, failure_stage, error_message, failure_timestamp, retry_count, status)
		VALUES (?, ?, ?, ?, ?, ?, 0, 'pending')
	`

	for _, record := range param.Records {
		recordJSON, _ := json.Marshal(record.Data)
		recordID := fmt.Sprintf("%v", record.Data["id"])

		errMsg := ""
		if record.OutcomeError != nil {
			errMsg = record.OutcomeError.Error()
		}

		_, err := mysqlConn.Client.Exec(query,
			param.State.GetName(),
			recordID,
			string(recordJSON),
			param.FailureStage.String(),
			errMsg,
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