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

## Database Connectors

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
