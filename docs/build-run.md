---
sidebar_position: 11
---

# Creating a New Build

To create a new ETL build, navigate to the builds section and click **Create New**. You'll be presented with several configuration tabs that need to be properly set up.

## Basic Configuration

### Purpose of Run
Provide a clear, descriptive name for your ETL build. This helps identify the build's purpose in logs and monitoring dashboards.

**Example**: `Automated ETL Build`

### What to Run
Select the execution type for your build:
- **Flow**: Execute a predefined data flow pipeline
- **Collection**: Execute a group of flows

## Execution Settings

### Runner
Select the execution environment for your build:
- **dsx**: Use the DSX (Data Science Experience) runtime environment

### Schedule Options
Configure when your ETL build should run:

- **Run now**: Execute the build immediately upon creation
- **Recurring (UTC Time)**: Set up automated recurring executions
- **Schedule (UTC Time)**: Schedule for a specific date and time

:::tip
All scheduling uses UTC time. Make sure to convert your local time to UTC when scheduling builds.
:::

## Logging Configuration

### Logging Level
Set the verbosity of logs generated during execution. The system supports all Go logger levels:

- **Debug**: Most detailed logging for development and troubleshooting
- **Info**: Standard informational messages (recommended for production)
- **Warn**: Warning messages and above
- **Error**: Error messages and above
- **Dpanic**: Development panic - panics in development, logs in production
- **Panic**: Logs message and panics
- **Fatal**: Logs message and terminates the program

:::info
Logging levels are hierarchical - each level includes all messages from higher severity levels. Use **Info** for production builds and **Debug** for development and troubleshooting.
:::

## Execution Policy

### Pipeline Parallelism
Choose how your pipeline tasks should be executed:

- **Sequential**: Tasks run one after another in order
- **Optimal Parallel**: System automatically determines the best parallelization based on CPU cores on the remote runner machine
- **All Parallel**: All tasks run simultaneously

:::warning
**All Parallel** mode can consume significant resources. Use **Optimal Parallel** for best performance-resource balance.
:::

### Connection Retry Settings

#### Connection Retry with Exponential Backoff
Enable this option to automatically retry failed connections with increasing delays, useful for handling temporary network issues.

#### Immediate Pipeline Retry
Enable this option to retry failed pipeline steps immediately without waiting.

#### Maximum Connection Retries
Configure the maximum number of retry attempts (default: 1).


## Additional Configuration

### Execution Tags
Execution tags are used to add simple labels to your builds, making it easier to identify and group them when viewing or managing multiple builds.

### Webhook Integration
Webhook integration can be configured to send alerts whenever a build execution encounters an error, helping teams respond quickly to issues.