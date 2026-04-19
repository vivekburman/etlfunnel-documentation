# Destination Write Rule

Destination Write Rule is a control-plane hook that lets you dynamically adjust the number of records written to the destination in each batch while the pipeline is actively running. Rather than committing to a fixed batch size at pipeline startup, you can respond in real time to throughput signals, idle periods, or any external condition to keep your pipeline performing optimally.

## Overview

By default, a pipeline writes records to the destination one at a time (`RecordsPerBatch: 1`). Destination Write Rule gives you two levers:

- **Static sizing**: Set `RecordsPerBatch` in your init return to apply a fixed batch size for the entire run
- **Dynamic sizing**: Supply a `UserDefinedCheckFunc` that is called on every ticker tick, letting you call `SetDestinationWriteBatchSize` to raise or lower the batch size on the fly

The hook is evaluated on its own independent ticker and never blocks the main record-processing loop. If `UserDefinedCheckFunc` is `nil`, the batch size is held constant at the value set during initialisation.

## Destination Write Rule Specification

Your init function must implement the following signature:

```go
func DestinationWriteRule(param *models.DestinationWriteProps) (*models.DestinationWriteTune, error)
```

### Parameters

The `DestinationWriteProps` struct provides access to:

```go
type DestinationWriteProps struct {
    State  IPipelineRuntimeState // Live pipeline state — call SetDestinationWriteBatchSize here
    Logger ILoggerContract       // Logger for internal diagnostics
}
```

### Return Value

```go
type DestinationWriteTune struct {
    // RecordsPerBatch sets the initial (and static, if no UserDefinedCheckFunc is
    // provided) number of records committed to the destination per write operation.
    // Defaults to 1 when zero.
    RecordsPerBatch uint

    // CheckInterval controls how frequently UserDefinedCheckFunc is invoked.
    // Shorter intervals increase responsiveness at the cost of slightly higher
    // overhead. Defaults to 1 second when zero.
    CheckInterval time.Duration

    // UserDefinedCheckFunc is called on every ticker tick with current pipeline
    // metrics. Call param.State.SetDestinationWriteBatchSize(n) inside this
    // function to apply a new batch size. When nil, the batch size remains static.
    UserDefinedCheckFunc func(*CustomDestinationWriteCheckProps) error
}
```

### Tune Function Parameters

`UserDefinedCheckFunc` receives a `*CustomDestinationWriteCheckProps` on every tick:

```go
type CustomDestinationWriteCheckProps struct {
    State            IPipelineRuntimeState // Call SetDestinationWriteBatchSize to apply changes
    Logger           ILoggerContract       // Logger for tune-step diagnostics
    TotalMessages    uint64                // Total records processed since pipeline start
    SinceLastMessage time.Duration         // Time elapsed since the last record was processed
}
```

### Applying a Batch Size Change

Inside `UserDefinedCheckFunc`, use the following method on `param.State` to update the batch size atomically (safe to call concurrently with the record-processing loop):

```go
param.State.SetDestinationWriteBatchSize(newSize int)
```

To read back the current value at any point:

```go
current := param.State.GetDestinationWriteBatchSize()
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

    "go.uber.org/zap"
)

// DestinationWriteTune is called once before the pipeline loop starts.
// Set RecordsPerBatch for the initial batch size and supply a
// UserDefinedCheckFunc to adjust it dynamically on every tick.
func DestinationWriteRule(param *models.DestinationWriteProps) (*models.DestinationWriteTune, error) {
    param.Logger.Info("Initialising Destination Write Rule", zap.String("pipeline", param.State.GetName()))

    return &models.DestinationWriteTune{
        RecordsPerBatch: 10,           // start with batches of 10
        CheckInterval:   5 * time.Second,
        UserDefinedCheckFunc: tuneFunc,
    }, nil
}

func tuneFunc(param *models.CustomDestinationWriteCheckProps) error {
    current := param.State.GetDestinationWriteBatchSize()

    switch {
    // Pipeline appears idle — flush quickly with small batches
    case param.SinceLastMessage > 10*time.Second:
        if current != 1 {
            param.State.SetDestinationWriteBatchSize(1)
            param.Logger.Info("Batch size reduced: pipeline idle",
                zap.Duration("idle_for", param.SinceLastMessage),
                zap.Int("new_batch_size", 1),
            )
        }

    // High throughput — increase batch size to reduce write overhead
    case param.TotalMessages > 50000:
        if current < 100 {
            param.State.SetDestinationWriteBatchSize(100)
            param.Logger.Info("Batch size increased: high throughput",
                zap.Uint64("total_messages", param.TotalMessages),
                zap.Int("new_batch_size", 100),
            )
        }

    // Moderate throughput — mid-range batch size
    default:
        if current != 25 {
            param.State.SetDestinationWriteBatchSize(25)
            param.Logger.Info("Batch size set: normal throughput",
                zap.Int("new_batch_size", 25),
            )
        }
    }

    return nil
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
- **Guard Against No-ops**: Check the current batch size before calling `SetDestinationWriteBatchSize` to avoid redundant atomic writes on every tick
- **Log Size Changes**: Log every adjustment with the reason and new value — it makes performance investigations far easier
- **Account for Idle Periods**: Always handle the `SinceLastMessage > threshold` case explicitly to avoid holding a large in-memory batch with no incoming records
- **Keep Tune Logic Lightweight**: `UserDefinedCheckFunc` runs on a hot path; avoid blocking I/O calls inside it