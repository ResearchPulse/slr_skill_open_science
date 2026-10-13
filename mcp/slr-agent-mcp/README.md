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
python ../../scripts/slr_mcp.py --profile <profile-name>
```

On Windows PowerShell:

```powershell
$env:SLR_API_BASE_URL = "https://<backend-host>/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
python ../../scripts/slr_mcp.py --profile <profile-name>
```

The released process communicates over stdio. Protocol messages use stdout; diagnostics use stderr. The TypeScript package remains for transition/parity tests; Open-Science production connectors use the Python runtime.

## Exposed tools

- `list_assigned_tasks`
- `connection_test`
- `get_assigned_task`
- `get_task_fulltext`
- `submit_review_result`
- `get_extraction_context`
- `get_extraction_fulltext`
- `save_extraction_draft`
- `check_extraction_draft`
- `submit_extraction_draft`
- `finalize_extraction_consensus`

Submission and consensus proposal are write operations. The Open-Science skill shows the exact draft and asks the user for one `confirm` or `cancel`; the MCP adapter then handles the backend challenge/digest handshake without a second prompt. Successful extraction writes are isolated pending proposals; canonical reviewer/consensus records still require the human web workflow.

`get_task_fulltext` requires `taskId`, `stage: "FULL_TEXT"`, and the `markdownPath` returned by `get_assigned_task`. Do not call it for `TITLE_ABSTRACT` tasks. The backend independently enforces task ownership, stage, and Markdown availability; `202` includes the retry delay and `409 FULLTEXT_STAGE_REQUIRED` must not be retried.

## Development

```bash
npm install
npm run typecheck
npm test
npm run compile
```

The compiled TypeScript entrypoint is `out/index.js` for local parity tests only; it is not the production Open-Science connector runtime.
