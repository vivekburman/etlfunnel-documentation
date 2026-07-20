# Connector Hub

The Connector Hub is the centralized management system for all database connections in your ETL pipeline. It serves as the foundation for both source and destination connections, supporting a wide range of database systems with flexible data processing strategies.

## Overview

The Connector Hub allows you to configure and manage connections to various database systems, enabling seamless data integration across your infrastructure. Each connector is designed to work efficiently with its respective database system while providing multiple data processing strategies to suit different use cases.

## Supported Database Systems

### Relational Databases
- MySQL
- MariaDB
- PostgreSQL
- Microsoft SQL Server
- Oracle Database

### Non-Relational Databases
- Redis
- MongoDB
- Elasticsearch
- Cassandra
- RabbitMQ
- Kafka

### API
- REST API

## Database Connectors

## Relational DB Connectors

### MySQL Connector

MySQL connector provides robust integration with MySQL databases, supporting multiple data capture methods for real-time and batch processing.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Host | Text | localhost | MySQL server hostname or IP address |
| Port | Number | 3306 | MySQL server port number |
| Username | Text | - | Database username for authentication |
| Password | Password | - | Database password for authentication |
| Database | Text | - | Target database name |
| Data Processing Strategy | Dropdown | By Query | Method for capturing data changes |
| Server ID | Number | 1 | Unique server identifier (required for Bin Logs) |

**Data Processing Strategies:**

- **By Query**: Standard SQL query-based data extraction
- **By Bin Logs**: Monitor MySQL binary logs for real-time change detection
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination database with query generation for data insertion

:::note
The Server ID parameter is only required when using the "By Bin Logs" strategy and must be unique across all MySQL replicas.
:::

### MariaDB Connector

MariaDB connector offers the same functionality as MySQL due to their compatibility, with optimizations for MariaDB-specific features.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Host | Text | localhost | MariaDB server hostname or IP address |
| Port | Number | 3306 | MariaDB server port number |
| Username | Text | - | Database username for authentication |
| Password | Password | - | Database password for authentication |
| Database | Text | - | Target database name |
| Data Processing Strategy | Dropdown | By Query | Method for capturing data changes |
| Server ID | Number | 1 | Unique server identifier (required for Bin Logs) |

- **By Query**: Standard SQL query-based data extraction
- **By Bin Logs**: Real-time monitoring of MariaDB binary logs
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination database with query generation for data insertion

### PostgreSQL Connector

PostgreSQL connector leverages advanced PostgreSQL features for efficient data processing and supports SSL connections for secure data transfer.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Host | Text | localhost | PostgreSQL server hostname or IP address |
| Port | Number | 5432 | PostgreSQL server port number |
| Username | Text | postgres | Database username for authentication |
| Password | Password | - | Database password for authentication |
| Database | Text | postgres | Target database name |
| SSL Mode | Dropdown | disable | SSL connection mode |
| Data Processing Strategy | Dropdown | By Query | Method for capturing data changes |
| Connect To Replica | Boolean | false | Connect to read replica (required for WAL) |

**SSL Mode Options:**
- **Disable**: No SSL encryption
- **Require**: SSL encryption required
- **Verify Full**: SSL with full certificate verification

**Data Processing Strategies:**
- **By Query**: Standard SQL query-based data extraction
- **By Notification Channel**: PostgreSQL LISTEN/NOTIFY mechanism
- **By WAL**: Write-Ahead Log monitoring for real-time changes
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination database with query generation for data insertion

:::tip
When using WAL (Write-Ahead Log) processing, ensure the "Connect To Replica" option is enabled for optimal performance and to avoid impacting the primary database.
:::

### Microsoft SQL Server Connector

SQL Server connector provides enterprise-grade integration with Microsoft SQL Server, supporting advanced change tracking features.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Host | Text | localhost | SQL Server hostname or IP address |
| Port | Number | 1433 | SQL Server port number |
| Username | Text | - | Database username for authentication |
| Password | Password | - | Database password for authentication |
| Database | Text | - | Target database name |
| Data Processing Strategy | Dropdown | By Query | Method for capturing data changes |

**Data Processing Strategies:**
- **By Query**: Standard SQL query-based data extraction
- **By Service Broker**: SQL Server Service Broker messaging
- **By Change Data Capture**: Built-in CDC functionality
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination database with query generation for data insertion

:::info
Change Data Capture (CDC) must be enabled at both database and table levels in SQL Server before using the CDC processing strategy.
:::

### Oracle Database Connector

Oracle connector supports enterprise Oracle databases with multiple change detection mechanisms for high-performance data processing.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Host | Text | localhost | Oracle server hostname or IP address |
| Port | Number | 1521 | Oracle listener port number |
| Username | Text | - | Database username for authentication |
| Password | Password | - | Database password for authentication |
| Database | Text | - | Oracle database service name or SID |
| Data Processing Strategy | Dropdown | By Query | Method for capturing data changes |

**Data Processing Strategies:**
- **By Query**: Standard SQL query-based data extraction
- **By Change Data Capture**: Oracle GoldenGate or Streams CDC
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination database with query generation for data insertion

## Non-Relational DB Connectors

### Redis Connector

Redis connector enables integration with Redis key-value stores, supporting various Redis data structures and real-time streaming capabilities.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Host | Text | localhost | Redis server hostname or IP address |
| Port | Number | 6379 | Redis server port number |
| Username | Text | - | Redis username (Redis 6.0+) |
| Password | Password | - | Redis password or AUTH token |
| Database Index | Number | 0 | Redis database index (0-15) |
| Data Processing Strategy | Dropdown | By Keys | Method for data retrieval |

**Data Processing Strategies:**
- **By Keys**: Fetch data for all specified keys and pattern matches.
- **By Streams**: Redis Streams for real-time data processing
- **By Keyspace**: Keyspace notifications for change detection
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination Redis instance with command generation for data storage

:::warning
Keyspace notifications must be enabled in Redis configuration (`notify-keyspace-events`) to use the "By Keyspace" strategy.
:::

### MongoDB Connector

MongoDB connector provides comprehensive integration with MongoDB databases, supporting both standalone and Atlas cloud deployments.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Host | Text | localhost | MongoDB server hostname or IP address |
| Port | Number | 27017 | MongoDB server port number |
| Username | Text | - | MongoDB username for authentication |
| Password | Password | - | MongoDB password for authentication |
| Is Atlas | Boolean | false | Enable for MongoDB Atlas connections |
| Database | Text | - | Target database name |
| Collection | Text | - | Target collection name |
| Data Processing Strategy | Dropdown | By Query | Method for data retrieval |

**Data Processing Strategies:**
- **By Query**: Execute MongoDB query to fetch data for matching documents
- **By Streams**: Change Streams for real-time monitoring
- **By Oplog Trailing**: Operation log tailing for change detection
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination MongoDB with operation generation for document insertion

:::tip
Change Streams require a replica set or sharded cluster configuration. For standalone MongoDB instances, use "By Oplog Trailing" or "By Query" strategies.
:::

### Elasticsearch Connector

Elasticsearch connector enables integration with Elasticsearch clusters for full-text search and analytics workloads.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| URL | Text | - | Elasticsearch cluster URL |
| Username | Text | - | Username for authentication |
| Password | Password | - | Password for authentication |
| Cloud ID | Text | - | Elastic Cloud deployment ID |
| API Key | Text | - | API key for authentication |
| Insecure Skip | Boolean | false | Skip TLS certificate verification |

**Data Processing Strategies:**
- **By Query**: DSL query-based document retrieval
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination with index operation generation for document insertion

### Cassandra Connector

Cassandra connector provides integration with Apache Cassandra clusters for high-throughput, distributed data workloads.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Hosts | List | - | Cassandra node hostnames or IP addresses |
| Port | Number | 9042 | Cassandra native transport port |
| Keyspace | Text | - | Target keyspace name |
| Username | Text | - | Cassandra username for authentication |
| Password | Password | - | Cassandra password for authentication |
| Consistency | Dropdown | quorum | Read/write consistency level |
| Data Center | Text | - | Data center name for DC-aware routing |
| TLS Enabled | Boolean | false | Enable TLS encryption |
| TLS Skip Verify | Boolean | false | Skip TLS certificate verification |

**Data Processing Strategies:**
- **By Query**: CQL query-based row retrieval
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination with CQL generation for row insertion

### RabbitMQ Connector

RabbitMQ connector provides integration with RabbitMQ message brokers for event-driven and streaming data pipelines.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Host | Text | localhost | RabbitMQ server hostname or IP address |
| Port | Number | 5672 | RabbitMQ AMQP port number |
| Username | Text | - | RabbitMQ username for authentication |
| Password | Password | - | RabbitMQ password for authentication |
| VHost | Text | / | Virtual host name |
| Use TLS | Boolean | false | Enable TLS encryption |

**Data Processing Strategies:**
- **By Consume**: Consume messages from a queue in real time
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination with message publishing for data delivery

### Kafka Connector

Kafka connector enables integration with Apache Kafka clusters for high-throughput, fault-tolerant streaming data pipelines.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Brokers | List | - | Kafka broker addresses |
| Client ID | Text | - | Kafka client identifier |
| SASL Mechanism | Dropdown | - | SASL auth: PLAIN, SCRAM-SHA-256, SCRAM-SHA-512 |
| SASL Username | Text | - | SASL username |
| SASL Password | Password | - | SASL password |
| TLS Enabled | Boolean | false | Enable TLS encryption |
| TLS Skip Verify | Boolean | false | Skip TLS certificate verification |
| Kafka Version | Text | - | Broker version (e.g. 3.6.0); leave empty for auto-negotiate |

**Data Processing Strategies:**
- **By Consume**: Consume messages from a topic in real time
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination with message production for data delivery

## API Connectors

### REST API Connector

REST API connector enables integration with any HTTP/HTTPS API endpoint, supporting multiple authentication schemes.

**Configuration Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Base URL | Text | - | Root URL of the API |
| Auth Type | Dropdown | none | Authentication method: none, bearer, basic, api_key, oauth2, custom |
| Token | Text | - | Bearer token (for bearer auth) |
| API Key | Text | - | API key value |
| API Key Header | Text | - | Header name for the API key |
| Client ID | Text | - | OAuth2 client ID |
| Client Secret | Text | - | OAuth2 client secret |
| Token URL | Text | - | OAuth2 token endpoint |
| Scopes | List | - | OAuth2 scopes |
| Username | Text | - | Username (for basic auth) |
| Password | Password | - | Password (for basic auth) |
| TLS Skip Verify | Boolean | false | Skip TLS certificate verification |

**Custom Auth Parameters** (when Auth Type is `custom`):

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Token URL | Text | - | Endpoint the connector calls to obtain a token (required) |
| Method | Dropdown | POST | HTTP method used for the token request; empty resolves to `POST` |
| Headers | Map | - | Extra headers sent with the token request, e.g. `Content-Type: application/json` |
| Body | Text | - | Raw request body for the token request |
| Token Path | Text | - | JSONPath into the token response body, e.g. `$.data.accessToken` (required) |
| Expiry Path | Text | - | Optional JSONPath to a seconds-until-expiry field in the token response |
| Token Prefix | Text | Bearer | Prefix applied ahead of the token when set on the outgoing `Authorization` header; empty resolves to `Bearer` |

**Data Processing Strategies:**
- **By Request**: Execute HTTP requests and stream response data
- **By Custom Function**: User-implemented data extraction method returning `<-chan map[string]interface{}`
- **By Write Operation**: Use as destination with HTTP request generation for data delivery

## Connection Management

### Creating a New Connection

1. Navigate to the Connector Hub in your ETL platform
2. Select "Create New"
3. Choose your database type from the supported connectors
4. Fill in the required configuration parameters
5. Select the appropriate data processing strategy
6. Test the connection to validate configuration
7. Save the connector configuration

### Testing Connections

Before saving any connector configuration, use the built-in connection test feature to verify:
- Network connectivity to the database server
- Authentication credentials validity
- Database/collection accessibility
- Required permissions for the selected processing strategy
