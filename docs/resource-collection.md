# Collections

A **Collection** operates at the database layer and represents a grouping of homogeneous **Flows** that share the same source and destination database types. Collections enable you to manage ETL operations across multiple logical layers (Flows) of a database simultaneously.

## Collection Architecture
<img src="/img/page_resource/collection.png" alt="Collection" height="300" /><br/><br/><br/>

```
PostgreSQL Database
├── Schema 1 ────► Flow A ────┐
├── Schema 2 ────► Flow B ────┤
├── Schema 3 ────► Flow C ────┼────► Elasticsearch Database
├── Schema 4 ────► Flow D ────┤
└── Schema N ────► Flow N ────┘
```

In this structure:
- Each **schema** represents a logical data domain
- Each **Flow** handles the ETL for its respective schema
- All flows in the collection share the same **source database type** (PostgreSQL)
- All flows target the same **destination database type** (Elasticsearch)

## Key Benefits

### Database-Level Operations
Collections allow you to:
- **Bulk Management** - Start, stop, or monitor all flows simultaneously
- **Consistent Configuration** - Apply uniform settings across related flows
- **Coordinated Deployment** - Deploy ETL changes across all schemas at once
- **Centralized Monitoring** - View health and performance metrics for the entire database

### Operational Efficiency
- **Reduced Complexity** - Manage multiple flows as a single unit
- **Simplified Scheduling** - Coordinate timing across related ETL processes

## Use Cases

Collections are particularly useful when you need to:

1. **Migrate Entire Databases** - Move all schemas from one system to another
2. **Multi-Tenant Applications** - Each tenant's data lives in a separate schema but follows the same ETL pattern
3. **Microservices Architecture** - Each service has its own schema but shares common destination requirements
4. **Data Lake Ingestion** - Systematically process all business domains into a unified analytics platform

## Example Collection

**E-commerce Data Collection**
- **Source**: PostgreSQL Production Database
- **Destination**: Elasticsearch Analytics Cluster
- **Flows**:
  - `users_flow` (user_schema → user_analytics_index)
  - `orders_flow` (orders_schema → order_analytics_index)
  - `products_flow` (catalog_schema → product_search_index)
  - `reviews_flow` (reviews_schema → review_analytics_index)

This collection ensures all e-commerce data flows maintain consistent processing rules and can be managed as a cohesive unit for analytics and search functionality.