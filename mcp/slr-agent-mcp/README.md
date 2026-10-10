# SLR Agent MCP

Local MCP server for the SLR project-scoped agent API.

## Required settings

```text
SLR_API_BASE_URL=https://<backend-host>/api
SLR_AGENT_TOKEN=<project-scoped-token>
```

Optional:

```text
SLR_REQUEST_TIMEOUT_MS=30000
```

The token is sent only as an `Authorization: Bearer` header. Do not put it in prompts, source files, screenshots, logs, or chat messages. If it was exposed, rotate it from the SLR project settings.

## Run locally

```bash
SLR_API_BASE_URL=https://<backend-host>/api \
SLR_AGENT_TOKEN=<project-token> \
npx slr-agent-mcp
```

On Windows PowerShell:

```powershell
$env:SLR_API_BASE_URL = "https://<backend-host>/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
npx slr-agent-mcp
```

The process communicates over stdio. Protocol messages use stdout; diagnostics use stderr.

## Exposed tools

- `list_assigned_tasks`
- `get_assigned_task`
- `get_task_fulltext`
- `submit_review_result`

The last tool is a write operation. The first call returns a digest and sends no backend request. After the user confirms that exact digest, the client must repeat the call with `confirmation: { confirm: true, digest }`; only then does the server send the backend POST. The Open-Science skill must also show the draft and ask the user before the first call.

## Development

```bash
npm install
npm run typecheck
npm test
npm run compile
```

The compiled entrypoint is `out/index.js`.
