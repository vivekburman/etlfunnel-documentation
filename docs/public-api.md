# Public API

The public API lets a script, a CI job or another application start an ETLFunnel run and follow it to the end. It is the same run a person starts from the run form, started from a [preset](./presets) and authenticated by a [personal access token](./personal-access-token).

A typical use: a pipeline in CI finishes a deployment, calls the API to start the matching staging run, polls until it ends, and fails the pipeline if the run did not complete.

## The basics

| | |
| --- | --- |
| **Base path** | `/public/v1` on your ETLFunnel address, for example `https://your-studio.example.com/public/v1`. For the Docker install on the same machine that is `http://localhost:9022/public/v1`. |
| **Authentication** | `Authorization: Bearer efpat_...`. See [Personal Access Token](./personal-access-token). |
| **Format** | JSON in and out, camelCase names, numeric ids. |
| **Identity** | The token identifies you, and you identify the tenant, so there is no tenant in the path. |
| **Permissions** | Exactly yours, checked live on every call. Starting a run needs the run permission of the preset's tier (`run:dev`, `run:staging` or `run:production`). |
| **Versioning** | The version is in the path. Inside `v1` changes are only additive: new optional fields and new endpoints. A breaking change would be a `v2` next to `v1`. |

## Quick start

```bash
export BASE=http://localhost:9022/public/v1
export AUTH="Authorization: Bearer $ETLFUNNEL_TOKEN"

# 1. who am I, and which workspaces can I use?
curl -H "$AUTH" $BASE/me
curl -H "$AUTH" $BASE/workspaces

# 2. which presets do I have in workspace 5, for staging?
curl -H "$AUTH" "$BASE/workspaces/5/presets?tier=staging"

# 3. start a run from preset 12 on runner 3
curl -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"presetId": 12, "runnerId": 3}' \
  $BASE/workspaces/5/runs

# 4. poll it
curl -H "$AUTH" $BASE/workspaces/5/runs/981
```

Runner ids are the **ID** column of the Runner page. The API does not list runners.

## Endpoints

| Method and path | What it does |
| --- | --- |
| `GET /me` | Your id, username and tenant. |
| `GET /workspaces` | The workspaces you can use, each with `canRun`: the tiers you may run in there. |
| `GET /workspaces/{workspaceId}` | One workspace and your `canRun`. |
| `GET /workspaces/{workspaceId}/presets` | Your presets in the workspace. Query: `tier`, `search`, `pageNumber` (from 1), `pageSize` (1 to 25, default 25). |
| `GET /workspaces/{workspaceId}/presets/{presetId}` | One preset in full. |
| `POST /workspaces/{workspaceId}/runs` | Start a run from a preset. |
| `GET /workspaces/{workspaceId}/runs/{runId}` | A run's state, for polling. |
| `POST /workspaces/{workspaceId}/runs/{runId}/abort` | Ask a run to stop. |

A workspace you do not belong to, and a preset or run that is not in the workspace in the path, are `404`. The API never says whether they exist.

### Workspaces

```json
{ "rows": [ { "id": 5, "name": "Data Project", "canRun": ["dev", "staging"] } ] }
```

`canRun` is empty when you may look but not run.

### Presets

A preset, as the list and the single read return it:

```json
{
  "id": 12,
  "name": "nightly orders",
  "tier": "staging",
  "root": { "kind": "flow", "id": 41, "name": "orders-to-warehouse" },
  "settings": {
    "purpose": "Nightly orders load",
    "tags": ["orders"],
    "loggingLevel": "info",
    "pipelinesExecutionMode": "sequential",
    "retryPolicy": { "maxRetry": 3, "immediateRetry": false },
    "webhookId": 0
  },
  "machineOrchestrator": { "id": 7, "name": "split-by-id" },
  "hubBindings": { "41": { "sourceHubId": 3, "destinationHubId": 4, "auxiliaryHubId": 0 } },
  "broken": false,
  "createdAt": "2026-11-18T09:12:44Z"
}
```

- `loggingLevel` is `debug`, `info`, `warn`, `error`, `dpanic`, `panic` or `fatal`. `pipelinesExecutionMode` is `sequential`, `optimalParallel` or `allParallel`.
- `machineOrchestrator` appears only when the preset splits its runs across runners.
- `hubBindings` appears only on a dev preset, keyed by flow id.
- `broken: true` means something the preset points at was deleted; a run from it is refused. See [Run Presets](./presets#when-a-preset-breaks).

## Start a run

`POST /workspaces/{workspaceId}/runs`

The request names the preset and where the run runs.

```json
{
  "presetId": 12,
  "runnerId": 3,
  "overrides": { "purpose": "Nightly orders load, rerun", "loggingLevel": "debug" }
}
```

| Field | Meaning |
| --- | --- |
| `presetId` | Required. One of your presets in this workspace. |
| `runnerId` | The runner, for a run that is **not** split. |
| `runnerIds` | An ordered list of runners, for a run split across several. The first is the master. See [Runner at Scale](./distributed-runs). |
| `machineOrchestratorId` | The machine orchestrator for a split run. Optional when the preset already holds one; required when it has none; it can also name a different one. |
| `overrides` | Optional. Changes for this one run; see below. |

Send either `runnerId` or `runnerIds`, never both, and never neither: nothing is defaulted, because a preset holds no runner. A preset that holds a machine orchestrator is split, so it takes `runnerIds`.

The run is always started now. Schedules are not available through the API.

### Overrides

Only these fields can be changed for a run. A field you leave out stays as the preset has it.

| Field | Type |
| --- | --- |
| `purpose` | string, not empty |
| `tags` | list of strings |
| `loggingLevel` | one of the levels above |
| `pipelinesExecutionMode` | `sequential`, `optimalParallel` or `allParallel` |
| `retryPolicy` | `{ "maxRetry": 3, "immediateRetry": false }` |
| `webhookId` | a webhook of this workspace |

The root, the tier and the hub bindings cannot be changed, so a staging preset can never start a production run. Sending any other field is refused with `422` and the field's name, never silently ignored.

### The answer

A start returns `202 Accepted`:

```json
{
  "runId": 981,
  "status": "setup",
  "terminal": false,
  "effective": {
    "tier": "staging",
    "root": { "kind": "flow", "id": 41, "name": "orders-to-warehouse" },
    "runnerId": 3,
    "settings": { "purpose": "Nightly orders load, rerun", "tags": ["orders"], "loggingLevel": "debug", "pipelinesExecutionMode": "sequential", "retryPolicy": { "maxRetry": 3, "immediateRetry": false }, "webhookId": 0 }
  }
}
```

`effective` is what will actually run: the preset with your overrides applied.

A run can be created and then refused or fail to set up, for example because the stage has no package to run. The answer is still `202` with the new `runId`, but `status` is `error`, `terminal` is `true` and `message` says why. Always read `status`, not just the HTTP code.

## Follow a run

`GET /workspaces/{workspaceId}/runs/{runId}`

```json
{
  "runId": 981,
  "status": "in_progress",
  "terminal": false,
  "tier": "staging",
  "draft": false,
  "purpose": "Nightly orders load, rerun",
  "root": { "kind": "flow", "id": 41, "name": "orders-to-warehouse" },
  "releaseNumber": 14,
  "startedAt": "2026-11-22T02:00:03Z",
  "createdAt": "2026-11-22T02:00:01Z"
}
```

| `status` | Meaning | `terminal` |
| --- | --- | --- |
| `scheduled` | Waiting for its time | no |
| `setup` | Being prepared | no |
| `ready_to_pick` | Ready; waiting for a runner to take it | no |
| `picked` | A runner has taken it | no |
| `in_progress` | Running | no |
| `completed` | Ended | **yes** |
| `completed_with_errors` | A [split run](./distributed-runs) in which some machines did not complete; `message` says how many | **yes** |
| `error` | Failed or was refused; `message` says why | **yes** |
| `aborted` | Stopped on request | **yes** |

`releaseNumber` is set for staging and production runs, the package number that ran. `endedAt` and `message` appear when they apply.

:::warning `completed` means ended
`completed` says the run ended. It does not promise that no row failed: errors a flow logs while it runs are in the run's metrics and logs. Treat `completed_with_errors`, `error` and `aborted` as not successful, and check the run's report in ETLFunnel for the detail.
:::

Poll on an interval of a few seconds. Any run in a workspace you belong to can be read, as in the run list.

## Abort

`POST /workspaces/{workspaceId}/runs/{runId}/abort` asks the run to stop and answers `{"aborted": true}`. The run's tier decides which permission you need. For a split run the abort reaches every machine.

## Errors

Every failure has the same shape:

```json
{ "error": { "code": "invalid_field", "message": "...", "details": { "field": "tags" } } }
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not valid JSON of this shape, or an id or page is wrong. |
| 401 | `unauthorized` | No `Authorization` header, a wrong token, or one that was regenerated or deleted. |
| 403 | `forbidden` | You lack the run permission for that tier ("permission required: run:staging"). |
| 404 | `not_found` | A workspace, preset or run that is not yours or not there. |
| 409 | `preset_name_taken`, `stale_version` | A conflicting write. |
| 422 | `invalid_field` | A field that cannot be set or is missing; `details.field` names it. |
| 422 | `preset_invalid` | The preset or the runner choice is refused: no runner, both `runnerId` and `runnerIds`, a runner listed twice, a split run with no machine orchestrator, and so on. The message says which. |

`code` values are stable; `message` is for a person. Other coded refusals of a run (for example a stage with no package) keep their own stable `code`.

## Good to know

- **Repeating a call starts another run.** There are no idempotency keys, and a person may start the same run again and again, so a retry after a timeout can start a second run. Read the run first if that matters to you.
- **No rate limit and no overlap rule.** The API does not stop two runs of the same flow at once.
- **Logs are not in v1.** Read a run's logs and metrics in ETLFunnel.
- **Presets are read-only here.** Create and edit them in the screen.
- **MCP is separate.** The API's token is not used for [MCP](./mcp), which keeps its own login.

## A CI example

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE="$STUDIO_URL/public/v1"
AUTH="Authorization: Bearer $ETLFUNNEL_TOKEN"

run=$(curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"presetId\": $PRESET_ID, \"runnerId\": $RUNNER_ID}" \
  "$BASE/workspaces/$WORKSPACE_ID/runs")
id=$(echo "$run" | jq -r .runId)

while true; do
  state=$(curl -fsS -H "$AUTH" "$BASE/workspaces/$WORKSPACE_ID/runs/$id")
  [ "$(echo "$state" | jq -r .terminal)" = "true" ] && break
  sleep 10
done

status=$(echo "$state" | jq -r .status)
echo "run $id ended: $status $(echo "$state" | jq -r '.message // empty')"
[ "$status" = "completed" ]
```
