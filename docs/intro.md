# What is ETLFunnel?

ETLFunnel is a **developer-first, on-premise ETL platform** that gives engineering teams full ownership of their data pipelines — the logic, the infrastructure, and the execution environment — without depending on managed cloud services or black-box SaaS tooling.

---

## The Problem It Solves

Modern data teams are stuck between two bad options.

**Managed ETL services** — cloud-hosted pipelines and drag-and-drop tools — are fast to start but quickly hit a ceiling. Custom business logic gets bolted on awkwardly. You can't control where your data goes during transit. Pricing scales with volume in ways that hurt. And when something breaks deep inside the platform, you're filing a support ticket instead of reading a stack trace.

**Rolling your own** means gluing together consumers, workers, retry queues, and monitoring — an enormous surface area to build and maintain before you've moved a single byte of business data.

ETLFunnel sits in between. It gives you a **structured runtime** for data pipelines — connection management, execution scheduling, parallelism, failure handling, progress tracking — while leaving every piece of business logic as code you own, version, and deploy.

---

## Who It's For

ETLFunnel is built for engineering teams that need to:

- **Migrate databases** — move data between systems during infrastructure changes, re-platforming, or consolidation
- **Sync operational data to analytics** — keep data warehouses, search indexes, or reporting databases current with production systems
- **Build real-time data products** — stream changes from source databases into downstream consumers as they happen
- **Replicate across environments** — keep staging, regional, or tenant-specific databases in sync with a primary

---

## On-Premise by Design

ETLFunnel installs on your own infrastructure. There is no cloud dependency, no data leaving your network, and no per-record pricing. This matters for teams with:

- **Data residency requirements** — regulated industries where data cannot transit third-party infrastructure
- **Air-gapped environments** — internal networks without public internet access
- **Cost predictability** — workloads where cloud ETL pricing would scale uncomfortably with volume
- **Security posture** — organizations that require full auditability of where data flows

---

## The Server / Runner Model

The core architectural decision in ETLFunnel is the separation of the **management layer** from the **execution layer**.

<img src="img/server_runner_architecture.svg" alt="Server Runner" height="300" />


**The Server** is the control center. It hosts the web interface where you define pipelines, configure connections, schedule builds, and view logs. You run one server per workspace.

**Runners** are lightweight agents that do the actual work. A runner registers with the server using an API key, receives assigned jobs, and executes them locally — the runner is the process that opens database connections and moves data. You can deploy runners anywhere: on a database host for low-latency access, inside a specific network zone for compliance, or on a dedicated compute machine for throughput-heavy workloads.

This separation gives you real operational flexibility:

- A runner in your EU region handles EU data, never leaving that network boundary
- A high-memory runner takes on large analytical workloads
- A dev runner runs safely against staging databases
- Multiple runners can be assigned to a single build for parallelism

The server coordinates. The runners execute. Your data never has to leave the environment you choose for it.

---

## What You Build, What ETLFunnel Provides

| You provide | ETLFunnel provides |
|-------------|-------------------|
| Transformation logic (Go functions) | Pipeline execution runtime |
| Source / destination query logic | Connection pooling and management |
| Checkpoint and recovery strategy | Automatic lifecycle orchestration |
| Failure handling logic | Parallel execution across runners |
| Business rules and filters | Build scheduling (run now / cron) |
| Shared utility libraries | Log aggregation and monitoring |
| | Retry and exponential backoff |
| | Web UI for pipeline management |

The division is intentional. ETLFunnel handles the hard operational problems — concurrency, retries, scheduling, lifecycle management — so your team focuses on logic specific to your data and your business.

---

## Next Steps

- **[Architecture Deep Dive](./architecture)** — understand how all components fit together under the hood
- **[Setup Guide](./setup-guide)** — install the server and deploy your first runner
- **[Connector Hub](./connector-hub)** — register your database connections
- **[Flows](./resource-flow)** — define your first pipeline topology