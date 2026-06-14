# Flows

A **Flow** represents the logical unit of work in your ETL operations. Think of it as a dedicated workspace where all related data pipelines share the same source and destination database connections, similar to how a schema organizes tables in a PostgreSQL database.

![Flow Architecture](/img/page_resource/flow.png)

## Flow Structure

Each flow consists of:

- **1 Primary Source** - The origin connector for your data
- **1 Destination** - The target connector where processed data lands
- **Multiple Pipelines** - Individual data transformation workflows
- **Orchestrator** - Controls pipeline scheduling and execution order
- **Setup Fixture** - Code that runs once before the flow starts
- **Teardown Fixture** - Code that runs once after the flow completes

## Pipeline Components

Within each flow, every pipeline contains:

| Component | Description | Quantity |
|-----------|-------------|----------|
| **Name** | Display name for the pipeline | 1 |
| **Base Name** | Anchor entity name this pipeline is built around. Acts as a placeholder so multiple sharded variants can be derived from it — e.g. a base name of `user_activity` allows the pipeline to target `user_activity_1`, `user_activity_2`, etc. | 1 |
| **Source Isolation Entity** | Connector entity defining the source data scope for this pipeline | 1 |
| **Destination Isolation Entity** | Connector entity defining the destination target for this pipeline | 1 |
| **Transformers** | Ordered list of data transformation hooks applied to each record | Any number |
| **Checkpoint** | Progress tracking hook — saves state so the pipeline can resume after interruption | 0 or 1 |
| **Backlog** | Hook invoked for records that fail processing, enabling retry or dead-letter handling | 0 or 1 |
| **Terminate** | Hook that decides whether to stop the pipeline early based on custom logic | 0 or 1 |
| **Destination Write Rule** | Hook that tunes bulk write behaviour — controls records per batch, check interval, and an optional custom check function to dynamically adjust throughput at runtime | 0 or 1 |
| **Auxiliary Hubs** | Additional connector hubs available inside the pipeline for lookups or enrichment | Any number |

