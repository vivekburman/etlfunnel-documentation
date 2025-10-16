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

```go
type OrchestratorEntityDef struct {
    Name string
    SourceDBConn IDatabaseEngine
    DestDBConn IDatabaseEngine
    AuxiliaryDBConnMap map[string]IDatabaseEngine
}

type OrchestratorProps struct {
    Entity []OrchestratorEntityDef
}

type OrchestratorTune struct {
    ParentEntityName string
    NewEntityName string
    ReplicaProps map[string]any
}
```

The idea is simple: each entity represents a pipeline unit, and the orchestrator decides how many replicas to create and what their tuning parameters should be.

### Flow-level orchestration — scale by CPU

```go
import (
    "etlfunnel/execution/models"
    "fmt"
    "runtime"
)

func GetFlowOrchestration(param *models.OrchestratorProps) ([]models.OrchestratorTune, error) {
    // Dynamically detect available CPU cores
    numThreads := runtime.NumCPU()
    
    var replicas []models.OrchestratorTune
    
    for _, entity := range param.Entity {
        for i := 0; i < numThreads; i++ {
            replica := models.OrchestratorTune{
                ParentEntityName: entity.Name,
                NewEntityName: fmt.Sprintf("%s_core_%d", entity.Name, i),
                ReplicaProps: map[string]any{
                    "replica_id": i,
                    "thread_id": i,
                    "total_replicas": numThreads,
                    "cpu_optimized": true,
                },
            }
            replicas = append(replicas, replica)
        }
    }
    
    return replicas, nil
}
```

This is a hardware-aware orchestration. Each pipeline replica maps to a CPU core, so your ETL workload scales automatically with the available cores on that node.

### Pipeline-level orchestration — scale by data volume

You can use your `SourceDBConn` (which implements `IDatabaseEngine`) to introspect data size and partition the workload accordingly.

```go
package client_orchestrator_pipeline

import (
    "etlfunnel/execution/models"
    "fmt"
)

func GetPipelineOrchestration(param *models.OrchestratorProps) ([]models.OrchestratorTune, error) {
    if param == nil {
        return nil, fmt.Errorf("orchestrator props cannot be nil")
    }
    
    var replicas []models.OrchestratorTune
    
    for _, entity := range param.Entity {
        // Example: fetch table stats using your IDatabaseEngine
        stats, err := entity.SourceDBConn.GetTableStats()
        if err != nil {
            return nil, fmt.Errorf("failed to fetch stats for %s: %v", entity.Name, err)
        }
        
        // Split pipelines based on total row count
        numReplicas := 1
        if stats.TotalRows > 10_000_000 {
            numReplicas = 4
        } else if stats.TotalRows > 1_000_000 {
            numReplicas = 2
        }
        
        for i := 0; i < numReplicas; i++ {
            replica := models.OrchestratorTune{
                ParentEntityName: entity.Name,
                NewEntityName: fmt.Sprintf("%s_partition_%d", entity.Name, i),
                ReplicaProps: map[string]any{
                    "replica_id": i,
                    "total_replicas": numReplicas,
                    "partition_hint": fmt.Sprintf("split_%d", i),
                    "data_driven": true,
                },
            }
            replicas = append(replicas, replica)
        }
    }
    
    return replicas, nil
}
```

Now orchestration adapts not just to the machine, but also to the data itself. A pipeline that needs to move 100M rows automatically gets partitioned into multiple smaller replicas, each handling a subset.

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