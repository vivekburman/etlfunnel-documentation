# Setup Guide

This guide will walk you through the complete setup process for ETLFunnel, including configuration, and runner deployment.

## Service Configuration

After installation, ETLFunnel service will start on port `9090`. You can access the web interface at:

```
http://localhost:9090
```

### Changing the Default Port

If you need to change the default port update the .env file and restart the service:

1. **Locate the configuration file**
   - **Windows**: `C:\Program Files\etlfunnel\.env`
   - **Linux**: `/opt/etlfunnel/.env`

2. **Update the port configuration**
   ```env
   # Edit the .env file
   PORT=8080  # Change to your desired port
   HOST=localhost
   ```

## Runner Installation

Runners are agents that execute ETL jobs on remote or local machines. Follow these steps to set up a runner:

### Step 1: Access Runner Configuration

1. Log in to your ETL platform workspace at `http://localhost:9090`
2. In the left navigation panel, click on **"Runner"**
3. You'll see the runner management interface

### Step 2: Download and Configure Runner

1. Click **"Download"**
2. Fill in the required information:
   - **Runner Name**: A descriptive name for your runner (e.g., `production-runner`, `dev-machine-01`)
   - **Hostname**: The hostname of the machine where this runner will operate

<img src="/img/page_setup_guide/runner_download.png" alt="Runner Creation Modal" width="400" />

### Step 3: Generate API Key

After providing the runner details:

1. The system will generate a unique **API Key** for this runner
2. This API key will be used to authenticate all requests from the runner to the main service


### Step 4: Install the Runner

1. Download the runner package for your target machine's operating system
2. Extract the package to your desired location

## Configure the Runner
1. **Navigate to the runner directory:**
   ```bash
   cd /path/to/runner/
   ```

2. **Edit the configuration file:**
   ```bash
   nano config.yaml
   # or use your preferred text editor
   ```

3. **Update the YAML parameters:**
   ```yaml
   name: "etlrunner"
   port: 8080
   apiKey: "f893e30e549c5c55"
   mode: "production"
   serverUrl: "http://localhost:9090"
   ```

4. **Save the configuration file** and proceed to start the runner service.

## Database Connectivity Setup

:::warning Critical Step
Proper database connectivity configuration is essential for both the main server and runner machines to function correctly.
:::

## Verification

After completing the setup:

1. **Verify Service**: Access `http://localhost:9090` (or your configured port)
2. **Check Runner Status**: In the Runner tab, confirm the runner's "Updated Timestamp" shows within the last 5 seconds to ensure active connectivity
3. **Test Database Connection**: Create a test Connector Hub to verify database connectivity
4. **Run Test Job**: Execute a simple ETL job to ensure everything works end-to-end

## Troubleshooting

### Common Issues

- **Port conflicts**: Change the port in `.env` file
- **Runner not connecting**: Check API key and network connectivity
- **Database connection failed**: Verify credentials and firewall rules