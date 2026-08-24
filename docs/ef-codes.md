# EF Code Reference

Every structured log line the execution engine writes — whether it's a routine lifecycle event or a connector failure three layers deep — carries a stable `code` field. That code is what turns a pile of free-text log lines into something you can filter on, alert on, and recognize instantly, without ever grepping for a message string that might get reworded next release.

Codes follow one format: **`EF-{category}{number}`**

| Category       | Meaning                   |
| -------------- | ------------------------- |
| `M`            | Metric / lifecycle events |
| `E`            | Error events              |
| `R`            | Runner service events     |

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

### Flow Lifecycle

| Code           | `msg`               | `event`         | Description                                             |
| -------------- | ------------------- | --------------- | -------------------------------------------------------- |
| `EF-M020`      | `pipeline event`    | `flow_started`  | Flow has started execution. *Reserved — not yet emitted.* |
| `EF-M021`      | `pipeline event`    | `flow_stopped`  | Flow has completed or been cancelled. *Reserved — not yet emitted.* |

These sit one level above the per-pipeline `EF-M00x` codes above — a flow can contain multiple pipelines — but are not yet wired into the emitter.

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
| `EF-M032`      | `pipeline event` | `backlog_triggered`        | A [backlog hook](backlog-hook.md) returned `ActionContinue`, so the failed batch was queued to the backlog instead of stopping the pipeline. |
| `EF-M033`      | `pipeline event` | `checkpoint_triggered`     | A [checkpoint hook](checkpoint-hook.md) ran. Rate-limited to at most once per configured interval — not emitted on every checkpoint call. |

**Fields on `EF-M030`:** `rule`, `reason`

**Fields on `EF-M032`:** `backlog_action` (the failure stage that triggered the backlog write)

**Fields on `EF-M033`:** `checkpoint` (`continue` \| `stop`)

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
| `EF-E517`      | Invalid `--decryption-key` argument                         |
| `EF-E518`      | Decryption key was provided but failed to decrypt connection params; unrecoverable, process exits |
| `EF-E520`      | Flow fixture failed                                        |
| `EF-E530`      | Uncaught panic                                             |
| `EF-E540`      | Graceful shutdown timed out                                |
| `EF-E550`      | *Unused.* Previously "retry queue is full, pipeline dropped" — queues are unbounded now, so nothing is dropped. Reserved for future reassignment; don't expect to see it in logs. |
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

---

## EF-R: Runner Service Events

`EF-R` codes are written by the **runner service** — the process that polls for jobs,
compiles and launches the per-job execution-engine binaries, and syncs status/logs back to
the control-plane server. They appear in the runner service's own `service.log`, a
separate stream from `run.log`/`metric.log`, which belong to the per-job execution-engine
process. Like `EF-E`, an `EF-R` code marks a significant `Error`/`Warn`/`Fatal` line worth
filtering or alerting on; plain `Info`/`Debug` lines in `service.log` don't carry a code.

### EF-R1xx — Job process lifecycle & orchestration

| Code       | `message`                                                | Emitted from                                    |
| ---------- | --------------------------------------------------------- | ------------------------------------------------ |
| `EF-R101`  | Failed to create run log directory for build failure       | writing a codegen/compile failure to run.log     |
| `EF-R102`  | Failed to write build failure to run log                   | writing a codegen/compile failure to run.log     |
| `EF-R103`  | Failed to read lock file for jobID                         | updating a job's lock file with its process PID  |
| `EF-R104`  | Lock file for jobID was not valid JSON, overwriting *(Warn)* | updating a job's lock file with its process PID |
| `EF-R105`  | Failed to convert lock file details for jobID to string     | updating a job's lock file with its process PID  |
| `EF-R106`  | Failed to write processPID to lock file for jobID           | updating a job's lock file with its process PID  |
| `EF-R107`  | Failed to create shutdown file                             | aborting a job                                   |
| `EF-R108`  | failed to remove .abort file for job                       | aborting a job                                   |
| `EF-R109`  | Failed to remove folder                                    | clearing a job's artifacts after retries         |
| `EF-R111`  | Failed to read lock file details                            | clearing job artifacts                           |
| `EF-R112`  | Failed to push build failure log, will retry                | clearing artifacts for a job that failed to build |
| `EF-R113`  | Failed to create mark completed file for failed job         | clearing artifacts for a job that failed to build |
| `EF-R114`  | Failed to push final job log, will retry                    | clearing artifacts for a finished job            |
| `EF-R115`  | Failed to push final metric log, will retry                 | clearing artifacts for a finished job            |
| `EF-R116`  | Failed to mark job complete on server, will retry            | clearing artifacts for a finished job            |
| `EF-R117`  | Failed to create mark completed file                         | clearing artifacts for a finished job            |
| `EF-R118`  | Failed to check if file lock exists                          | picking up a new job to run                      |
| `EF-R119`  | Failed to read job definition JSON while picking job          | picking up a new job to run (reading its definition) |
| `EF-R120`  | Failed to create runtime code                                | picking up a new job to run (codegen)            |
| `EF-R121`  | Failed to compile code                                       | picking up a new job to run (compile)            |
| `EF-R122`  | Failed to fetch decryption key                                | picking up a new job to run                      |
| `EF-R123`  | Failed to shutdown process even after 60 sec wait *(Warn)*    | aborting a job                                   |
| `EF-R124`  | Failed to read lock file *(Warn)*                             | clearing job artifacts                           |
| `EF-R125`  | Error finding abort files                                     | identifying jobs marked to abort (used when aborting jobs and when picking up a new job) |
| `EF-R126`  | Error finding uploaded log files for run directory             | clearing artifacts for a completed job (checking its rollover logs are fully uploaded first) |
| `EF-R127`  | Error finding log files in run directory                        | clearing artifacts for a completed job (checking its rollover logs are fully uploaded first) |
| `EF-R128`  | Failed to read runs folder path                                  | clearing job artifacts                          |
| `EF-R129`  | Failed to read runs folder path                                   | picking up a new job to run                    |

### EF-R2xx — Control-plane HTTP sync

| Code       | `message`                                     | Emitted from                                          |
| ---------- | ----------------------------------------------- | -------------------------------------------------------- |
| `EF-R201`  | Failed to get runner process details             | reporting runner process stats to the server             |
| `EF-R202`  | Failed to convert RunJobProcessStatsData to string | reporting runner process stats to the server            |
| `EF-R203`  | Failed to create request for job status          | reporting runner process stats to the server              |
| `EF-R204`  | Failed to send request for job process stats      | reporting runner process stats to the server             |
| `EF-R205`  | Server returned non-OK status                    | reporting runner process stats to the server              |
| `EF-R206`  | Failed to create request for registering runner    | registering the runner with the server                  |
| `EF-R207`  | Failed to send request for registering runner       | registering the runner with the server                 |
| `EF-R208`  | Server error response                              | registering the runner with the server                 |
| `EF-R209`  | Failed to convert TriggerJobPojo to string          | updating job trigger status on the server               |
| `EF-R210`  | Failed to create request for job trigger status      | updating job trigger status on the server              |
| `EF-R211`  | Failed to send request for job status                | updating job trigger status on the server              |
| `EF-R212`  | Server returned non-OK status                         | updating job trigger status on the server             |
| `EF-R213`  | Failed to convert TriggerJobPojo to string             | marking a job complete on the server                  |
| `EF-R214`  | Error getting job json info for jobID                   | marking a job complete on the server                  |
| `EF-R215`  | Failed to create request for job end status             | marking a job complete on the server                 |
| `EF-R216`  | Failed to send request for job status                   | marking a job complete on the server                 |
| `EF-R217`  | Server returned non-OK status                             | marking a job complete on the server                |
| `EF-R218`  | Failed to create abort job file                           | marking a job deleted (404 from server)             |
| `EF-R219`  | Error getting job json info for jobID                      | updating a job's run status on the server           |
| `EF-R220`  | Failed to create request for job status                    | updating a job's run status on the server           |
| `EF-R221`  | Failed to send request for job status                       | updating a job's run status on the server          |
| `EF-R222`  | Server returned non-OK status                                | updating a job's run status on the server        |
| `EF-R223`  | Error getting job json info for jobID                          | acknowledging a job pick with the server         |
| `EF-R224`  | Failed to create request for job ack                           | acknowledging a job pick with the server         |
| `EF-R225`  | Failed to send request for job ack                              | acknowledging a job pick with the server        |
| `EF-R226`  | Server returned non-OK status                                     | acknowledging a job pick with the server      |
| `EF-R227`  | Failed to create request to get new jobs                           | polling the server for new jobs               |
| `EF-R228`  | Failed to send request to get new jobs                               | polling the server for new jobs             |
| `EF-R229`  | Server returned non-OK status                                          | polling the server for new jobs           |
| `EF-R230`  | error creating temp file                                                | downloading the new-jobs archive          |
| `EF-R231`  | error deleting temp file                                                 | downloading the new-jobs archive         |
| `EF-R232`  | error saving zip file                                                     | downloading the new-jobs archive       |
| `EF-R233`  | error extracting temp zip                                                  | downloading the new-jobs archive      |
| `EF-R234`  | Failed to create request to get new jobs                                    | polling the server for aborted jobs   |
| `EF-R235`  | Failed to send request to get new jobs                                       | polling the server for aborted jobs  |
| `EF-R236`  | Server returned non-OK status                                                  | polling the server for aborted jobs |
| `EF-R237`  | Failed to read response body                                                    | polling the server for aborted jobs |
| `EF-R238`  | Failed to parse abort job pojo                                                    | polling the server for aborted jobs |
| `EF-R239`  | Failed to create abort job file                                                    | polling the server for aborted jobs |

### EF-R3xx — Log & metric rollover upload

| Code       | `message`                                             | Emitted from                                             |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| `EF-R301`  | Error opening log file for jobID                           | pushing incremental run-log content to the server           |
| `EF-R302`  | Error getting file identity for jobID                        | pushing incremental run-log content to the server          |
| `EF-R303`  | Error getting log file info for jobID                          | pushing incremental run-log content to the server         |
| `EF-R304`  | Error seeking log file for jobID                                 | pushing incremental run-log content to the server        |
| `EF-R305`  | Error getting job json info for jobID                              | pushing incremental run-log content to the server       |
| `EF-R306`  | Error reading log file for jobID                                     | pushing incremental run-log content to the server      |
| `EF-R307`  | Failed to marshal JSON payload for job log                             | pushing incremental run-log content to the server     |
| `EF-R308`  | Failed to create request for job log                                     | pushing incremental run-log content to the server    |
| `EF-R309`  | Failed to send request for job log                                         | pushing incremental run-log content to the server   |
| `EF-R310`  | Failed to save log file state for job                                        | pushing incremental run-log content to the server  |
| `EF-R311`  | Server returned non-OK status for job log                                      | pushing incremental run-log content to the server |
| `EF-R312`  | Failed to read lock file for jobID *(Warn)*                                     | listing active jobs for the stats scheduler      |
| `EF-R313`  | Failed to read lock file details for jobID                                       | listing active jobs for the stats scheduler     |
| `EF-R314`  | Error getting job json info for jobID                                              | pushing rollover run logs to the server       |
| `EF-R315`  | Failed to upload rollover log file                                                   | pushing rollover run logs to the server     |
| `EF-R316`  | Failed to create marker file                                                           | pushing rollover run logs to the server   |
| `EF-R317`  | Error getting job json info for jobID                                                    | detecting rotated metric logs |
| `EF-R318`  | Failed to bootstrap metric tracker                                                          | detecting rotated metric logs |
| `EF-R319`  | Failed to detect metric file rotation                                                        | detecting rotated metric logs |
| `EF-R320`  | Failed to read runs folder path                                                                | listing active jobs for the stats scheduler |
| `EF-R321`  | Failed to read job definition, skipping this tick *(Warn)*                                       | tailing a job's live metric fold |
| `EF-R322`  | failed to remove rotated metric log after successful upload *(Warn)*                             | uploading a rotated metric-log zip to the server |
| `EF-R323`  | Failed to start metric pipeline                                                                    | tailing a job's live metric fold |
| `EF-R324`  | Failed to start live metric tracking                                                                | tailing a job's live metric fold |
| `EF-R325`  | Failed to tail active metric log                                                                     | tailing a job's live metric fold |
| `EF-R326`  | Error finding run directories                                                                          | pushing rollover run logs to the server |
| `EF-R327`  | Error finding uploaded log files for run directory                                                       | pushing rollover run logs to the server |
| `EF-R328`  | Error finding log files in run directory                                                                  | pushing rollover run logs to the server |
| `EF-R329`  | Failed to remove rollover log file after successful upload *(Warn)*                                         | pushing rollover run logs to the server |
| `EF-R330`  | Error finding run directories                                                                                 | detecting rotated metric logs |
| `EF-R331`  | Error finding metric log files in run directory                                                                 | detecting rotated metric logs |
| `EF-R332`  | Rotated metric log missing on recovery, generation is unrecoverable                                                | uploading a rotated metric-log zip to the server |
| `EF-R333`  | Failed to upload rotation, will retry on the next observation pass                                                   | uploading a rotated metric-log zip to the server |
| `EF-R334`  | Job removed with uploads still pending *(Warn)*                                                                        | removing a completed job from the metric manager (flush timeout) |
| `EF-R335`  | Failed to read tracker while checking pending uploads, treating as pending *(Warn)*                                       | checking whether a job has pending rotated-metric uploads |
| `EF-R336`  | Failed to persist active generation                                                                                          | recording the active metric-log generation in the tracker file |
| `EF-R337`  | Failed to persist unrecoverable generation                                                                                     | marking a metric-log generation unrecoverable in the tracker file |

### EF-R5xx — System / startup

| Code       | `message`                    | Emitted from                     |
| ---------- | ------------------------------- | ------------------------------------ |
| `EF-R501`  | Failed to start HTTP server *(Fatal)* | runner service startup, binding its API port |
