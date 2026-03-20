# Runtime

Every hook in the data plane — transformers, checkpoints, backlogs, termination rules — receives access to an `IPipelineRuntimeState` object via the `State` field on their props struct. This is your live handle to the running pipeline: use it to read context, control execution behavior, and emit structured logs from within your hook code.

---

## The Interface

```go
type IPipelineRuntimeState interface {
    GetName() string
    GetFlowName() string
    GetLogger() ILoggerContract
    GetPipelineBatchSize() int
    SetPipelineBatchSize(int)
}
```

Five methods. Each one has a distinct purpose in day-to-day hook development.

---

## Methods Reference

### `GetName() string`

Returns the name of the currently executing pipeline. Useful for scoping log messages, audit records, and metrics to the specific pipeline that produced them.

```go
func Checkpoint(param *models.CheckpointProps) (*models.CheckpointTune, error) {
    pipelineName := param.State.GetName()
    // e.g. "user_profile_sync"
}
```

### `GetFlowName() string`

Returns the name of the parent flow — the logical grouping that contains this pipeline. Use this when you need to attribute activity to a flow rather than an individual pipeline, for example when writing cross-pipeline aggregate metrics.

```go
func Checkpoint(param *models.CheckpointProps) (*models.CheckpointTune, error) {
    flowName := param.State.GetFlowName()
    // e.g. "users_flow"
}
```

### `GetLogger() ILoggerContract`

Returns the pipeline's structured logger. This is the recommended way to emit logs from inside any hook — it automatically carries pipeline and flow context through to your log aggregation backend, without any manual field injection.

See [Logging](#logging) below for the full logger interface and usage examples.

### `GetPipelineBatchSize() int`

Returns the current batch size — how many records are grouped together before a write is attempted to the destination. The default is `1` (per-record commits). Any changes made via `SetPipelineBatchSize` are immediately reflected here.

### `SetPipelineBatchSize(int)`

Sets the batch size for all subsequent destination writes in this pipeline run. This is a live, thread-safe mutation — you can call it from a transformer or checkpoint to dynamically tune batching behavior based on data characteristics observed at runtime.

See [Dynamic Batch Sizing](#dynamic-batch-sizing) below for practical patterns.

---

## Logging

The logger returned by `GetLogger()` implements `ILoggerContract`:

```go
type ILoggerContract interface {
    Info(msg string, fields ...zap.Field)
    Error(msg string, fields ...zap.Field)
    ErrorWithNotify(msg string, fields ...zap.Field)
    Warn(msg string, fields ...zap.Field)
    Debug(msg string, fields ...zap.Field)
    DPanic(msg string, fields ...zap.Field)
    Panic(msg string, fields ...zap.Field)
    Fatal(msg string, fields ...zap.Field)
}
```

All methods follow the structured logging convention via `zap.Field` arguments, meaning your log output is machine-parseable and filterable by pipeline name, flow name, and any fields you attach.

### Log levels

| Method | When to use |
|--------|-------------|
| `Debug` | Verbose tracing during development — field values, intermediate states |
| `Info` | Routine operational events — checkpoint completed, batch committed |
| `Warn` | Unexpected but non-fatal conditions — missing optional fields, fallback logic triggered |
| `Error` | Failures that were handled — backlog insertion error, auxiliary DB unavailable |
| `ErrorWithNotify` | Same as `Error`, but also fires your configured webhook notification |
| `Fatal` | Unrecoverable startup errors — almost never appropriate inside hook code |

### `ErrorWithNotify`

`ErrorWithNotify` behaves identically to `Error` but additionally triggers the webhook notification configured on the build (Slack or Teams). Use this when you want on-call teams alerted immediately, without implementing your own alerting logic inside the hook.

```go
func Backlog(param *models.BacklogProps) (*models.BacklogTune, error) {
    logger := param.State.GetLogger()

    if len(param.Records) > 500 {
        logger.ErrorWithNotify("High-volume backlog event detected",
            zap.Int("failed_count", len(param.Records)),
            zap.String("pipeline", param.State.GetName()),
        )
    }
    // ...
}
```

### Logging example — transformer

```go
import "go.uber.org/zap"

func Transformer(param *models.TransformerProps) (map[string]any, error) {
    logger := param.State.GetLogger()

    logger.Debug("Processing record",
        zap.Any("record_id", param.Record["id"]),
    )

    email, ok := param.Record["email"].(string)
    if !ok || email == "" {
        logger.Warn("Skipping record: missing or invalid email",
            zap.Any("record_id", param.Record["id"]),
        )
        return nil, nil // skip record
    }

    result := map[string]any{
        "id":    param.Record["id"],
        "email": strings.ToLower(email),
    }

    logger.Info("Record transformed successfully",
        zap.Any("record_id", param.Record["id"]),
    )

    return result, nil
}
```

---

## Dynamic Batch Sizing

By default, every record is committed to the destination individually (`RecordsPerBatch = 1`). For high-throughput pipelines this is often too conservative — committing in batches of 100, 500, or 1000 records can dramatically reduce round-trips and improve throughput.

`SetPipelineBatchSize` lets you adjust this from within any hook at any point during the pipeline run.

### Setting batch size once, on the first record

```go
func Transformer(param *models.TransformerProps) (map[string]any, error) {
    if param.State.GetPipelineBatchSize() == 1 {
        param.State.SetPipelineBatchSize(500)
    }
    return param.Record, nil
}
```

### Adaptive batch sizing

React to what you observe in the data stream — shrink batches when individual records are unusually large:

```go
func Transformer(param *models.TransformerProps) (map[string]any, error) {
    logger := param.State.GetLogger()

    if payload, ok := param.Record["payload"].(string); ok {
        if len(payload) > 50_000 && param.State.GetPipelineBatchSize() > 50 {
            param.State.SetPipelineBatchSize(50)
            logger.Warn("Large payload detected — reducing batch size",
                zap.Int("payload_bytes", len(payload)),
                zap.Int("new_batch_size", 50),
            )
        }
    }

    return param.Record, nil
}
```

### Reading batch size in a checkpoint

```go
func Checkpoint(param *models.CheckpointProps) (*models.CheckpointTune, error) {
    logger := param.State.GetLogger()

    logger.Info("Checkpoint triggered",
        zap.Int("committed_records", len(param.Records)),
        zap.Int("batch_size", param.State.GetPipelineBatchSize()),
        zap.String("pipeline", param.State.GetName()),
        zap.String("flow", param.State.GetFlowName()),
    )

    return &models.CheckpointTune{Action: models.ActionContinue}, nil
}
```

---

## Accessing State Across All Hooks

`IPipelineRuntimeState` is available on the `State` field of every data-plane hook props struct:

| Hook | Props struct |
|------|-------------|
| Transformer | `TransformerProps` |
| Checkpoint | `CheckpointProps` |
| Backlog | `BacklogProps` |
| Termination Rule | `TerminateRuleProps` |
| Connector Entity (source/dest) | e.g. `PostgresSourceQuery`, `ElasticDestQuery` |

Because `GetName()` and `GetFlowName()` return the same values across all hooks for a given pipeline run, you can use them as consistent keys when writing to shared tracking tables from multiple hook types:

```go
// In Checkpoint
func Checkpoint(param *models.CheckpointProps) (*models.CheckpointTune, error) {
    upsertStats(param.AuxiliaryDBConnMap["mysql"],
        param.State.GetFlowName(), param.State.GetName(), "committed", len(param.Records))
    return &models.CheckpointTune{Action: models.ActionContinue}, nil
}

// In Backlog
func Backlog(param *models.BacklogProps) (*models.BacklogTune, error) {
    upsertStats(param.AuxiliaryDBConnMap["mysql"],
        param.State.GetFlowName(), param.State.GetName(), "failed", len(param.Records))
    return &models.BacklogTune{Action: models.ActionContinue}, nil
}
```

---

## Complete Example

```go
func Transformer(param *models.TransformerProps) (map[string]any, error) {
    logger   := param.State.GetLogger()
    pipeline := param.State.GetName()
    flow     := param.State.GetFlowName()

    if param.State.GetPipelineBatchSize() == 1 {
        param.State.SetPipelineBatchSize(250)
        logger.Info("Batch size initialized",
            zap.Int("batch_size", 250),
            zap.String("pipeline", pipeline),
            zap.String("flow", flow),
        )
    }

    id, hasID := param.Record["id"]
    if !hasID {
        logger.Warn("Skipping record: missing id field", zap.String("pipeline", pipeline))
        return nil, nil
    }

    email, ok := param.Record["email"].(string)
    if !ok || email == "" {
        logger.Warn("Skipping record: invalid email",
            zap.Any("record_id", id),
            zap.String("pipeline", pipeline),
        )
        return nil, nil
    }

    if strings.HasSuffix(email, "@internal.invalid") {
        logger.ErrorWithNotify("Suspicious email domain in production pipeline",
            zap.Any("record_id", id),
            zap.String("email", email),
            zap.String("pipeline", pipeline),
            zap.String("flow", flow),
        )
    }

    return map[string]any{
        "id":       id,
        "email":    strings.ToLower(email),
        "pipeline": pipeline,
        "flow":     flow,
    }, nil
}
```

---

## Best Practices

**Use `GetLogger()` instead of `fmt.Println` or `log.Println`.** The pipeline logger routes output to the ETLFunnel log aggregator, making it visible and searchable in the build dashboard. Plain stdout writes are invisible to the platform.

**Set batch size early, not on every record.** Set it once when the current value is still the default (`== 1`), or in direct response to a specific observed condition.

**Use `ErrorWithNotify` sparingly.** It fires your configured webhook on every call. Reserve it for events that genuinely require immediate human attention.

**Always attach `pipeline` and `flow` to Error and Warn log lines.** When debugging across many concurrent pipelines, these fields are the fastest way to narrow scope.

**Never call `Fatal` or `Panic` from hook code.** Return an `error` from your hook function instead — the engine handles failure propagation, retry scheduling, and backlog routing without crashing the runner.