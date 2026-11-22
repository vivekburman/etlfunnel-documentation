# Runner at Scale: Distributed Runs

Some jobs are too big for one machine: ten terabytes from Postgres to Elastic, a table with billions of rows, an export that has to finish before the morning. A **distributed run** splits one run across several runners that you choose. To you it stays **one run**. Underneath, each runner works on its own slice of the data.

## How it works

1. You start a run and choose **several runners** instead of one. The first is the **master**. You also choose a **machine orchestrator**: a small piece of your own code that decides what each machine gets.
2. **Plan.** The master runner runs your machine orchestrator once, in plan mode. It returns one **portion** for each machine, as JSON.
3. **Fan out.** ETLFunnel creates one **machine** for each portion, pinned to its runner, and starts them all together.
4. **Work.** Every machine runs **every flow and pipeline** of the run, but with its own portion in hand. Your transformers, orchestrators and fixtures read the portion and read only their slice.
5. **End.** When the last machine ends, the run is over. ETLFunnel works out the run's status from the machines.

With R runners selected you get R machines, **the master included**: the master first makes the plan, then works like the others.

:::info What ETLFunnel does and does not do
ETLFunnel splits the run and keeps the books. It never reads, counts or moves your data to split it: only your code, running on the runners, can reach your databases. Counting, checking coverage, cleaning up and making a re-run safe are your design, written in the machine orchestrator, the per-flow [fixtures](./fixture) or your own jobs.
:::

### What is kept simple on purpose

- **Machines share nothing.** After the split nothing coordinates, retries or reassigns them. If a machine fails, the others carry on.
- **No retry of machines.** A failed run is run again as a new run. The engine's own in-process retry policy is unchanged.
- **No staged exchange, no joins, no shuffle.** This is splitting work, not a distributed query engine.
- **No preview or confirmation.** A split goes plan then execute with no prompt in between, so a scheduled run can go through unattended. Test a split by running it in staging first.

## Before you start

- **Runners.** You need as many [runners](./runner) as machines you want, each tagged for the stage the run is in, and each online. Every runner appears once in the list. A bigger machine gets a bigger portion through the orchestrator, which is told each runner's cores and memory; do not list it twice.
- **Runners must reach your databases.** Choosing a runner is your statement that it can reach the source and the destination. ETLFunnel does not check.
- **Keep `clearJobArtifacts: true`** in each runner's `config.yaml` (the default). A runner with it switched off never reports a job as finished.
- **A machine orchestrator**, as described next.

The [Runner page](./runner) shows what each runner reports about itself: its **Version**, **Cores** and **Memory**.

## Write a machine orchestrator

A machine orchestrator is an [orchestrator](./resource-orchestrator) of a third type. It sits **above** the flow and pipeline orchestrators and replaces nothing: it decides what each machine gets, and the existing orchestrators still decide how each machine uses its cores.

1. Open **Orchestrators** and create one. Choose the type **For Machines**.
2. Write the code. It has one function:

```go
func MachineOrchestrator(param *models.MachineOrchestratorProps) ([]models.MachineOrchestratorTune, error)
```

The input, `MachineOrchestratorProps`:

| Field | What it holds |
| --- | --- |
| `Machines` | How many machines there are. |
| `Runners` | The selected runners **in order**: `Name`, `Version`, `Cores`, `TotalMemory` and `Index`. |
| `Flows` | The flows of the run. Each has its `Name`, its `Pipelines` and live connections (`SourceDBConn`, `DestDBConn`, `AuxiliaryDBConnMap`) so you can query the source. |
| `RunID` | The run's id. |

The answer is one `MachineOrchestratorTune` per machine:

| Field | What it holds |
| --- | --- |
| `Machine` | The machine's index, `0` to `Machines-1`. Portion `k` goes to the k-th selected runner. |
| `Props` | The machine's portion: anything JSON-serialisable, such as an id range. It reaches your code. |
| `Notes` | Free text for people, shown in the plan log. Not stored by ETLFunnel. |

### Example: split an id range evenly

The editor gives you the `package` line; keep it and write the rest.

```go
import (
	"context"
	castpg "etlfunnel/execution/cast/postgres"
	"etlfunnel/execution/models"
	"fmt"
)

func MachineOrchestrator(param *models.MachineOrchestratorProps) ([]models.MachineOrchestratorTune, error) {
	if len(param.Flows) == 0 {
		return nil, fmt.Errorf("the run has no flows")
	}
	conn, err := castpg.CastAsPostgresConnection(param.Flows[0].SourceDBConn)
	if err != nil {
		return nil, err
	}
	var lo, hi int64
	if err := conn.Client.QueryRow(context.Background(),
		"SELECT min(id), max(id) FROM events").Scan(&lo, &hi); err != nil {
		return nil, err
	}
	n := int64(param.Machines)
	total := hi - lo + 1
	out := make([]models.MachineOrchestratorTune, 0, n)
	for k := int64(0); k < n; k++ {
		start, end := lo+total*k/n, lo+total*(k+1)/n
		out = append(out, models.MachineOrchestratorTune{
			Machine: int(k),
			Props:   map[string]any{"lo": start, "hi": end},
			Notes:   map[string]any{"rows": end - start, "runner": param.Runners[k].Name},
		})
	}
	return out, nil
}
```

### Rules for the answer

ETLFunnel checks the plan before it fans out. A plan that breaks a rule ends the run in error and the plan log says why.

- Machine indexes are unique and between `0` and `Machines-1`.
- There is at least one entry and no more than `Machines`.
- `Props` and `Notes` can be written as JSON.
- **Fewer entries than machines is allowed.** A machine with no entry gets no work.
- An error returned by your function, or a panic in it, ends the run in error. A panic is logged with its stack (error code `EF-E550`).

### Test and keep it in your history

A machine orchestrator is code like any other hook: it lives in a change set, is reviewed, travels in a [package](./packages) and is checked when the run is built. The editor does not compile it for you, so a mistake appears when the run is built: the run ends in error and its reason carries the first lines of the compiler output.

## Read the portion in your code

The portion is carried to everything that runs on a machine. The engine never reads it; it only hands it over.

- In a hook that receives `State`, call `State.GetMachinePartition()`. It returns `nil` in a normal run, so the same code works both ways. Otherwise it returns `Index`, `Count`, `RunID` and `Props`, the map your orchestrator returned for this machine.
- The flow orchestrator, pipeline orchestrator and [fixture](./fixture) props also carry the portion in a `Machine` field.

For example, in a Postgres source's query hook (the entity's `GenerateQuery`):

```go
func (d *IUseConnector) GenerateQuery(param *models.PostgresSourceQuery) (*models.PostgresSourceQueryOptions, error) {
	query := "SELECT id, payload FROM events ORDER BY id" // a normal run reads everything
	if mp := param.State.GetMachinePartition(); mp != nil {
		lo, _ := mp.Props["lo"].(float64) // numbers come back from JSON as float64
		hi, _ := mp.Props["hi"].(float64)
		query = fmt.Sprintf("SELECT id, payload FROM events WHERE id >= %d AND id < %d ORDER BY id", int64(lo), int64(hi))
	}
	return &models.PostgresSourceQueryOptions{Query: query}, nil
}
```

The platform does **no filtering**. If a flow never reads the portion, every machine reads everything. ETLFunnel cannot know whether a pipeline should read it, so it does not warn. You find a flow that ignores the portion when you test the split in staging.

## Start a distributed run

Open the run form as usual. Turn on **Split across several runners**, then:

1. Choose the runners **in order**. The first is the master.
2. Choose the **machine orchestrator**.
3. Fill in the rest and start.

This works in every tier:

| Where | Which machine orchestrators are offered | Which runners |
| --- | --- | --- |
| **Dev** | Any in dev | Dev runners, or your own personal runner |
| **Draft** | Any in dev, plus one that exists only in your open change set (picking it makes the run a draft run) | As dev |
| **Staging, Production** | Only those in the package the stage runs | Runners tagged for that stage |

A stage run takes its machine orchestrator from the package, so what you tested is what runs.

From a [preset](./presets): a preset can save the machine orchestrator but never the runners. Pick the runners when you start the run. Through the [API](./public-api) send `runnerIds` and, if the preset has none, `machineOrchestratorId`.

### Schedules

A [schedule](./schedules) can be split. A schedule is split or not split **for life**: you can change a split schedule's runners and machine orchestrator, but not turn the split on or off. The Scheduled list shows each schedule's split, and the switch is locked when you edit.

## Watch a distributed run

The run is one row in the run list. Its page has views you switch between:

- **Machines** (the default): one grid, one row per machine with its id, name, runner, status, start, time and its own abort. Search by machine or runner from the header.
- **Graph**: the flow's graph, read from the planning step's files.
- **Run details** (the info button in the header): the run's facts, the **Plan** step (its status, runner, times and log) and the run's events, written as sentences such as "2 machines ready to start together".

Open a machine to see its own **Metrics** and **Logs**; it is the ordinary run page for that machine, and its breadcrumb names the run.

While the master is planning, the page says **Planning the split**. A run that ends before any machine exists says **The run failed while planning** (or **was aborted while planning**), with the reason.

### Status

The run's status is worked out from its machines:

| Status | When |
| --- | --- |
| In progress | Planning, or at least one machine is still working. |
| Completed | Every machine completed. |
| **Completed with errors** (amber) | The machines ended but some did not complete. The reason says how many, for example "1 of 2 machines did not complete (0 errored, 1 aborted)". |
| Error | The plan failed: no plan, a plan that broke the rules, or a build error. |
| Aborted | The run was aborted. |

A run or machine whose runner stops reporting shows **Runner not reporting** after about a minute of silence. It is a hint only and never changes a status: a job can outlive a runner restart.

### Abort

- **Abort the run**: every machine is asked to stop. A run aborted while planning ends as aborted.
- **Abort one machine**: from its row in the Machines grid. The others carry on, and the run ends as **Completed with errors**.

There is no pause.

### Alerts

A [webhook](./integration-webhook) set on the run serves the plan and every machine. Alerts are kept per machine, with the usual backoff, so errors on three machines send three alerts. The alert names the run, and the machine, and its purpose reads "... (machine 2 of 3)". Picked and ended messages are sent once per run.

## Designing a split that is safe to re-run

These are yours to design. ETLFunnel adds no check or guardrail.

- **Converge and verify.** Make the destination end up right no matter how many times a slice is written: upserts, `ON CONFLICT DO NOTHING`, or a key that includes the machine.
- **Idempotent portions.** A re-run is a new run. Use `RunID` and the portion to make a re-run safe, for example by writing the portion to your own checkpoint table.
- **File names.** If machines write files, include the machine index in the name so they never collide.
- **Final steps.** Restoring destination settings, final commits and counting rows happen in your fixtures or your own jobs: there is no end-of-run step in the platform.
- **Balance.** Machines each get a slice of every pipeline by default. If the data is skewed, split by something that balances, such as row ranges, not key values.
- **Endless pipelines.** A run with a machine that never ends keeps running. Ending it is up to you.

## Limits

- One run has at most one machine orchestrator.
- Fewer entries than machines gives fewer working machines.
- The Machines grid shows every machine and refreshes every few seconds. It is comfortable for tens of machines; hundreds are not paged yet.
- A run total across machines is not shown. Each machine reports its own numbers.
- Tried so far with two to a handful of machines on real runners. Treat very large machine counts as untested.
