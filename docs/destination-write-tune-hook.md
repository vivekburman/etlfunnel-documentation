# Destination Write Rule

Destination Write Rule is a control-plane hook that lets you dynamically adjust the number of records written to the destination in each batch while the pipeline is actively running. Rather than committing to a fixed batch size at pipeline startup, you can respond in real time to throughput signals, idle periods, or any external condition to keep your pipeline performing optimally.

## Overview

By default, a pipeline writes records to the destination one at a time (`RecordsPerBatch: 1`). Destination Write Rule gives you two levers:

- **Static sizing**: Set `RecordsPerBatch` in your init return to apply a fixed batch size for the entire run. Only a positive value is applied — returning `0` or a negative number is silently ignored and the batch size stays at whatever it already was (`1` on a fresh pipeline)
- **Dynamic sizing**: Supply a `UserDefinedCheckFunc` that is called on every ticker tick. Return a `models.DestinationWriteActionTune` with `NewBatchSize` set to adjust the batch size — the library applies the change. Return `nil` or `NewBatchSize: nil` to leave the current size unchanged.

The hook's ticker and the main record-reading loop are both cases in the same `select` statement, so a slow `UserDefinedCheckFunc` does delay the next record read — keep it lightweight (see Best Practices below). If `UserDefinedCheckFunc` is `nil`, the batch size is held constant at the value set during initialisation. Leaving `CheckInterval` at its zero value defaults the ticker to `1 * time.Second`.

## Destination Write Rule Specification

Your init function must implement the following signature:

```go
func DestinationWriteRule(param *models.DestinationWriteProps) (*models.DestinationWriteTune, error)
```

### Parameters

The `DestinationWriteProps` struct provides access to:

```go
type DestinationWriteProps struct {
	State  models.IPipelineRuntimeState
	Logger models.ILoggerContract
}
```

:::caution
`Logger` is not currently populated by the runtime — it is left as its zero value (`nil`) when `DestinationWriteProps` is constructed. Calling any method on it will panic. Use `param.State.GetLogger()` instead.
:::

### Return Value

```go
type DestinationWriteTune struct {
	RecordsPerBatch      int           // only applied when > 0; <= 0 is silently ignored and leaves the current batch size unchanged
	CheckInterval        time.Duration // defaults to 1 * time.Second when left at its zero value
	UserDefinedCheckFunc func(*models.CustomDestinationWriteCheckProps) (*models.DestinationWriteActionTune, error)
}
```

### Tune Function Return

`UserDefinedCheckFunc` returns a `*models.DestinationWriteActionTune` on every tick. The library reads `NewBatchSize` and applies it atomically. Return `nil` or leave `NewBatchSize` as `nil` to make no change.

```go
type DestinationWriteActionTune struct {
	NewBatchSize *int
}
```

### Tune Function Parameters

`UserDefinedCheckFunc` receives a `*CustomDestinationWriteCheckProps` on every tick:

```go
type CustomDestinationWriteCheckProps struct {
	State            models.IPipelineRuntimeState
	Logger           models.ILoggerContract
	TotalMessages    uint64
	SinceLastMessage time.Duration
}
```

:::caution
`Logger` is not currently populated by the runtime — it is left as its zero value (`nil`) when `CustomDestinationWriteCheckProps` is constructed. Calling any method on it will panic. Use `param.State.GetLogger()` instead.
:::

### Referenced Types

```go
type IPipelineRuntimeState interface {
	GetName() string
	GetFlowName() string
	GetReplicaProps() map[string]any
	GetLogger() models.ILoggerContract
	GetDestinationWriteBatchSize() int
}

type ILoggerContract interface {
	Info(msg string, fields ...zap.Field)
	Error(msg string, fields ...zap.Field)
	Warn(msg string, fields ...zap.Field)
	Debug(msg string, fields ...zap.Field)
	DPanic(msg string, fields ...zap.Field)
	Panic(msg string, fields ...zap.Field)
	Fatal(msg string, fields ...zap.Field)
}
```

## Benefits of Using Destination Write Rule

- **Throughput Optimisation**: Increase batch sizes during high-volume bursts to reduce write round-trips
- **Idle Efficiency**: Shrink batch sizes during low-activity periods so records are not held in memory unnecessarily
- **Back-pressure Handling**: React to destination latency or queue depth without restarting the pipeline
- **Cost Control**: Minimise write operations in cloud-billed environments by batching more aggressively during peak flow
- **Zero-Downtime Tuning**: All adjustments happen in the running pipeline — no restarts required

## Implementation Example

```go
import (
    "etlfunnel/execution/models"
    "time"
)

func DestinationWriteRule(param *models.DestinationWriteProps) (*models.DestinationWriteTune, error) {
    return &models.DestinationWriteTune{
        RecordsPerBatch:      10,
        CheckInterval:        5 * time.Second,
        UserDefinedCheckFunc: tuneFunc,
    }, nil
}

func tuneFunc(param *models.CustomDestinationWriteCheckProps) (*models.DestinationWriteActionTune, error) {
    var newSize int

    switch {
    case param.SinceLastMessage > 10*time.Second:
        newSize = 1
    case param.TotalMessages > 50000:
        newSize = 100
    default:
        newSize = 25
    }

    return &models.DestinationWriteActionTune{NewBatchSize: &newSize}, nil
}
```

## Creating a Destination Write Rule Hook

1. Navigate to **Destination Write Rule** in the left navigation panel
2. Click **Create New** and provide a unique name
3. Implement `DestinationWriteRule` using the function signature above
4. Set `RecordsPerBatch` for the initial batch size
5. Optionally implement and assign a `UserDefinedCheckFunc` for dynamic tuning
6. Attach the hook to your pipeline in the pipeline settings

## Best Practices

- **Start Conservative**: Begin with a modest `RecordsPerBatch` (e.g., `10–50`) and scale up only when throughput data justifies it
- **Choose a Sensible `CheckInterval`**: Values between 1–30 seconds work well for most workloads; sub-second intervals add overhead without meaningful benefit
- **Return `nil` for No Change**: If no adjustment is needed, return `nil` or `&models.DestinationWriteActionTune{NewBatchSize: nil}` — the library skips the update
- **Account for Idle Periods**: Always handle the `SinceLastMessage > threshold` case explicitly to avoid holding a large in-memory batch with no incoming records
- **Keep Tune Logic Lightweight**: `UserDefinedCheckFunc` shares a `select` loop with record reads, so it genuinely blocks pipeline progress while it runs — avoid blocking I/O calls inside it