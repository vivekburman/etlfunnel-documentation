# Architecture Deep Dive

ETLFunnel is built around a clean separation between two planes of execution: the **Data Plane** and the **Control Plane**. Understanding this split is the mental model that makes everything else in these docs click.

## The Two Planes

Most ETL tools give you a single flat model — configure a source, configure a destination, define some transforms, run it. ETLFunnel divides that into two distinct layers that operate at different levels of the pipeline lifecycle.

<img src="/img/pipeline_architecture.svg" alt="Pipeline" height="300" />
---

## The Data Plane

The Data Plane is everything that runs **per record**, on every piece of data that moves through the pipeline. These are your hot-path hooks — they execute repeatedly, potentially millions of times, for the lifetime of a pipeline run.

### What lives here

**Connector Entities (Source & Destination)**  
These define *how* data is read from a source and written to a destination. A source connector entity streams records into the pipeline one at a time (or in batches via channels). A destination connector entity generates the write operation for each incoming record. They sit at both ends of the data path.

**Transformer**  
Receives a `map[string]any` record, applies your business logic — field remapping, enrichment, validation, filtering — and returns the mutated record. Transformers chain sequentially; the output of one becomes the input of the next. Returning `nil` skips the record entirely.

**Checkpoint**  
Fires automatically every time the pipeline successfully commits data to the destination, whether in bulk or individually. Used to track progress, maintain audit logs, and enable restart-from-position on failure. It is triggered *after* a successful write.

**Backlog**  
The mirror of Checkpoint — fires when a write *fails*. Receives the failed records so you can store them for retry, alert on them, or route them elsewhere. Ensures no data silently disappears on destination errors.

**Termination Rule**  
For streaming or event-driven pipelines that don't have a natural end, Termination Rules define the exit conditions: max records processed, idle timeout, max wall-clock time, or custom logic. Evaluated at a configured interval while the pipeline is running.

### The record lifecycle

A single record passes through the data plane like this:

```
Source Connector Entity
        │
        ▼
  Transformer #1
        │
        ▼
  Transformer #2 ... (N transformers)
        │
        ▼
Destination Connector Entity ──► success ──► Checkpoint
                             └──► failure ──► Backlog
```

Every hook in this chain is code you write. The engine wires them together and calls them in order.

---

## The Control Plane

The Control Plane is everything that shapes **how the pipeline runs**, operating above or before the data path. Control plane components don't process individual records — they determine the structure, scale, and shared utilities of the execution environment.

### What lives here

**Orchestrator**  
Runs as a pre-step, before any data flows. Given a set of pipeline entities, it decides how many replicas should exist and what parameters each replica gets. This is where you implement hardware-aware scaling (split by CPU cores) or data-aware partitioning (split a 100M-row table into 4 parallel workers). The data plane runs *inside* each replica the orchestrator produces.

**User Libraries**  
Shared Go code — constants, validators, API clients, helper functions — that lives in a centralized workspace and is importable by any hook across any pipeline. Not per-record logic itself, but the utilities that per-record logic depends on.

**Flow & Collection Topology**  
Flows define the wiring: one source database, one destination database, and the pipelines that connect them. Collections group multiple flows that share the same source and destination *types*, so you can manage them as a unit. These are structural definitions, not executable hooks.

**Connector Hub**  
The central registry of database connections — credentials, hosts, ports, SSL config, processing strategy. Every connector entity and every pipeline references connections from the Hub. It's infrastructure configuration, not runtime logic.

### Why the separation matters

Consider a pipeline syncing a 50-million-row Postgres table to Elasticsearch, running on a 16-core machine.

Without a control plane concept, you'd hard-code parallelism into the pipeline itself — messy, non-portable, and wrong.

With ETLFunnel's model:

1. The **Orchestrator** (control plane) inspects the table row count and CPU count at startup, then produces 8 pipeline replicas, each responsible for a partition.
2. Each replica runs its own **data plane** — its own connector entities, transformers, checkpoints, and backlog hooks — independently and in parallel.
3. The **data plane hooks** stay simple and stateless, written as if they handle a single record. The orchestrator handles the scale.

The result is a clean boundary: control plane code thinks about *topology and scale*, data plane code thinks about *one record at a time*.

---

## The Three-Tier Resource Model

Underneath both planes, ETLFunnel organizes your data infrastructure into three tiers:

| Tier | Resource | Represents |
|------|----------|------------|
| Database Layer | Collection | A group of flows sharing the same source/dest DB types |
| Schema Layer | Flow | A source DB + destination DB + N pipelines |
| Entity Layer | Pipeline | One source entity + one dest entity + transformers + hooks |

A **Pipeline** is the atomic unit — it has exactly one source connector entity, one destination connector entity, any number of transformers, and optionally a checkpoint, backlog, and termination rule. Everything in the data plane belongs to a pipeline.

A **Flow** groups pipelines that share the same database connections. Think of it like a schema — all the pipelines inside one flow read from the same source database and write to the same destination database.

A **Collection** groups flows that share the same *types* of source and destination. If you're syncing 20 PostgreSQL schemas to Elasticsearch, each schema gets its own flow, and all 20 flows belong to one collection. You can start, stop, and monitor them as a unit.

---

## Putting It Together: A Complete Example

Imagine you're building a real-time sync from a PostgreSQL production database to Elasticsearch for search.

**Topology (control plane)**
- One **Collection**: `ecommerce_sync`
- Three **Flows**: `users_flow`, `orders_flow`, `products_flow`
- Each flow has one **Pipeline** per table

**Scale (control plane)**
- An **Orchestrator** on each flow inspects row counts at startup and produces 1–4 replicas per pipeline depending on table size

**Data movement (data plane, per pipeline)**
- **Source Connector Entity**: generates a `SELECT` query or WAL slot to stream rows from Postgres
- **Transformer**: normalizes field names, hashes PII, enriches with lookup data from a Redis auxiliary DB
- **Destination Connector Entity**: generates the Elasticsearch index operation for each document
- **Checkpoint**: writes the last processed `updated_at` timestamp to a tracking table so restarts resume mid-stream
- **Backlog**: on write failure, inserts the failed document into a `failed_records` MySQL table for retry
- **Termination Rule**: not used here — batch pipeline, exits naturally when the query is exhausted

**Shared code (control plane)**
- **User Libraries**: `PIIHasher`, `ElasticDocBuilder`, and `PhoneFormatter` utilities shared across all three flows

This is ETLFunnel's full model. Every feature in these docs maps to one of these layers.