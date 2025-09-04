---
sidebar_position: 1
---

# Concepts

## What is ETLFunnel?

ETLFunnel is a developer-first ETL (Extract, Transform, Load) SaaS tool designed for on-premise installation. With a simple setup, you gain access to a comprehensive data processing platform that enables seamless data integration across multiple database systems.

## Core Architecture

Our ETL tool operates on a three-tier architecture:

- **Database Layer**: Collections
- **Schema Layer**: Flows  
- **Entity Layer**: Pipelines

![Architecture overview diagram](/img/architecture.svg)

# Component Definitions

## **Hub**
Central repository for all database connections example PostgreSQL, MongoDB, and other systems. Stores connection parameters for:
- Source databases
- Destination databases  
- Auxiliary databases

## **Connectors**
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

## **Transformers**
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

## **User Library**
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

## **Pipeline Hooks**

### **Checkpoint Hook**
A pipeline can implement a checkpoint hook that provides disaster recovery and progress tracking capabilities. This hook is automatically invoked whenever the pipeline commits data, whether during bulk operations or individual record commits.

**When it triggers:**
- During bulk commit operations
- During individual record commits
- At any point when the pipeline stamps a commit

**What it receives:**
- The last processed record
- Database connection details
- Current pipeline state information

**Use cases:**
- Save pipeline progress metadata to external files or databases
- Enable restart capabilities by tracking the last successfully processed position

**Example scenario:** If a pipeline processes 1 million records and fails at record 750,000, the checkpoint hook data allows the pipeline to be aware to start from 750,001 instead of starting over.

---

### **Backlog Hook**
A pipeline can implement a backlog hook that handles error scenarios during data push operations to destinations. This hook activates when the pipeline encounters failures while attempting to write data.

**When it triggers:**
- When bulk dump operations fail
- When individual record commit operations fail
- During any destination push error

**What it receives:**
- The failed record details
- Database connection information
- Error context and failure details

**Use cases:**
- Log failed operations for debugging and analysis
- Implement retry mechanisms for failed records
- Store problematic data for manual review
- Generate error reports and failure statistics
- Queue failed records for later reprocessing

**Example scenario:** If a database connection times out while inserting a batch of records, the backlog hook captures the last record and can be stored separately, allowing for retry attempts or manual intervention without losing data.