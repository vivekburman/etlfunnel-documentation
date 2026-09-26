# ETLFunnel vs Streamhouse: Findings

*As of 2026-09-16*

## What Streamhouse is

Streamhouse is an open, vendor-neutral architecture *category*, not a product — defined by an industry group (the Streamhouse Working Group: Aiven, Confluent, Redpanda, StreamNative, Ververica) to describe systems that keep an organization's current business state continuously available to production apps, analytics, and AI agents.

The definition names five stages — **capture → transport → transform → govern → serve** — with concrete example technologies per stage: change data capture, event streams, stream processing, open table formats, catalogs, and low-latency serving.

This doc checks ETLFunnel against each stage, using both the public docs site (`etlfunnel-documentation`) and direct inspection of the engine source (`etlfunnel-execution`, plus one real client implementation in `etlfunnel-runner`).

## Pillar-by-pillar: what ETLFunnel covers

| Pillar | Verdict | Evidence |
| --- | --- | --- |
| Capture | Strong | Native change-data-capture per engine — MySQL/MariaDB bin logs, Postgres WAL/LISTEN-NOTIFY, SQL Server CDC/Service Broker, Oracle GoldenGate/Streams, Mongo change streams/oplog, Redis streams/keyspace notifications — across 5 relational + 6 non-relational engines |
| Transport | Partial | Can produce into Kafka/RabbitMQ as a destination; doesn't host the event-streaming backbone itself |
| Transform | Partial, by design | Per-record hooks (map/filter/enrich/route) cover most needs; stateful/windowed correlation is possible but hand-built, not framework-managed (see AuxiliaryHub section) |
| Govern | Gap | No catalog, no open-table-format (Iceberg/Delta/Hudi) support anywhere in the execution repo — confirmed by direct grep. S3/GCS connectors write raw blobs, not managed tables |
| Serve | Strong (corrected) | Native destinations into Snowflake, BigQuery, and Redshift, not just Elasticsearch/Redis — real analytical warehouses, not only search/cache |

## Connector inventory correction

The public docs site (`etlfunnel-documentation`) lists 18 native connector types: 5 relational DBs, 6 non-relational DBs, REST API, and 6 file formats. Direct inspection of `etlfunnel-execution`'s `connector/datawarehouse/` and `core/{source,destination}/` found 5 more, undocumented on the public site:

- BigQuery — `connector/datawarehouse/bigquery/bigquery.go`
- Snowflake — `connector/datawarehouse/snowflake/snowflakesql.go`
- Redshift — `connector/datawarehouse/redshift/redshiftsql.go`
- S3 — `connector/datawarehouse/s3/s3.go`
- GCS — `connector/datawarehouse/gcs/gcs.go`

All five are real, SDK-backed implementations (AWS SDK v2, `cloud.google.com/go/bigquery`, `cloud.google.com/go/storage`, `gosnowflake`, `lib/pq`), wired as both source and destination connector entities — confirmed, not stubs. Actual native connector count: **23**, not 18.

One caveat: S3 and GCS write plain keyed objects (`core/destination/s3/implementation.go`) — blob storage, not a managed or versioned table format. They're a storage target, same tier as the file connectors, just cloud-hosted.

## The AuxiliaryHub + cast escape hatch

A pipeline isn't limited to one source and one destination connection. `models.PipelineDBConnectors` (`models/pipeline_model.go`) carries:

```go
type PipelineDBConnectors struct {
    Source       IDatabaseEngine
    Destination  IDatabaseEngine
    AuxiliaryHub map[string]IDatabaseEngine // arbitrary, named, N of them
    ...
}
```

Every connector type has a matching `cast/<type>` package that turns one of these into its real, typed driver handle — `cast/kafka/kafka.go`'s `CastAsKafkaConnection` returns an actual `sarama.Client`; `cast/postgres` returns a real `*pgx.Conn`; `cast/mongodb` a real Mongo client. So a transformer or custom-function hook processing a pipeline's primary source can reach into an auxiliary connection of a *different* type and query or consume it directly.

This isn't theoretical — there's a real production example. `etlfunnel-runner`'s `client/userlibraries/userlibrary_2.go` has `DedupCheck`: for every incoming record, it looks up a shared `dedup_registry` table in AuxDB keyed by `msisdn`, and flags a conflict if a different source already claimed that key — a live, per-record read-then-write against shared state that correlates records arriving from different sources over time.

**Implication for a cross-system windowed join** (e.g. MySQL orders × Kafka clickstream × MongoDB events): buildable today. Primary source = MySQL orders (CDC); `AuxiliaryHub = {"clicks": <kafka conn>, "events": <mongo conn>}`. A transformer casts the Mongo aux connection and queries it the way `DedupCheck` queries Postgres; the Kafka side is consumed via the cast `sarama.Client`, most naturally buffered into an AuxDB table the transformer then looks up against.

## Remaining real gaps

Confirmed by reading the code, not just by absence from the docs:

1. **No catalog / open-table-format governance.** No Iceberg, Delta, Hudi, or catalog code anywhere in `etlfunnel-execution` (direct grep for `iceberg|delta|hudi|catalog|schema registry` returned no real hits). Nothing tracks schema versions, snapshots, or gives two different query engines a guaranteed-consistent view of the same S3/GCS files.
2. **No built-in watermark / window-eviction semantics.** `AuxiliaryHub` + `cast` gets you a live connection, but "how long to wait for a late-arriving match" is a `WHERE event_time > NOW() - INTERVAL …` you write and a cleanup job you schedule yourself — not a framework concept.
3. **No atomic checkpoint spanning multiple stream positions plus buffered join state.** `core/pipelinerunner/pipelinerunner.go` checkpoints only the pipeline's *primary* source position. Anything buffered from an auxiliary connection (e.g. clicks landed via the aux Kafka consumer) has to be made restart-safe by hand — idempotent upserts, the same deliberate care `DedupCheck`'s `ON CONFLICT DO NOTHING` shows, not a guarantee the runtime gives you.

None of these block the orders/clicks/events example above from being built — they just mean correctness on restart and late-data handling are the implementer's responsibility, not the framework's, the way they would be with Flink's distributed checkpoint barriers.

## Recommendations

- **Update `etlfunnel-documentation`'s Connector Hub page** to list BigQuery, Snowflake, Redshift, S3, and GCS alongside the existing 18 — they're real and shipped, just missing from the public docs.
- **Document the `AuxiliaryHub` + `cast` pattern explicitly** as the supported path for cross-system correlation, with `DedupCheck` as a worked example — right now it's discoverable only by reading the execution source.

### Open questions

- Is a catalog / open-table-format layer (Iceberg + a REST catalog) in scope for ETLFunnel, or intentionally left to a downstream tool?
- Should the AuxDB-based correlation pattern (window/state as a table you manage yourself) get a first-class helper library, given it's already load-bearing in at least one real client implementation?
