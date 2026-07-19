# EF Code Reference

Every structured log line the execution engine writes — whether it's a routine lifecycle event or a connector failure three layers deep — carries a stable `code` field. That code is what turns a pile of free-text log lines into something you can filter on, alert on, and recognize instantly, without ever grepping for a message string that might get reworded next release.

Codes follow one format: **`EF-{category}{number}`**

| Category       | Meaning                   |
| -------------- | ------------------------- |
| `M`            | Metric / lifecycle events |
| `E`            | Error events              |

The two streams are deliberately separate, and it's worth understanding why before you start querying either one.

## Two Log Streams

### `run.log` — everything, at your configured level

This is the general-purpose application log. It's written as one JSON object per line, rotates at 20 MB, and includes every level from `Debug` up to `Fatal` — whatever verbosity you picked in the build's **Logging Configuration** (see [Creating a New Build](creating-a-new-build.md#logging-configuration)). Most `run.log` lines don't carry an `EF-` code at all — only the ones significant enough to be documented here do.

Representative fields: `timestamp`, `level` (uppercase: `INFO`, `ERROR`, ...), `message`, `scope`, `pipeline_name`, `flow_name`, and — for coded events — `code`.

### `metric.log` — lifecycle and alerting only

This is a narrower, append-only stream (kept indefinitely) that only ever receives:

- Pipeline/flow lifecycle events (started, completed, stats snapshots)
- Rule and connection events (retries, terminate-rule triggers, network errors)
- **Alert events** — see below

Representative fields: `ts`, `level` (lowercase: `info`), `msg`, `code`, `pipeline_name`, `flow_name`.

`metric.log` is built to be cheap to parse and safe to poll continuously; `run.log` is built to be complete.

## Every `.Error()` Call Is Also an Alert

This is the one behavior worth internalizing: **you don't have to opt into alerting.** Any code path — engine internals or your own client-authored hooks — that calls `.Error()` on a scoped logger automatically also emits an `EF-M060` `pipeline alert` event to `metric.log`, tagged with the originating `scope` (`system` | `collection` | `flow` | `pipeline`) and the error string. This is how the **Webhook Integration** setting described in [Creating a New Build](creating-a-new-build.md#webhook-integration) knows when to fire — it's watching for `EF-M060` events, not polling `run.log` for anything that looks like an error.

Practically, this means: if you write a custom [transformer](transformer-hook.md), [termination rule](termination-rule-hook.md), or any other hook and you call `param.State.GetLogger().Error(...)`, that failure surfaces on the same alerting path as an internal connector failure — no extra plumbing required.

### Getting a scoped logger in your own code

Every hook and connector implementation receives an `IPipelineRuntimeState` (or the flow/collection-level equivalent), which exposes:

```go
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

```go
logger := param.State.GetLogger()
logger.Error("failed to enrich record", zap.String("record_id", id), zap.Error(err))
// → written to run.log with this pipeline's context fields
// → also emits EF-M060 "pipeline alert" to metric.log automatically
```

The logger returned is already scoped to the current pipeline/flow — you don't attach `pipeline_name`/`flow_name` yourself; the engine's context extraction does that for every call.

---

## EF-M: Metric Events

### Pipeline Lifecycle

| Code           | `msg`               | `end_reason` | Description                                                                    |
| -------------- | ------------------- | ------------ | ------------------------------------------------------------------------------ |
| `EF-M001`      | `pipeline started`  | —            | Pipeline has initialised and is about to begin processing records.             |
| `EF-M002`      | `pipeline complete` | `success`    | Pipeline finished cleanly — source exhausted, no errors.                       |
| `EF-M003`      | `pipeline complete` | `failure`    | Pipeline stopped due to an unrecoverable error (connection error, etc.).       |
| `EF-M004`      | `pipeline complete` | `terminated` | Pipeline was stopped early by a terminate rule (e.g. idle timeout, row limit). |

**Fields on `EF-M001`:** `job_pid`

**Fields on `EF-M002`/`EF-M003`/`EF-M004`:** `rows_source_read`, `rows_dest_committed`, `rows_transform_failed`, `rows_backlog_count`, `uptime_ms`, `end_reason`

Why it matters: this is the single most useful signal for "is my pipeline healthy right now" — `EF-M001` without a matching `EF-M002`/`003`/`004` for longer than expected usually means a pipeline is hung, not just slow.

### Pipeline Stats

| Code           | `msg`            | Description                                                           |
| -------------- | ---------------- | --------------------------------------------------------------------- |
| `EF-M010`      | `pipeline stats` | Periodic snapshot (every 60 s) of counters while pipeline is running. |

**Fields:** `rows_source_read`, `rows_dest_committed`, `rows_transform_failed`, `rows_backlog_count`, `uptime_ms`

This is what feeds the "Live" gauges (Total Rows Read, Transform Failures, etc.) on the default Grafana dashboard — it's a snapshot, not a delta, so downstream tooling can treat it as the current state rather than something to sum over time.

### Rule Events

| Code           | `msg`            | `event`                    | Description                                                                                   |
| -------------- | ---------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| `EF-M030`      | `pipeline event` | `terminate_rule_triggered` | A termination rule evaluated to true and stopped the pipeline.                                |
| `EF-M031`      | `pipeline event` | `dest_rule_change`         | Destination write rule changed mid-run (e.g. batch size tuned). *Reserved — not yet emitted.* |

**Fields on `EF-M030`:** `rule`, `reason`

If you're authoring a [termination rule](termination-rule-hook.md) and want to know which of your rules is actually firing in production, this is the code to filter `metric.log` on — the `rule` field carries the rule name you defined, not a generic identifier.

### Network / Connection

| Code           | `msg`            | `event`         | Description                                                                                 |
| -------------- | ---------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `EF-M040`      | `pipeline event` | `network_error` | A connection error was detected; pipeline context is cancelled and failure handling begins. |

**Fields:** `error`

### Control Flow

| Code           | `msg`            | `event` | Description                                                                |
| -------------- | ---------------- | ------- | -------------------------------------------------------------------------- |
| `EF-M050`      | `pipeline event` | `retry` | Pipeline is being retried after a failure. Exponential back-off may apply. |

**Fields:** `attempt`

A rising `attempt` count on the same `pipeline_name` without ever reaching `EF-M002` is the clearest early sign of a pipeline stuck in a retry loop — check `EF-E560` (pipeline exceeded max retries) as the eventual give-up point.

### Alerts

| Code           | `msg`            | Description                                                                                           |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `EF-M060`      | `pipeline alert` | Emitted automatically on every `.Error()` call across system, collection, flow, and pipeline loggers. |

**Fields:** `scope` (`system` \| `collection` \| `flow` \| `pipeline`), `error`

As covered above, this is not something any call site emits directly — it's a side effect wired into the logger itself, so it can never drift out of sync with what actually gets logged as an error.

---

## EF-E: Error Codes (`run.log`)

### EF-E1xx — Source errors

| Code           | `message`                                 |
| -------------- | ----------------------------------------- |
| `EF-E101`      | Source producer failed to produce records |
| `EF-E102`      | Source producer returned nil reader       |
| `EF-E103`      | Source cleanup failed                     |

### EF-E2xx — Destination errors

| Code           | `message`                               |
| -------------- | --------------------------------------- |
| `EF-E201`      | Failed to consume record at destination |
| `EF-E202`      | Destination flush failed                |
| `EF-E203`      | Backlog handler failed                  |
| `EF-E204`      | Checkpoint handler failed               |

If you've written a custom [backlog hook](backlog-hook.md) or [checkpoint hook](checkpoint-hook.md), `EF-E203`/`EF-E204` are what fire when *your* hook implementation itself returns an error — not when the underlying write fails (that's `EF-E201`/`EF-E202`).

### EF-E3xx — Connection / network errors

| Code           | `message`                                                                      |
| -------------- | ------------------------------------------------------------------------------ |
| `EF-E301`      | Failed to connect to source for flow orchestration                             |
| `EF-E302`      | Failed to connect to destination for flow orchestration                        |
| `EF-E303`      | Failed to connect to auxiliary hub for flow orchestration *(Warn — non-fatal)* |
| `EF-E304`      | Failed to connect to source for pipeline orchestration                         |
| `EF-E305`      | Failed to connect to destination for pipeline orchestration                    |
| `EF-E306`      | Failed to connect to auxiliary hub for pipeline orchestration                  |
| `EF-E307`      | Failed to connect to source for flow fixture                                   |
| `EF-E308`      | Failed to connect to destination for flow fixture                              |
| `EF-E309`      | Failed to connect to auxiliary hub for flow fixture *(Warn — non-fatal)*       |

Note the flow/pipeline split: `EF-E301`–`EF-E303` fire during [flow-level orchestration](resource-orchestrator.md), `EF-E304`–`EF-E306` during pipeline-level orchestration, and `EF-E307`–`EF-E309` during [fixture](fixture.md) setup/teardown connections specifically. Same failure kind, three different phases of the pipeline's life — the code tells you which one without reading the surrounding log context.

### EF-E4xx — Transform / logic errors

| Code           | `message`                       |
| -------------- | ------------------------------- |
| `EF-E401`      | Record transformation failed    |
| `EF-E402`      | Custom termination check failed |

`EF-E401` is what you'll see if your own [transformer](transformer-hook.md) function returns a non-nil error. `EF-E402` is the equivalent for a [termination rule](termination-rule-hook.md)'s `UserDefinedCheckFunc` panicking or erroring.

### EF-E5xx — System / setup errors

| Code           | `message`                                                  |
| -------------- | ---------------------------------------------------------- |
| `EF-E501`      | Pipeline initialization failed                             |
| `EF-E502`      | Failed to register termination rule                        |
| `EF-E503`      | Failed to register batch tune                              |
| `EF-E510`      | Invalid pipeline orchestration config                      |
| `EF-E511`      | Failed to copy collection definition                       |
| `EF-E512`      | Failed to get current directory                            |
| `EF-E513`      | Failed to read collection definition JSON file             |
| `EF-E514`      | Failed to get executable path                              |
| `EF-E515`      | Failed to read collection definition from either directory |
| `EF-E516`      | Failed to find shutdown file path                          |
| `EF-E520`      | Flow fixture failed                                        |
| `EF-E530`      | Uncaught panic                                             |
| `EF-E540`      | Graceful shutdown timed out                                |
| `EF-E550`      | Retry queue is full, pipeline dropped                      |
| `EF-E551`      | Flow queue is full, flow dropped                           |
| `EF-E560`      | Pipeline exceeded max retries                              |

This range is mostly process- and config-level failures rather than data-path failures — `EF-E530` in particular is the one to alert on unconditionally, since an uncaught panic terminates the process regardless of any retry policy configured.

### EF-E6xx — Source connector errors

Codes here are per-connector, per-*category*, not per log line — every connector gets 2–6 codes grouped by failure kind (dispatch/config, capture/read, decode/parse, protocol/CDC). If you're debugging a specific connector, filter on its codes rather than trying to guess from the message text, since messages are free-form per call site while the code is stable.

| Code           | Connector     | Category                                  |
| -------------- | ------------- | ----------------------------------------- |
| `EF-E601`      | Avro          | Dispatch/config error                     |
| `EF-E602`      | Avro          | Read/decode error                         |
| `EF-E603`      | Cassandra     | Dispatch/config error                     |
| `EF-E604`      | Cassandra     | Read/iterate error                        |
| `EF-E605`      | CSV           | Dispatch/config error                     |
| `EF-E606`      | CSV           | Read/decode error                         |
| `EF-E607`      | Elasticsearch | Dispatch/config error                     |
| `EF-E608`      | Elasticsearch | Request execution error                   |
| `EF-E609`      | Elasticsearch | Decode/response error                     |
| `EF-E610`      | Excel         | Dispatch/config error                     |
| `EF-E611`      | Excel         | Read/decode error                         |
| `EF-E612`      | FixedWidth    | Dispatch/config error                     |
| `EF-E613`      | FixedWidth    | Read/decode error                         |
| `EF-E614`      | JSON          | Dispatch/config error                     |
| `EF-E615`      | JSON          | Read/decode error                         |
| `EF-E616`      | Kafka         | Dispatch/config error                     |
| `EF-E617`      | Kafka         | Consume/capture error *(Warn)*            |
| `EF-E618`      | Maria         | Dispatch error                            |
| `EF-E619`      | Maria         | Query read error                          |
| `EF-E620`      | Maria         | Binlog/CDC error                          |
| `EF-E621`      | MongoDB       | Dispatch error                            |
| `EF-E622`      | MongoDB       | Query-build error                         |
| `EF-E623`      | MongoDB       | Capture/read error                        |
| `EF-E624`      | MongoDB       | Decode error                              |
| `EF-E625`      | MSSQL         | Dispatch error                            |
| `EF-E626`      | MSSQL         | Query read error                          |
| `EF-E627`      | MSSQL         | Service broker error                      |
| `EF-E628`      | MSSQL         | CDC/LSN error                             |
| `EF-E629`      | MySQL         | Dispatch error                            |
| `EF-E630`      | MySQL         | Query read error                          |
| `EF-E631`      | MySQL         | Binlog/CDC error                          |
| `EF-E632`      | Oracle        | Dispatch error                            |
| `EF-E633`      | Oracle        | Query read error                          |
| `EF-E634`      | Oracle        | CDC error                                 |
| `EF-E635`      | Parquet       | Dispatch/config error                     |
| `EF-E636`      | Parquet       | Read/decode error                         |
| `EF-E637`      | Postgres      | Dispatch error                            |
| `EF-E638`      | Postgres      | Query read error                          |
| `EF-E639`      | Postgres      | NOTIFY-based CDC error                    |
| `EF-E640`      | Postgres      | Logical replication protocol error        |
| `EF-E641`      | Postgres      | WAL decode error                          |
| `EF-E642`      | RabbitMQ      | Dispatch error                            |
| `EF-E643`      | RabbitMQ      | Execute error                             |
| `EF-E644`      | RabbitMQ      | Ack/protocol error                        |
| `EF-E645`      | RabbitMQ      | Parse error *(Warn)*                      |
| `EF-E646`      | Redis         | Dispatch error                            |
| `EF-E647`      | Redis         | Execute error                             |
| `EF-E648`      | Redis         | Key/pubsub/scan read error                |
| `EF-E649`      | Redis         | Stream/consumer-group error               |
| `EF-E650`      | REST API      | Dispatch error                            |
| `EF-E651`      | REST API      | Request-build error                       |
| `EF-E652`      | REST API      | Request-execute error                     |
| `EF-E653`      | REST API      | Extract/decode error                      |
| `EF-E654`      | REST API      | Webhook server error *(Warn on shutdown)* |

For the connectors documented under [Code Reference](sql-mysql.md), this is the range to watch alongside the connector's own docs: a `ParseFn` you author (e.g. on `MySQLSourceBinlogOptions`, `RedisSourceKeysOptions`) returning an error surfaces here under that connector's "read/decode" code, not under `EF-E401` — parsing errors during capture are distinct from transform errors, even though both come from client-authored functions.

### EF-E7xx — Destination connector errors

Same per-connector, per-category convention as `EF-E6xx`, scoped to the SQL-family destinations that log their own write errors directly. Other destinations (NoSQL, REST API, file-based) don't have dedicated codes here because their write failures propagate up through the bridge and are already covered by `EF-E201`/`EF-E202`.

| Code           | Connector | Category                 |
| -------------- | --------- | ------------------------ |
| `EF-E701`      | Oracle    | Commit/transaction error |
| `EF-E702`      | Oracle    | Write/execute error      |
| `EF-E703`      | Postgres  | Commit/transaction error |
| `EF-E704`      | Postgres  | Write/execute error      |
| `EF-E705`      | MySQL     | Commit/transaction error |
| `EF-E706`      | MySQL     | Write/execute error      |
| `EF-E707`      | Maria     | Commit/transaction error |
| `EF-E708`      | Maria     | Write/execute error      |
| `EF-E709`      | MSSQL     | Commit/transaction error |
| `EF-E710`      | MSSQL     | Write/execute error      |
