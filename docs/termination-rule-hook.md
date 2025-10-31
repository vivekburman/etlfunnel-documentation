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

The `TerminateRuleProps` struct provides access to:
```go
type PipelineAction int

const (
	ActionContinue PipelineAction = iota
	ActionStop
)

type TerminateRuleProps struct {
	Ctx    IPipelineContextContract  // Pipeline context for metadata and operations
	Logger ILoggerContract           // Logger for tracking termination events
}

type CustomTerminateRuleCheckProps struct {
	Ctx           IPipelineContextContract  // Pipeline context
	Logger        ILoggerContract           // Logger instance
	TotalMessages uint64                    // Total messages processed so far
	LastMessageAt time.Time                 // Timestamp of last processed message
	StartTime     time.Time                 // Pipeline start timestamp
}

type TerminateRuleActionTune struct {
	Action PipelineAction  // Continue or Stop the pipeline
	Reason string          // Human-readable reason for termination
}

type TerminateRuleTune struct {
	// MaxRecords defines the maximum number of messages/records to process
	// before terminating the pipeline. When nil, no limit is enforced.
	MaxRecords *uint64

	// IdleTimeout specifies the duration of inactivity (no messages received)
	// before terminating the pipeline. When nil, no idle timeout is enforced.
	IdleTimeout *time.Duration

	// MaxPipelineTime sets the maximum total execution time for the pipeline
	// before terminating. When nil, no time limit is enforced.
	MaxPipelineTime *time.Duration

	// UserDefinedCheckFunc allows custom termination logic based on pipeline state.
	// This function is called at each CheckInterval and can return a custom
	// termination action. When nil, only built-in checks are performed.
	UserDefinedCheckFunc func(*CustomTerminateRuleCheckProps) (*TerminateRuleActionTune, error)

	// CheckInterval determines how frequently termination conditions are evaluated.
	// Shorter intervals provide more responsive termination but increase overhead.
	CheckInterval time.Duration
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
    "go.uber.org/zap"
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
			// Custom logic: Stop if it's past business hours and idle for 2 minutes
			currentHour := time.Now().Hour()
			isBusinessHours := currentHour >= 9 && currentHour < 18
			
			if !isBusinessHours {
				idleDuration := time.Since(checkProps.LastMessageAt)
				if idleDuration > 2*time.Minute {
					checkProps.Logger.Info("Terminating: Outside business hours and idle",
						zap.Duration("idle_duration", idleDuration),
						zap.Uint64("total_processed", checkProps.TotalMessages),
					)
					return &models.TerminateRuleActionTune{
						Action: models.ActionStop,
						Reason: "Outside business hours with 2+ minutes idle time",
					}, nil
				}
			}
			
			// Custom logic: Stop if error rate exceeds threshold
			errorRate := getErrorRate(checkProps.Ctx)
			if errorRate > 0.15 { // 15% error rate
				checkProps.Logger.Warn("Terminating: High error rate detected",
					zap.Float64("error_rate", errorRate),
					zap.Uint64("total_processed", checkProps.TotalMessages),
				)
				return &models.TerminateRuleActionTune{
					Action: models.ActionStop,
					Reason: "Error rate exceeded 15% threshold",
				}, nil
			}
			
			// Continue processing
			return &models.TerminateRuleActionTune{
				Action: models.ActionContinue,
			}, nil
		},
	}, nil
}

func getErrorRate(ctx models.IPipelineContextContract) float64 {
	// Example: Calculate error rate from pipeline metrics
	totalProcessed := ctx.GetMetric("total_processed")
	totalErrors := ctx.GetMetric("total_errors")
	
	if totalProcessed == 0 {
		return 0.0
	}
	
	return float64(totalErrors) / float64(totalProcessed)
}
```

## Creating a Termination Rule

1. Navigate to **Termination Rules** in the left navigation panel
2. Click **Create New** and provide a unique name
3. Configure your termination conditions using the function signature above
4. Implement `TerminateRule` method however you want to tune.

## Best Practices

- **Choose Appropriate CheckInterval**: Balance responsiveness with performance overhead (typically 5-30 seconds)
- **Log Termination Events**: Always log why a pipeline terminated for debugging and monitoring
- **Combine Conditions**: Use multiple termination conditions for robust shutdown behavior
- **Test Termination Logic**: Verify termination rules work correctly in development before production deployment

## Common Use Cases

### Streaming Pipelines
```go
maxRecords := uint64(1000000)
idleTimeout := 10 * time.Minute
return &TerminateRuleTune{
    MaxRecords:    &maxRecords,
    IdleTimeout:   &idleTimeout,
    CheckInterval: 30 * time.Second,
}
```

### Event-Driven Pipelines
```go
maxPipelineTime := 4 * time.Hour
idleTimeout := 15 * time.Minute
return &TerminateRuleTune{
    MaxPipelineTime: &maxPipelineTime,
    IdleTimeout:     &idleTimeout,
    CheckInterval:   20 * time.Second,
}
```

### Development/Testing
```go
maxRecords := uint64(100)
maxPipelineTime := 5 * time.Minute
return &TerminateRuleTune{
    MaxRecords:      &maxRecords,
    MaxPipelineTime: &maxPipelineTime,
    CheckInterval:   5 * time.Second,
}
```