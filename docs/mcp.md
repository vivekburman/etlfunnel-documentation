# MCP Server

ETLFunnel ships with a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets an MCP-capable AI client (Claude, Claude Code, Cursor, or your own agent) do what you do in the web UI: browse workspaces, build connector hubs, flows and hooks, start builds and read run results, in plain language.

There is nothing extra to install or enable. The endpoint is part of the main ETLFunnel application and starts with it.

## How It Works

Every MCP tool maps to **one operation of the web UI**. A tool call is executed in-process through the same API the UI uses, so authentication, tenant scoping and validation are identical to what you get in the browser. If the UI would refuse an action, so does MCP.

- **Transport** - streamable HTTP, JSON responses, stateless. Requests are `POST`ed to a single endpoint.
- **Tools** - 100+ tools, generated from the UI's API, plus a few purpose-built ones (workspaces, documentation, hook code checking).
- **Protocol versions** - `2025-06-18`, `2025-03-26` and `2024-11-05`.

## Endpoint

```
POST http://<host>:<port>/<tenant>/mcp
```

For a default local install with the `etlfunnel` tenant:

```
http://localhost:9090/etlfunnel/mcp
```

The tenant in the URL must match the tenant of the credentials you authenticate with; otherwise the server answers `403`.

## Authentication

Send your ETLFunnel login with HTTP Basic authentication:

```
Authorization: Basic base64(username:password)
```

A `Bearer <access token>` (the same token the web UI uses) is also accepted. Missing or wrong credentials return `401`.

The MCP session runs **as that user**, with that user's permissions. Create a dedicated user for AI clients if you want to keep their activity separate in the audit log.

## Connecting a Client

### Claude Code

```bash
claude mcp add --transport http etlfunnel http://localhost:9090/etlfunnel/mcp \
  --header "Authorization: Basic $(printf 'admin:admin' | base64)"
```

### Generic JSON configuration

Most clients that support remote MCP servers accept a configuration like:

```json
{
  "mcpServers": {
    "etlfunnel": {
      "type": "http",
      "url": "http://localhost:9090/etlfunnel/mcp",
      "headers": {
        "Authorization": "Basic YWRtaW46YWRtaW4="
      }
    }
  }
}
```

Replace the value with `base64(username:password)` for your own account. Treat the header like a password and don't commit it to source control.

### Checking the connection with curl

```bash
URL=http://localhost:9090/etlfunnel/mcp
curl -si -u admin:admin -X POST $URL \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

The response carries an `Mcp-Session-Id` header. Send it on later calls so your selected workspace is remembered for that session.

## Working With Workspaces

Like the UI, MCP works inside one workspace at a time. Start with these tools:

| Tool | What it does |
| --- | --- |
| `list_workspaces` | Lists the workspaces of your tenant and shows which one is selected |
| `select_workspace` | Opens a workspace; it becomes the default `workspacePID` for every other tool |
| `current_workspace` | Shows the currently selected workspace |
| `create_workspace` | Creates a workspace and selects it |

After you select a workspace you no longer need to pass `workspacePID` to each tool. You can still pass it explicitly to target a different workspace.

## Using the Tools

Each tool takes its arguments in a consistent shape:

- **Path values** such as `flowPID` or `connectorHubPID` are top-level arguments.
- **Query-string values** go in `query`.
- **The JSON request body** goes in `body`.

Tools are annotated as read-only or destructive, so clients can show the right prompts. List operations (`.../search`) are paginated: `pageNum` starts at 1 and `pageSize` is 1-25. Bulk deletes accept at most 25 PIDs per call. Large responses are truncated at 256 KB, so narrow them with query parameters.

### Built-in documentation

The server embeds ETLFunnel's reference documentation so the AI can look things up instead of guessing:

| Tool | What it does |
| --- | --- |
| `docs_list` | Lists the available documents |
| `docs_search` | Searches them by keyword |
| `docs_read` | Reads a document or one section of it |

Topics covered include hook signatures, the Go models passed to hooks, per-connector behavior, worked examples, the `client/` folder layout, API limits and [EF codes](ef-codes).

### Hook code checking

Hook code (transformers, checkpoints, backlogs, destination write rules, termination rules, fixtures and connector entity hooks) is type-checked with `gopls` before it is saved.

- `check_hook_code` returns compiler diagnostics for proposed code without saving anything.
- Every tool that saves hook code runs the same check first and **refuses to save code that has errors**.
- To save anyway, pass `ignore_diagnostics: true`. This is also needed when `gopls` isn't reachable. It's the equivalent of the UI letting you save code that doesn't compile.
- Code that saves successfully is also written to the workspace folder, exactly as the UI editor does.

## Safety Model

An AI client can read data that contains text it shouldn't trust, and it can make mistakes. The server therefore adds several guards on top of the normal API checks.

### Confirmation for destructive actions

Any tool that deletes, aborts, resets credentials, starts or changes builds and runs, writes files, or manages runners and users does **not** run on the first call. It returns a preview and a `confirmation_token`:

```json
{
  "requires_confirmation": true,
  "operation": "DELETE /workspace/5/flow/12",
  "arguments": { "flowPID": 12 },
  "confirmation_token": "…",
  "note": "Nothing was executed. …"
}
```

Show the preview to the user; once they agree, repeat the **identical** call with the token. A token:

- is valid for **5 minutes**,
- works only for the **same tool and exact arguments**, and only for the user who received it,
- does not survive a server restart.

### Workspace scoping

Some internal services look up rows by ID alone, so a request for `/workspace/5/flow/99` could otherwise touch a flow that belongs to workspace 7. The web UI never sends such a request, but an AI client could (by mistake, or because of text injected into data it read). Before a tool runs, every entity ID it names (path values, `pids`, cross-references like `flowPid` or `sourceHubPid`, and IDs nested inside flow and collection definitions) is checked to belong to the targeted workspace. A mismatch is refused. Runners are the exception: they are tenant-level by design.

### Secret masking

Credentials are never returned to the AI client. Passwords, API keys, tokens, private keys and cloud credentials in connector hub connection parameters are replaced with `********` in every read, as are webhook URLs and runner API keys.

When the client updates a hub or webhook and leaves a secret out (or sends the mask back), the **stored value is kept**. Send an empty string to clear it.

### Audit log

Each tool call is logged with the user, the tool, the route and the result status. Request bodies are deliberately not logged because they may contain secrets.

## Example Prompts

Once connected, you can ask things like:

- *"List my workspaces and open the Sales one."*
- *"Show the flows in this workspace and tell me which ones failed in their last run."*
- *"Create a MySQL source hub and a Snowflake destination hub, then a flow that copies the `orders` table."*
- *"Write a transformer that masks the `email` column, check that it compiles, and attach it to the flow."*
- *"Delete the flow called `old-orders`."* (the client will show you the preview and ask before it runs)

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` with `WWW-Authenticate: Basic` | Missing, malformed or wrong credentials |
| `403 tenant does not match credentials` | The tenant in the URL differs from your user's tenant |
| `no workspace selected` | Call `list_workspaces` then `select_workspace`, or pass `workspacePID` |
| `unknown tool` | The tool list changed after an upgrade; have the client refresh its tool list |
| Hook save refused with diagnostics | The code doesn't compile; fix it, or pass `ignore_diagnostics: true` |
| `gopls is not reachable` | The language server isn't running; hook checks can't run until it is |
| Tool says confirmation token invalid | The token expired (5 minutes), the arguments changed, or the server restarted; repeat the call without a token to get a fresh one |

:::tip
Use a development instance, not production, when you first let an AI client loose on your workspaces.
:::
