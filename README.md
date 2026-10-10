# SLR Open-Science integration

This folder contains the Open-Science integration for the SLR project. It is intentionally kept outside the backend repository.

## Install the root package

Use the pinned root package reference for setup and connector configuration:

```powershell
npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 setup
```

The root package provides the `slr` installer. `setup` reports package readiness and can create/update secret-free profile metadata. It never accepts or prints the project token. Add `--json` for machine-readable output:

```powershell
npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 setup --json
```

`setup` also copies the managed skill directory to `~/.agents/skills/slr`. In Open-Science, import that installed directory from Settings → Skills → Import installed skills, then enable `/slr`. Use `--skill-dir PATH` to choose another local import directory. If an unmanaged skill already exists at the target, the command stops instead of overwriting it.

Use `doctor` to inspect packaged assets and Open-Science CLI availability:

```powershell
npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 doctor
```

`doctor` prints a JSON report and exits non-zero when a packaged asset is missing. An unavailable `open-science` CLI is reported in the result; it is not itself a package-asset failure. Neither command requests or prints the project token.

Create a profile and workspace without putting the token in the shell:

```powershell
npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 profile create `
  --name afl-review `
  --api-base-url https://<backend-host>/api `
  --project-id <project-id> `
  --project-name "AFL review" `
  --credential-id <open-science-credential-id>
npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 workspace init --profile afl-review
```

Print or register the connector:

```powershell
npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 config --profile afl-review
npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 setup --profile afl-review --register
```

`--register` uses the local Open-Science CLI when available. Otherwise import the JSON from `config` manually and bind the saved Credential to `SLR_AGENT_TOKEN`.

## Contents

- `mcp/slr-agent-mcp/` — local TypeScript MCP server, exposing exactly these four tools (no health, config, or helper tools):
  - `list_assigned_tasks`
  - `get_assigned_task`
  - `get_task_fulltext`
  - `submit_review_result`
- `skill/slr/` — `/slr` skill instructions for Open-Science task discovery, review drafting, and confirmation-gated submission.
- `docs/SLR_MCP_OPEN_SCIENCE_SETUP.md` — setup and troubleshooting guide.

Submission has exactly two confirmation gates: `/slr review` shows the saved draft and asks the user for `confirm` or `cancel`; only after `confirm` does it call `submit_review_result`. The server then requires MCP elicitation with `confirm: true` and a matching payload digest immediately before the single backend POST. If either gate is declined or unavailable, no write is sent.

## Root MCP connector

Configure the released root package as the Open-Science connector command:

```text
Command: npx
Arguments: --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 --mcp
```

The equivalent shell command is:

```powershell
npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 --mcp
```

Set `SLR_API_BASE_URL` and bind `SLR_AGENT_TOKEN` to an Open-Science Credential in the connector environment. Optional `SLR_PROFILE_ID`, `SLR_PROJECT_ID`, `SLR_PROJECT_NAME`, and `SLR_API_ALLOWED_HOSTS` provide safe profile context and an explicit host allowlist. The root `--mcp` entrypoint forwards stdio to the MCP server without invoking a shell; stdout is reserved for MCP JSON-RPC and diagnostics use stderr.

## Local development run

From `mcp/slr-agent-mcp/`:

```powershell
$env:SLR_API_BASE_URL = "https://<backend-host>/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
npx slr-agent-mcp
```

The local package communicates over stdio. The token is passed only through the protected connector/runtime environment and is sent to the backend only as an `Authorization: Bearer` header. Never place the project token in chat, prompts, the skill, source code, source control, issues, screenshots, or logs. If it is exposed, rotate it in SLR and update the connector environment.
