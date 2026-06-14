# Orchestrators

Dynamic Orchestration — tuning your ETL workload based on the machine and the data it's running on.

## Use Case

You've got 10 flows syncing data from Postgres to Elastic. They're running across multiple regions and machines:

| Region | Machine Type | Postgres Schemas | Data Volume (per schema) |
|--------|------------------|------------------|--------------------------|
| US | 32-core, 128GB RAM | 200+ | Medium |
| EU | 8-core, 32GB RAM | 50 | Small |
| APAC | 16-core, 64GB RAM | 100 | Very Large |

If you run the same orchestration plan everywhere, you'll waste compute in the US region and choke the EU one.

This is where orchestration hooks come in — to shape your execution plan dynamically before any flow even starts.

## The Concept: Orchestration Hooks

An Orchestration Hook is a pre-step that decides how many replicas of a flow or pipeline should exist and how they should be distributed based on:

- Available hardware (CPU, cores, memory)
- Data volume (number of rows, partitions, tables)
- Connection characteristics (source latency, throughput)

You can define hooks at two levels:

- **Flow Level** — to replicate entire flows
- **Pipeline Level** — to replicate pipelines inside a flow

## The Implementation

ETLFunnel's engine defines an orchestration contract:

Flow and pipeline orchestration use separate types. Each item exposes the database connections for the unit being replicated, and the tune structs tell the engine how to name and configure each replica.

```go
// Flow-level types
type FlowOrchestratorItemProps struct {
	Name               string
	SourceDBConn       IDatabaseEngine
	DestDBConn         IDatabaseEngine
	AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type FlowOrchestratorProps struct {
	Flows []FlowOrchestratorItemProps
}

type FlowOrchestratorTune struct {
	ParentName   string
	ReplicaName  string
	ReplicaProps map[string]any
}

// Pipeline-level types
type PipelineOrchestratorItemProps struct {
	Name               string
	EntityBaseName     string
	SourceDBConn       IDatabaseEngine
	DestDBConn         IDatabaseEngine
	AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type PipelineOrchestratorProps struct {
	Pipelines []PipelineOrchestratorItemProps
}

type PipelineOrchestratorTune struct {
	ParentName   string
	ReplicaName  string
	ReplicaProps map[string]any
}
```

The pipeline variant carries an extra `EntityBaseName` — the base entity anchor (e.g. `user_activity`) from which sharded replicas like `user_activity_1`, `user_activity_2` are derived.

### Flow-level orchestration — scale by CPU

```go
import (
    "etlfunnel/execution/models"
    "fmt"
    "runtime"
)

func GetFlowOrchestration(param *models.FlowOrchestratorProps) ([]models.FlowOrchestratorTune, error) {
    numThreads := runtime.NumCPU()

    var replicas []models.FlowOrchestratorTune

    for _, flow := range param.Flows {
        for i := 0; i < numThreads; i++ {
            replicas = append(replicas, models.FlowOrchestratorTune{
                ParentName:  flow.Name,
                ReplicaName: fmt.Sprintf("%s_core_%d", flow.Name, i),
                ReplicaProps: map[string]any{
                    "replica_id":     i,
                    "total_replicas": numThreads,
                    "cpu_optimized":  true,
                },
            })
        }
    }

    return replicas, nil
}
```

This is a hardware-aware orchestration. Each flow replica maps to a CPU core, so your ETL workload scales automatically with the available cores on that node.

### Pipeline-level orchestration — scale by shard

Pipeline orchestration uses `EntityBaseName` to derive replica entity names, making it natural for sharded or partitioned tables.

```go
import (
    "etlfunnel/execution/models"
    "fmt"
)

func GetPipelineOrchestration(param *models.PipelineOrchestratorProps) ([]models.PipelineOrchestratorTune, error) {
    var replicas []models.PipelineOrchestratorTune

    for _, pipeline := range param.Pipelines {
        numShards := 4 // determine dynamically based on data volume

        for i := 0; i < numShards; i++ {
            replicas = append(replicas, models.PipelineOrchestratorTune{
                ParentName:  pipeline.Name,
                ReplicaName: fmt.Sprintf("%s_%d", pipeline.EntityBaseName, i),
                ReplicaProps: map[string]any{
                    "replica_id":     i,
                    "total_replicas": numShards,
                    "shard_index":    i,
                },
            })
        }
    }

    return replicas, nil
}
```

Now orchestration adapts not just to the machine, but also to the data itself. A pipeline anchored to `user_activity` automatically fans out into `user_activity_0`, `user_activity_1`, etc., each handling a distinct shard.

## Combined: Flow + Pipeline Orchestration

In real-world setups, you can even chain both levels.

For example:

- Flow orchestration splits jobs by CPU capacity.
- Pipeline orchestration further divides heavy tables within each flow.

The result is a perfectly balanced plan — CPU-efficient, data-aware, and regionally optimized.

## Why It Matters

Dynamic orchestration gives you:

- Predictable performance across heterogeneous environments.
- Elastic scalability — every machine operates at full capacity.
- Data-aware load balancing — big datasets automatically spread across workers.
- Unified code — your flow definitions remain the same, only orchestration changes.

You've effectively made your ETL system self-tuning — a foundational step toward distributed dataflow intelligence.