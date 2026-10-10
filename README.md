# SLR Open-Science integration

This folder contains the Open-Science integration for the SLR project. It is intentionally kept outside the backend repository.

## Contents

- `mcp/slr-agent-mcp/` — local TypeScript MCP server, exposing exactly the four operations in the SLR agent API contract.
- `skill/slr/` — `/slr` skill instructions for Open-Science task discovery, review drafting, and confirmation-gated submission.
- `docs/SLR_MCP_OPEN_SCIENCE_SETUP.md` — setup and troubleshooting guide.

## Local run

From `mcp/slr-agent-mcp/`:

```powershell
$env:SLR_API_BASE_URL = "https://<backend-host>/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
npx slr-agent-mcp
```

The package communicates over stdio. Configure the same command and environment variables in the Open-Science MCP connector. Never place the project token in the skill, prompts, source control, or screenshots.
