---
sidebar_position: 1
---

# Concepts

## What is ETLFunnel?

ETLFunnel is a developer-first ETL (Extract, Transform, Load) SaaS tool designed for on-premise installation. With a simple setup, you gain access to a comprehensive data processing platform that enables seamless data integration across multiple database systems.

## Core Architecture

Our ETL tool operates on a three-tier architecture:

- **Machine Layer**: Collections
- **Schema Layer**: Flows  
- **Entity Layer**: Pipelines

`[PLACEHOLDER: Architecture overview diagram screenshot]`

## Component Definitions

### **Hub**
Central repository for all database connections example PostgreSQL, MongoDB, and other systems. Stores connection parameters for:
- Source databases
- Destination databases  
- Auxiliary databases

`[PLACEHOLDER: Hub interface screenshot]`

### **Connectors**
Bridge the gap between Hub connections and your database operations through a two-tier connector system:

#### **SQL Connectors**
- Utilize existing SQL Hub connections to connect to relational databases as source or destination
- Support various SQL databases (PostgreSQL, MySQL, SQL Server, etc.)
- Contain custom hooks for data pull/push operations specific to each connector entity

#### **NoSQL Connectors** 
- Utilize existing NoSQL Hub connections to connect to document/key-value databases as source or destination
- Support various NoSQL databases (MongoDB, Redis, Cassandra, etc.)
- Contain custom hooks for data pull/push operations specific to each connector entity

#### **Connector Entities**
Each connector entity contains multiple library-defined functions that provide configuration details for data operations:

**Configuration Functions Examples:**
- **PostgreSQL Notification Channel**: Implement `GenerateNotificationQuery()` function that returns a Golang struct containing the channel name to connect to
- **MongoDB Operations**: Implement `GenerateQuery()` functions that return Golang structs containing collection name and database name
- **Custom Data Pull/Push Hooks**: Write custom code within each connector entity to:
  - Define data extraction logic from source databases
  - Implement data insertion/update logic for destination databases
  - Handle connection-specific operations and optimizations

`[PLACEHOLDER: Connector configuration screenshot]`

### **Transformers**
Custom transformation hooks that process data flowing through pipelines. Each transformer receives a struct containing:
- **Record**: Data as `map[string]interface{}` 
- **DB Connections**: Access to configured database connections

**Function Requirements:**
- Must return a record of type `map[string]interface{}`
- Returned record becomes input for the next transformer in the pipeline

**Pipeline Processing:**
- Multiple transformers can be chained in a pipeline
- Transformers execute in sequential order
- Output from previous transformer becomes input for next transformer
- If a transformer returns `nil`, the current record is skipped and processing continues with the next record

**Use Cases:**
- Modify data structure and field mappings
- Apply business logic and calculations
- Validate data integrity and filter records
- Enrich data using auxiliary database connections

`[PLACEHOLDER: Transformer code editor screenshot]`

### **User Library**
Repository for user-defined utility and helper functions that can be reused across multiple pipelines and transformations.

**Supported Components:**
- **Constants**: Define reusable configuration values and business constants
- **File I/O Handlers**: Custom functions for reading from and writing to various file formats
- **Data Interpolation Methods**: Generic utilities for data processing and manipulation
  - Nil checkers and validators
  - Type casting and conversion functions
  - Data formatting and standardization utilities
- **Custom Helper Functions**: Any reusable business logic or utility functions

**Workspace Access:**
- All user libraries defined in the workspace are accessible during pipeline execution
- Functions can be called from transformers, connectors, and other pipeline components
- Promotes code reusability and maintains consistency across different pipelines

**Benefits:**
- Centralized code management for common operations
- Reduced code duplication across pipelines
- Easier maintenance and updates to shared functionality
- Standardized data processing patterns across the workspace

`[PLACEHOLDER: User Library interface screenshot]`

### **Checkpoint & Recovery**

#### **Checkpoints**
Disaster recovery tracking hooks that run at pipeline stages to:
- Store process state
- Enable restart capabilities
- Track execution progress

#### **Backlog** 
Error handling hooks that activate when data push operations fail:
- Log failed operations
- Queue retry attempts
- Store failure details for analysis

`[PLACEHOLDER: Checkpoint and Backlog monitoring dashboard screenshot]`

### **Execution Components**

#### **Pipelines**
Define data flow relationships from source to destination entities: