# Termination Rule

Termination rules provide configurable exit conditions for long-running or infinite pipelines, such as streaming-based or notification-based systems. These rules enable graceful shutdown when specific conditions are met, ensuring pipelines don't run indefinitely and consume unnecessary resources.

## Overview

While most pipelines naturally terminate after processing all records, some pipelines are designed to run continuously (streaming, event-driven, pub/sub). Termination rules provide a safety mechanism to:

- Exit after processing a maximum number of records
- Stop when the pipeline becomes idle (no new data)
- Terminate after a maximum execution time
- Apply custom termination logic based on pipeline state

## Termination Rule Specification

Your termination rule must implement the following signature:
```go
func TerminateRule(param *models.TerminateRuleProps) (*models.TerminateRuleTune, error)
```

### Parameters

```go
type TerminateRuleProps struct {
	State models.IPipelineRuntimeState
}
```

### Return Value

```go
type TerminateRuleTune struct {
	MaxRecords           *uint64        // nil disables this check entirely — there is no numeric default
	IdleTimeout          *time.Duration // nil disables this check entirely — there is no default duration
	MaxPipelineTime      *time.Duration // nil disables this check entirely — there is no default duration
	UserDefinedCheckFunc func(*models.CustomTerminateRuleCheckProps) (*models.TerminateRuleActionTune, error)
	CheckInterval        time.Duration // defaults to 1 * time.Second when left at its zero value
}
```

### Tune Function Return

```go
type TerminateRuleActionTune struct {
	RuleName string
	Reason   string
	Action   models.PipelineAction
}
```

### Tune Function Parameters

```go
type CustomTerminateRuleCheckProps struct {
	State         models.IPipelineRuntimeState
	LastMessageAt time.Time
	StartTime     time.Time
	TotalMessages uint64
}
```

### Referenced Types

```go
type PipelineAction int

const (
	ActionContinue PipelineAction = iota
	ActionStop
)

// Built-in rule name constants emitted by the platform's built-in checks.
const (
	TerminateRuleMaxRecords      = "MAX_RECORDS"
	TerminateRuleIdleTimeout     = "IDLE_TIMEOUT"
	TerminateRuleMaxPipelineTime = "MAX_PIPELINE_TIME"
)

type IPipelineRuntimeState interface {
	GetName() string
	GetFlowName() string
	GetReplicaProps() map[string]any
	GetLogger() models.ILoggerContract
	GetDestinationWriteBatchSize() int
}
```

## Benefits of Using Termination Rules

- **Resource Management**: Prevent runaway pipelines from consuming resources indefinitely
- **Cost Control**: Limit execution time for streaming pipelines in cloud environments
- **Graceful Shutdown**: Exit cleanly when business conditions are met
- **Custom Logic**: Implement domain-specific termination conditions

## Implementation Example
```go
import (
    "etlfunnel/execution/models"
    "time"
)

func TerminateRule(param *models.TerminateRuleProps) (*models.TerminateRuleTune, error) {
	maxRecords := uint64(10000)
	idleTimeout := 5 * time.Minute
	maxPipelineTime := 2 * time.Hour

	return &models.TerminateRuleTune{
		MaxRecords:      &maxRecords,
		IdleTimeout:     &idleTimeout,
		MaxPipelineTime: &maxPipelineTime,
		CheckInterval:   10 * time.Second,

		UserDefinedCheckFunc: func(checkProps *models.CustomTerminateRuleCheckProps) (*models.TerminateRuleActionTune, error) {
			currentHour := time.Now().Hour()
			isBusinessHours := currentHour >= 9 && currentHour < 18

			if !isBusinessHours {
				idleDuration := time.Since(checkProps.LastMessageAt)
				if idleDuration > 2*time.Minute {
					return &models.TerminateRuleActionTune{
						RuleName: "business-hours-idle",
						Action:   models.ActionStop,
						Reason:   "Outside business hours with 2+ minutes idle time",
					}, nil
				}
			}

			return &models.TerminateRuleActionTune{
				Action: models.ActionContinue,
			}, nil
		},
	}, nil
}
```

## Creating a Termination Rule

1. Navigate to **Termination Rules** in the left navigation panel
2. Click **Create New** and provide a unique name
3. Configure your termination conditions using the function signature above
4. Implement `TerminateRule` method however you want to tune.

## Best Practices

- **Choose Appropriate CheckInterval**: Balance responsiveness with performance overhead (typically 5-30 seconds); leaving it unset (zero value) defaults to checking every `1 * time.Second`
- **Log Termination Events**: Always log why a pipeline terminated for debugging and monitoring
- **Combine Conditions**: Use multiple termination conditions for robust shutdown behavior
- **Test Termination Logic**: Verify termination rules work correctly in development before production deployment

## Common Use Cases

### Streaming Pipelines
```go
maxRecords := uint64(1000000)
idleTimeout := 10 * time.Minute
return &models.TerminateRuleTune{
    MaxRecords:    &maxRecords,
    IdleTimeout:   &idleTimeout,
    CheckInterval: 30 * time.Second,
}
```

### Event-Driven Pipelines
```go
maxPipelineTime := 4 * time.Hour
idleTimeout := 15 * time.Minute
return &models.TerminateRuleTune{
    MaxPipelineTime: &maxPipelineTime,
    IdleTimeout:     &idleTimeout,
    CheckInterval:   20 * time.Second,
}
```

### Development/Testing
```go
maxRecords := uint64(100)
maxPipelineTime := 5 * time.Minute
return &models.TerminateRuleTune{
    MaxRecords:      &maxRecords,
    MaxPipelineTime: &maxPipelineTime,
    CheckInterval:   5 * time.Second,
}
```