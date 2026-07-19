# Connector Entity

A **Connector Entity** is a logical unit within a connector that represents a specific data source or destination endpoint. It serves as the bridge between your data pipeline and the actual data storage systems, providing a structured way to interact with databases.

## Understanding Connectors

Before diving into Connector Entities, it's important to understand the broader connector ecosystem. There are two main types of connectors:

### 1. Relational Database Connectors
- MySQL
- MariaDB
- PostgreSQL
- Microsoft SQL Server
- Oracle Database

### 2. Non-Relational Database Connectors
- Redis
- MongoDB
- Elasticsearch
- Cassandra
- RabbitMQ
- Kafka

### 3. API Connectors
- REST API

Each connector can function as either:
- **Source**: Extracts data from the system
- **Destination**: Writes data to the system

## How Connector Entities Work

Each Connector Entity exposes a code interface where multiple functions are present. Users must implement specific functions that align with the Connector Hub's **Data Processing Strategy** options.

#### Implementation

```go
package client_connector_57_iso_entity_124

import (
    "fmt"
    "etlfunnel/execution/core/coreinterface"
    "etlfunnel/execution/models"
)

type IUseConnector struct {
}

// Ensure the struct implements the required interface
var _ coreinterface.IClientDBPostgresSource = (*IUseConnector)(nil)

func (d *IUseConnector) GenerateQuery(param *models.PostgresSourceQuery) (*models.PostgresSourceQueryTune, error) {
	query := `
		SELECT t.id, t.name, t.updated_at, u.email
		FROM public.orders t
		LEFT JOIN public.users u ON t.user_id = u.id
		WHERE t.updated_at > '2024-01-01'
		  AND t.status = 'active'
		ORDER BY t.updated_at ASC
		LIMIT 100
	`
	return &models.PostgresSourceQueryTune{Query: query}, nil
}

// FetchRecords, GenerateNotification, and GenerateWAL are unused — this
// connector only implements query-based capture, but every method of
// IClientDBPostgresSource must still be defined to satisfy the interface.
func (d *IUseConnector) FetchRecords(_ *models.PostgresSourceFetch) <-chan *models.Record {
	ch := make(chan *models.Record)
	close(ch)
	return ch
}

func (d *IUseConnector) GenerateNotification(_ *models.PostgresSourceNotification) (*models.PostgresSourceNotificationTune, error) {
	return nil, fmt.Errorf("notification-based capture not implemented")
}

func (d *IUseConnector) GenerateWAL(_ *models.PostgresSourceWAL) (*models.PostgresSourceWALTune, error) {
	return nil, fmt.Errorf("WAL-based capture not implemented")
}

```