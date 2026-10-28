# What is ETLFunnel?

ETLFunnel is a **developer-first, self-hosted data pipeline platform**. You write the logic of a pipeline as Go code, in a browser editor with completion and type checking. ETLFunnel supplies everything around it: connections, scheduling, parallelism, failure handling, progress tracking, and a review-and-release path that gets a change to production safely.

It installs on your own infrastructure. Your data never passes through anyone else's servers, and there is no per-record pricing.

---

## The problem it solves

Data teams usually choose between two things.

**Managed ETL services** are quick to start and then hit a ceiling. Custom business logic is bolted on awkwardly, you have no say over where data travels in transit, pricing grows with volume, and when something breaks deep inside the platform you file a support ticket instead of reading a stack trace.

**Rolling your own** means gluing together consumers, workers, retry queues and monitoring. It is a large surface to build and maintain before a single byte of business data has moved.

ETLFunnel sits between them. It gives you a **structured runtime** and leaves every piece of business logic as code you own, review and version.

## What a pipeline is made of

A pipeline reads records from a **source**, passes them through your **transformers**, and writes them to a **destination**. You write the code for each of those steps as small functions. Around that path sit optional hooks that you also write: what to do after a successful write (**checkpoint**), when a write fails (**backlog**), how large each batch should be (**destination rule**), when to stop (**termination rule**), and how many parallel copies to run (**orchestrator**).

Pipelines that share a source and a destination live together in a **flow**. Flows that share the same kinds of source and destination can be grouped into a **collection** and run as one.

[Architecture](./architecture) explains the model in full.

## Who it is for

Teams that need to:

- **Migrate databases** during re-platforming or consolidation.
- **Sync operational data to analytics**: warehouses, search indexes, reporting databases.
- **Build real-time data products** by streaming changes from source databases as they happen.
- **Replicate across environments**: staging, regional or per-tenant copies of a primary.

There are 23 connectors: relational databases (MySQL, MariaDB, PostgreSQL, SQL Server, Oracle), non-relational stores and queues (Redis, MongoDB, Elasticsearch, Cassandra, Kafka, RabbitMQ), REST APIs, files (CSV, JSON, Excel, Parquet, Avro, fixed width), warehouses (Snowflake, Redshift, BigQuery) and object storage (S3, Google Cloud Storage).

## Self-hosted by design

There is no cloud dependency. That matters when you have data residency requirements, air-gapped networks, workloads where per-record pricing would hurt, or a security posture that needs to know exactly where data flows. ETLFunnel is licensed under the Elastic License 2.0: free to self-host, modify and use commercially, but not to resell as a hosted service.

## The server and the runners

The central architectural decision is to separate the **management layer** from the **execution layer**.

<img src="img/server_runner_architecture.svg" alt="Server Runner" height="300" />

**The server** is the control centre. It hosts the web interface where you build pipelines, manage connections, review changes, schedule runs and read logs.

**Runners** are lightweight agents that do the work. A runner registers with the server using an API key, receives the jobs assigned to it, **compiles each job on its own host** and runs it. The runner is the process that opens database connections and moves data. You put runners where they need to be: next to a database for low latency, inside a network zone for compliance, or on a large machine for heavy workloads.

The server coordinates and the runners execute. Each runner is tagged for one purpose (your own dev work, dev, staging or production), so a job only runs on a machine meant for it. See [Runner](./runner).

## How a change reaches production

ETLFunnel treats a pipeline change like a code change. You edit a **draft**, a teammate **reviews** it, and approval merges it into **dev**. When you are ready to ship, someone cuts a **package**, a frozen snapshot of the workspace, and promotes it through **Staging** and **Production**. At each stage the team runs it and the stage's owner signs it off. Production runs only what has been signed off, against production's own databases.

Everything lives in a **workspace**, one project with its own people, hubs, flows and packages. See [How a Change Reaches Production](./delivery-overview).

## Where to go next

1. **[Set up](./setup-guide)** the server and your first runner.
2. **[Build your first pipeline](./quickstart)** end to end in about fifteen minutes.
3. **[Architecture](./architecture)** for the model behind it.
4. **[Connector Hub](./connector-hub)** to register your databases.
5. **[How a Change Reaches Production](./delivery-overview)** when you are ready to ship.
