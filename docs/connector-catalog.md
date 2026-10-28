# Connector Catalog

ETLFunnel has 23 connectors. Each one is a source, a destination, or both, and each exposes its own interface that you implement in a [connector entity](./connector-entity). This page is the map: what each connector can read, how, and where its reference page is.

## How a connector reads

Every source connector offers one or more **capture methods**. You implement the matching function in the entity and leave the others returning an error, as in the [quickstart](./quickstart).

| Capture method | What it means |
|---|---|
| **Query** (or scan, keys, prefix scan) | You return a query or a description of what to read. ETLFunnel runs it and streams the rows. Most pipelines start here. |
| **Change capture** | Continuous, from the system's own change feed: a replication log, change tables, a stream or a notification channel. A change-capture read does not end by itself; end it with a [termination rule](./termination-rule-hook), a cancel, or the end of input. |
| **Record fetching** | You write the whole read yourself and return a channel of records, with the live connection in your hands. Every connector offers it as the way out when nothing else fits. |

Every destination is a function that turns a batch of records into the writes for that system, plus an optional options function. Several destinations have no write-wide options to set.

## Relational databases

| Connector | Source methods | Reference |
|---|---|---|
| MySQL | `GenerateQuery`, `GenerateBinLog`, `FetchRecords` | [MySQL](./sql-mysql) |
| MariaDB | `GenerateQuery`, `GenerateBinLog`, `FetchRecords` | [MariaDB](./sql-maria) |
| PostgreSQL | `GenerateQuery`, `GenerateNotification` (LISTEN/NOTIFY), `GenerateWAL` (logical replication), `FetchRecords` | [PostgreSQL](./sql-postgres) |
| SQL Server | `GenerateQuery`, `GenerateCDC`, `GenerateServiceBroker`, `FetchRecords` | [SQL Server](./sql-microsoft) |
| Oracle | `GenerateQuery`, `GenerateCDC` (LogMiner), `FetchRecords` | [Oracle](./sql-oracle) |

## Non-relational stores and queues

| Connector | Source methods | Reference |
|---|---|---|
| Redis | `GenerateKeys`, `GenerateKeyspace`, `GenerateStreams`, `FetchRecords` | [Redis](./nosql-redis) |
| MongoDB | `GenerateQuery`, `GenerateStream` (change streams), `GenerateOplogTrailing`, `FetchRecords` | [MongoDB](./nosql-mongo) |
| Elasticsearch | `GenerateQuery`, `FetchRecords` | [Elasticsearch](./nosql-elasticsearch) |
| Cassandra | `GenerateCQLQuery`, `FetchRecords` | [Cassandra](./nosql-cassandra) |
| Kafka | `GenerateSubscription`, `GenerateAssignment`, `FetchRecords` | [Kafka](./nosql-kafka) |
| RabbitMQ | `GenerateQueue`, `GenerateExchange`, `FetchRecords` | [RabbitMQ](./nosql-rabbitmq) |

## APIs

| Connector | Source methods | Reference |
|---|---|---|
| REST API | `GeneratePaginateRequest`, `GenerateCursorRequest`, `GenerateWebhookRequest`, `FetchRecords` | [REST API](./restapi) |

## Files

Files are read with a scan: you describe which files and how to read them, and ETLFunnel streams the rows. Files are named relative to the connection's directory, and ETLFunnel does not confine the result to that directory, so mount only what you are willing to expose.

| Connector | Source methods | Reference |
|---|---|---|
| CSV | `GenerateScan`, `FetchRecords` | [CSV](./file-csv) |
| JSON | `GenerateScan`, `FetchRecords` | [JSON](./file-json) |
| Excel | `GenerateScan`, `FetchRecords` | [Excel](./file-excel) |
| Parquet | `GenerateScan`, `FetchRecords` | [Parquet](./file-parquet) |
| Avro | `GenerateScan`, `FetchRecords` | [Avro](./file-avro) |
| Fixed width | `GenerateScan`, `FetchRecords` | [Fixed width](./file-fixedwidth) |

## Data warehouses

| Connector | Source methods | Destination extras | Reference |
|---|---|---|---|
| Snowflake | `GenerateQuery`, `GenerateStream`, `FetchRecords` | | [Snowflake](./dw-snowflake) |
| Amazon Redshift | `GenerateQuery`, `FetchRecords` | | [Redshift](./dw-redshift) |
| Google BigQuery | `GenerateQuery`, `GenerateStorageRead`, `FetchRecords` | `GenerateLoadOpts` | [BigQuery](./dw-bigquery) |

## Object storage

| Connector | Source methods | Reference |
|---|---|---|
| Amazon S3 | `GeneratePrefixScan`, `FetchRecords` | [S3](./s3) |
| Google Cloud Storage | `GeneratePrefixScan`, `FetchRecords` | [GCS](./gcs) |

## Connections, hubs and tiers

A connector never holds a connection. A **hub** does, and a hub has a tier (Shared, Staging or Production) that decides which stage may use it. The same connector code runs against different hubs in different stages. See [Connector Hub](./connector-hub) and [Stages](./stages).
