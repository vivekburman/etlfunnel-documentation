# Runner

The runner is the agent that executes ETLFunnel jobs on a machine you choose. It registers with the ETLFunnel server using an API key, picks up the jobs assigned to it, **compiles each one on the host** and runs it. This page covers installing the runner, starting and stopping it, and running it as a service.

:::info Supported platforms
Runners are available for **Linux (amd64)** and **macOS (Apple silicon, arm64)**. Windows is not supported.
:::

## What You Get

Each runner package is built for one OS and architecture and contains everything the runner needs except the tools listed under [Requirements](#requirements-on-the-host). Nothing is downloaded during installation or at run time.

The package is a zip named `etlrunner-<os>-<arch>-<version>.zip`:

| File | Purpose |
| --- | --- |
| `etlrunner-<os>-<arch>` | The runner binary |
| `config.yaml` | Configuration (edit before installing) |
| `execution/` | Job sources, vendored Go dependencies and bundled native libraries (for example the Oracle Instant Client) |
| `setup.sh` | Copies the files above into the install folder |
| `check-deps.sh` | Checks what the host must provide |
| `start.sh`, `stop.sh` | Start and stop the runner by hand |
| `install-service.sh`, `uninstall-service.sh` | Run the runner as a service |

## Requirements on the Host

The runner compiles each job on the machine it runs on, so these must be installed first:

- **Go**, the version in `execution/go.mod` or newer.
- **A C compiler** (`gcc`, `cc` or `clang`, or the one named in the `CC` variable). The shared job packages include the Oracle driver, which uses cgo.
- **Linux only: `libaio.so.1`**, needed by the Oracle Instant Client at runtime.
  - Debian/Ubuntu: `sudo apt install libaio1t64` (or `libaio1`).
  - On Ubuntu 24.04+ and Debian 13 that package only ships `libaio.so.1t64`, which Oracle doesn't look for, so link the old name:
    ```bash
    sudo ln -s "$(ls /usr/lib/*/libaio.so.1t64 | head -1)" "$(dirname "$(ls /usr/lib/*/libaio.so.1t64 | head -1)")/libaio.so.1" && sudo ldconfig
    ```

The Oracle Instant Client itself is bundled in `execution/libDir/oracle/instantclient/`. Oracle's licence terms apply to it.

## 1. Create the Runner in ETLFunnel

1. In the ETLFunnel web UI, open **Runner** in the left navigation.
2. Click **Download**, enter a **Runner Name** and **Hostname**, and choose the package for the target machine's OS.
3. Note the generated **API Key**. The runner uses it to authenticate every request to the server.

See the [Setup Guide](setup-guide#runner-installation) for the screens.

## 2. Configure

Extract the zip on the target machine and edit `config.yaml`:

```yaml
name: "etlrunner"
port: 8080
apiKey: "<the key generated for this runner>"
tenantCode: "etlfunnel"
mode: "production"
serverUrl: "http://localhost:9090"
logLevel: "info"
compressLogs: true
consoleOutput: true
clearJobArtifacts: true
```

| Key | Meaning |
| --- | --- |
| `name` | Name of the runner. Also the **install folder name** and the **service name** |
| `port` | Port the runner's own HTTP server listens on |
| `apiKey` | API key generated for this runner in the UI |
| `tenantCode` | Your tenant code |
| `serverUrl` | URL of the ETLFunnel server the runner connects to |
| `mode` | `production` or `development` |
| `logLevel` | `debug`, `info`, ... |
| `compressLogs`, `consoleOutput` | Log rotation compression and console output |
| `clearJobArtifacts` | Remove a job's build artifacts after it finishes |

## 3. Install

Run the setup script from the extracted folder, **as the user that will run the runner**. Don't use `sudo`; it only writes to your home folder.

```bash
./setup.sh
```

It copies the binary, `config.yaml`, the helper scripts and the `execution/` folder into the install folder, where `<name>` is the `name` from `config.yaml`:

| OS | Install folder |
| --- | --- |
| Linux | `~/.config/<name>` |
| macOS | `~/Library/Application Support/<name>` |

On macOS, `setup.sh` also clears the download quarantine flag on the bundled libraries so they can load. Every following command runs **from the install folder**.

## 4. Check Dependencies

```bash
./check-deps.sh
```

The script checks the package files, Go (and its version), the C compiler, the bundled Oracle Instant Client and, on Linux, `libaio.so.1`. The exit code tells you the result:

| Exit code | Meaning |
| --- | --- |
| `0` | Everything is present |
| `1` | A required dependency is missing (Go, C compiler or package files). Jobs can't run |
| `2` | Only Oracle-related warnings. Oracle jobs fail, other jobs run |

The runner also checks the Oracle client, `libaio.so.1` and the C compiler when it starts, and logs [`EF-R502`, `EF-R503` and `EF-R504`](ef-codes) as warnings. It still starts. A missing C compiler affects every job; a missing Oracle client or `libaio` only affects Oracle jobs.

## 5. Run the Runner

You can run the runner in two ways. Pick one; don't mix them.

### Standalone (manual start and stop)

Good for trying things out, for development, and for machines where you don't have admin rights.

```bash
./start.sh          # checks dependencies first
./start.sh --force  # skip the dependency check
./stop.sh
```

- `start.sh` runs the runner in the background and writes its process ID to `etlrunner.pid`. If the dependency check reports a missing required dependency it refuses to start, unless you pass `--force`.
- Console output goes to `etlrunner.out` and is overwritten on every start. The runner's own logs follow `config.yaml`.
- `stop.sh` asks the runner to shut down and waits up to 15 seconds before forcing it.
- A standalone runner does **not** come back after a reboot or a crash.

### As a service

Good for servers. The runner starts at boot and restarts on failure.

```bash
sudo ./install-service.sh
sudo ./uninstall-service.sh
```

The service runs as the user who owns the install folder (never as root). If the folder is owned by root, run `setup.sh` as a normal user first.

| | Linux | macOS |
| --- | --- | --- |
| Service manager | systemd | launchd |
| Definition | `/etc/systemd/system/<name>.service` | `/Library/LaunchDaemons/com.etlfunnel.<name>.plist` |
| Status | `systemctl status <name>` | `sudo launchctl print system/com.etlfunnel.<name>` |
| Logs | `journalctl -u <name> -f` | `etlrunner.out` in the install folder |
| Restart | `sudo systemctl restart <name>` | `sudo launchctl kickstart -k system/com.etlfunnel.<name>` |
| Stop | `sudo systemctl stop <name>` | `sudo launchctl bootout system /Library/LaunchDaemons/com.etlfunnel.<name>.plist` |

Things to know about the service:

- **Don't use `start.sh` while the service is installed.** Manage it with `systemctl` or `launchctl`.
- The service gets its own `PATH`: the one that finds `go` for the installing user plus the standard system folders. If you later install Go or the compiler somewhere else, run `install-service.sh` again.
- Installing again is safe; it replaces the existing definition.
- Uninstalling removes the service definition but leaves the install folder and any running jobs alone.

## Updating the Runner

1. Download the new package from the **Runner** page and extract it.
2. Keep your existing `config.yaml` (or copy your `apiKey` and settings into the new one).
3. Stop the runner (`./stop.sh`, or stop the service).
4. Run the new `./setup.sh`.
5. Start the runner again.

If the runner runs as a service and the binary name or `name` changed, run `sudo ./install-service.sh` once more.

## Restarts and Running Jobs

Jobs run as their own detached processes. **Stopping or restarting the runner, or the service, does not stop jobs that are already running.** On Linux the service unit uses `KillMode=process` and on macOS `AbandonProcessGroup`, so the service manager leaves them alone too. When the runner comes back it picks the jobs up again.

## Verify

Open the **Runner** page in the ETLFunnel UI. A healthy runner's **Updated Timestamp** is within the last 5 seconds.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Runner doesn't appear or never updates | Check `apiKey`, `tenantCode` and that `serverUrl` is reachable from this machine |
| `start.sh` says dependencies are missing | Run `./check-deps.sh` and install what it lists, or use `--force` |
| Jobs fail to compile | Go or the C compiler isn't in the `PATH` of the user (or service) running the runner. For a service, rerun `install-service.sh` |
| Oracle job fails with `DPI-1047` | The Instant Client wasn't found or isn't for this OS. Run `check-deps.sh`; on Linux make sure `libaio.so.1` exists |
| macOS blocks the Oracle library | `setup.sh` clears the quarantine flag. If you copied files by hand run `xattr -dr com.apple.quarantine execution/libDir` |
| Port already in use (`EF-R501`) | Change `port` in `config.yaml` and restart the runner |
