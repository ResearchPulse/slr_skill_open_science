# SLR Open-Science integration

This folder contains the Open-Science integration for the SLR project. It is intentionally kept outside the backend repository.

## Install the root package

Use the pinned root package reference for setup and connector configuration:

```powershell
npx --yes github:<org>/slr_skill_open_science#v0.1.0 setup
```

The root package provides the `slr` installer. `setup` is a read-only preview: it reports the package root, whether the local `open-science` CLI is detected, and the next setup steps. It does not change connector state or local profiles. Add `--json` for a machine-readable preview:

```powershell
npx --yes github:<org>/slr_skill_open_science#v0.1.0 setup --json
```

Use `doctor` to inspect packaged assets and Open-Science CLI availability:

```powershell
npx --yes github:<org>/slr_skill_open_science#v0.1.0 doctor
```

`doctor` prints a JSON report and exits non-zero when a packaged asset is missing. An unavailable `open-science` CLI is reported in the result; it is not itself a package-asset failure. Neither command requests or prints the project token.

## Contents

- `mcp/slr-agent-mcp/` — local TypeScript MCP server, exposing exactly these four tools:
  - `list_assigned_tasks`
  - `get_assigned_task`
  - `get_task_fulltext`
  - `submit_review_result`
- `skill/slr/` — `/slr` skill instructions for Open-Science task discovery, review drafting, and confirmation-gated submission.
- `docs/SLR_MCP_OPEN_SCIENCE_SETUP.md` — setup and troubleshooting guide.

## Root MCP connector

Configure the released root package as the Open-Science connector command:

```text
Command: npx
Arguments: --yes github:<org>/slr_skill_open_science#v0.1.0 --mcp
```

The equivalent shell command is:

```powershell
npx --yes github:<org>/slr_skill_open_science#v0.1.0 --mcp
```

Set `SLR_API_BASE_URL` and `SLR_AGENT_TOKEN` in the connector environment. The root `--mcp` entrypoint forwards stdio to the MCP server without invoking a shell; stdout is reserved for MCP JSON-RPC and diagnostics use stderr.

## Local development run

From `mcp/slr-agent-mcp/`:

```powershell
$env:SLR_API_BASE_URL = "https://<backend-host>/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
npx slr-agent-mcp
```

The local package communicates over stdio. The token is passed only through the protected connector/runtime environment and is sent to the backend only as an `Authorization: Bearer` header. Never place the project token in chat, prompts, the skill, source code, source control, issues, screenshots, or logs. If it is exposed, rotate it in SLR and update the connector environment.
