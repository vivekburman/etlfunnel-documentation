# Setup Guide

This guide takes you from nothing to a running server with one runner connected. It takes about ten minutes. Afterwards, [build your first pipeline](./quickstart).

You need two things:

1. **The server**: the web UI, scheduler and API, with a PostgreSQL database behind it.
2. **At least one runner**: the agent that executes jobs, on any machine you choose.

## 1. Install the server

ETLFunnel ships in two forms. The Docker package is the quickest way to try it and is the one this guide follows. Native installers (Windows MSI, Linux `.deb`, macOS `.pkg`) are described at the end of this section.

### With Docker

You are given one archive matching your Docker host's architecture, `etlfunnel-community-linux-amd64.zip` or `etlfunnel-community-linux-arm64.zip`. Use `amd64` on Windows, Linux and Intel Macs, and `arm64` on Apple Silicon Macs and ARM Linux; Docker Desktop runs Linux containers either way. It contains the image, `docker-compose.yml`, `.env.example` and `.env.docker`.

```bash
cd etlfunnel-community-linux-<amd64|arm64>
cp .env.example .env
```

Leave `.env.docker` alone. It pins two settings that only make sense one way inside a container. Everything you configure goes in `.env`.

Replace the three placeholder secrets with real ones. Each must be unique to this install.

```bash
# Linux and macOS
sed -i.bak "s|replace_with_output_of_openssl_rand_hex_32|$(openssl rand -hex 32)|" .env
sed -i.bak "s|replace_with_a_random_32plus_char_secret|$(openssl rand -hex 32)|" .env
sed -i.bak "s|replace_with_a_different_random_32plus_char_secret|$(openssl rand -hex 32)|" .env
rm -f .env.bak
```

On Windows, the same three replacements are shown for PowerShell in the package's `INSTALL.md`.

Load the image and start the stack. It bundles a local PostgreSQL by default.

```bash
gunzip -c etlfunnel-app-linux-<amd64|arm64>.tar.gz | docker load
docker compose --profile local up -d
```

To use your own PostgreSQL instead, set `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER` and `PG_PASSWORD` in `.env` and leave out `--profile local`.

The first start needs outbound internet access and takes a little longer. The Go toolchain, the language server behind the code editor and the migration tool are downloaded once into a volume and reused afterwards. Watch progress with:

```bash
docker compose logs -f app
```

Open **http://localhost:9022**. The stack binds to `127.0.0.1` only, so it is not reachable from other machines; put a reverse proxy (nginx, Caddy) in front of it to expose it over a domain or HTTPS.

### With a native installer

The Windows MSI, Linux `.deb` and macOS `.pkg` install ETLFunnel as a service and create their own `.env` on first install, with fresh secrets for each install. Re-installing or upgrading leaves an existing `.env` alone. The service listens on port `9090` by default: open **http://localhost:9090**.

| | Location of `.env` |
|---|---|
| Windows | `C:\Program Files\ETLFunnel\.env` |
| Linux | `/opt/etlfunnel/.env` |

To change the port, edit `PORT` in `.env` and restart the service. If the Windows installer did not create `.env`, run `generate-env.ps1` from the install folder; it does nothing if the file already exists.

## 2. First sign-in

Sign in as `admin` with the password `admin`, and **change the password straight away**. This account is the tenant's **super user**. A free community license installs itself on first start, so there is nothing to sign up for or activate.

The super user creates every other account and the workspaces they work in. Nobody can approve their own change, so create at least two people who can approve before you expect anything to be approved. See [Workspaces](./workspaces) and [Roles and Permissions](./roles-and-permissions).

## 3. Add a runner

The server never runs your jobs itself. Every runner has to exist in ETLFunnel first, because the agent signs in with a name and an API key that must already be on the server.

1. In the left navigation open **Runner**.
2. Choose **Download**, enter a **Runner Name** and **Hostname**, and pick the package for the target machine's operating system.
3. Note the generated **API Key**.

<img src="img/page_setup_guide/runner_download.png" alt="Runner Creation Modal" width="400" />

Runners are available for **Linux (amd64)** and **macOS (Apple silicon)**. Extract the package on the target machine, set `apiKey`, `serverUrl` and `tenantCode` in `config.yaml`, and install it:

```yaml
name: "etlrunner"
port: 8080
apiKey: "<the key generated for this runner>"
tenantCode: "etlfunnel"
mode: "production"
serverUrl: "http://localhost:9022"
```

```bash
./setup.sh
cd ~/.config/etlrunner      # macOS: ~/Library/Application Support/etlrunner
./check-deps.sh
./start.sh
```

A runner compiles every job on its own machine, so the machine needs **Go** and a **C compiler**. `check-deps.sh` tells you what is missing. The [Runner](./runner) page covers requirements, running as a service, updating and troubleshooting.

Two details trip people up:

- A runner is **tagged** for one purpose when you create it, and takes only the work that fits the tag: your own dev work, shared dev, staging or production. Shared runners are the super user's to create. Until a runner is tagged, it runs nothing. See [Runner](./runner).
- Run the runner from its **install folder**, not from the folder you extracted the zip into.

## 4. Check it works

1. **The server** loads in the browser.
2. **The runner** shows on the **Runner** page with an **Updated Timestamp** within the last 5 seconds.
3. **A database connection** works: in **Builder › Hub**, create a hub for one of your databases and choose **Test connection**.

If all three pass, go on to the [Quickstart](./quickstart).

## Upgrading

**The server (Docker).** Load the new image, copy the new `docker-compose.yml` and `.env.docker` into your existing deployment folder (keep your real `.env`), and recreate the app container:

```bash
gunzip -c etlfunnel-app-linux-<amd64|arm64>.tar.gz | docker load
docker compose --profile local up -d --force-recreate app
```

`--force-recreate` is needed because the image tag does not change between versions. Your database and the downloaded toolchain live in named volumes and survive this. They are lost only if you run `docker compose down -v`.

**A runner.** Runners do not update themselves. See [Updating the Runner](./runner#updating-the-runner).

## Troubleshooting

| Symptom | What to check |
|---|---|
| The page does not load | `docker compose logs -f app`. The first start is slow while the toolchain downloads. On a native install, check the service and the `PORT` in `.env` |
| The runner never appears or never updates | `apiKey`, `tenantCode`, and that `serverUrl` is reachable from the runner's machine |
| The runner shows but jobs do not start | The runner has no tag, or its tag does not fit the stage. See [Runner](./runner) |
| A hub's connection fails | Credentials, firewall rules, and that the **runner's** machine (not just the server) can reach the database |
