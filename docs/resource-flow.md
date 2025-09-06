# Flows

A **Flow** represents the logical unit of work in your ETL operations. Think of it as a dedicated workspace where all related data pipelines share the same source and destination database connections, similar to how a schema organizes tables in a PostgreSQL database.

![Flow Architecture](/img/page_resource/flow.png)

## Flow Structure

Each flow consists of:

- **1 Source Database** - The origin of your data
- **1 Destination Database** - Where processed data lands
- **Multiple Pipelines** - Individual data transformation workflows

## Pipeline Components

Within each flow, every pipeline contains:

| Component | Description | Quantity |
|-----------|-------------|----------|
| **Name** | Unique identifier for the pipeline | 1 |
| **Source Entity** | Origin data structure (e.g., `users` table) | 1 |
| **Destination Entity** | Target data structure (e.g., `user_index` in Elasticsearch) | 1 |
| **Transformers** | Data processing and transformation logic | Any number |
| **Checkpoint** | Progress tracking and recovery point | 1 |
| **Backlog** | Hook for failed records | 1 |
| **Auxiliary DBs** | Supporting databases for lookups or enrichment | Any number |

## Example Flow Definition

Here's a practical example of defining a flow for user data synchronization:

### Flow Setup
1. **Flow Name**: `User Sync Flow`
2. **Source Database**: 
   - Type: `PostgreSQL`
   - Connection: `prod_postgres`
3. **Destination Database**: 
   - Type: `Elasticsearch`
   - Connection: `search_cluster`

### Pipeline Configuration
**Pipeline Name**: `User Profile Sync`

| Setting | Value |
|---------|-------|
| Source Entity | `users` (table) |
| Destination Entity | `user_profiles_index` |
| Transformers | • Email Hash Transformer<br/>• PII Anonymizer<br/>• Profile Enricher |
| Checkpoint | `user_sync_checkpoint` |
| Backlog | `failed_user_records` |
| Auxiliary DBs | • `user_preferences` (lookup)<br/>• `redis_session_store` (cache) |

This flow efficiently manages user data synchronization from a PostgreSQL database to an Elasticsearch cluster, with built-in error handling and data transformation capabilities.