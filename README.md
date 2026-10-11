# SLR Open-Science integration

This folder contains the Open-Science integration for the SLR project. It is intentionally kept outside the backend repository.

## Install the root package

Use the GitHub package reference for setup and connector configuration:

```powershell
npx github:ResearchPulse/slr_skill_open_science
```

## Fast setup (default)

Running the command with no subcommand starts the Claude-style interactive setup. It detects the runtime, copies `/slr`, uses the production API URL by default, asks only for the hidden project token, stores the token in the selected local profile, tests the API, and attempts Open-Science connector registration. Use `--api-base-url` only when targeting another server.

The token is stored outside profile metadata under `SLR_CONFIG_DIR` (default `~/.slr`) with restrictive permissions where supported. It is never printed, placed in generated connector JSON, or sent to chat. Use `--json` for a non-interactive report; it never prompts for credentials. If automatic registration is unavailable, import the generated connector configuration manually. After importing and enabling the skill, run `/slr setup` in Open-Science for the read-only check.

The root package provides the `slr` installer. `setup` performs the interactive setup described above: it can create/update a profile, store a token outside profile metadata, test the API, and attempt connector registration. It never prints the project token. Add `--json` for machine-readable, non-interactive output:

```powershell
npx github:ResearchPulse/slr_skill_open_science --json
```

`setup` also copies the managed skill directory to `~/.agents/skills/slr`. In Open-Science, import that installed directory from Settings → Skills → Import installed skills, then enable `/slr`. Use `--skill-dir PATH` to choose another local import directory. If an unmanaged skill already exists at the target, the command stops instead of overwriting it.

After the skill is enabled, `/slr setup` is the quick in-chat setup check. It calls the read-only task listing, reports the connected project and assigned-task state, or shows only the missing connector settings. It never asks for the project token in chat and cannot modify Open-Science connector settings.

Use `doctor` to inspect packaged assets and Open-Science CLI availability:

```powershell
npx github:ResearchPulse/slr_skill_open_science doctor
```

`doctor` prints a JSON report and exits non-zero when a packaged asset is missing. An unavailable `open-science` CLI is reported in the result; it is not itself a package-asset failure. `doctor` and `setup --json` never prompt for credentials or print the project token.

Create a profile and workspace without putting the token in the shell:

```powershell
npx github:ResearchPulse/slr_skill_open_science profile create `
  --name afl-review `
  --api-base-url https://<backend-host>/api `
  --project-id <project-id> `
  --project-name "AFL review" `
  --credential-id <open-science-credential-id>
npx github:ResearchPulse/slr_skill_open_science workspace init --profile afl-review
```

Print or register the connector:

```powershell
npx github:ResearchPulse/slr_skill_open_science config --profile afl-review
npx github:ResearchPulse/slr_skill_open_science setup --profile afl-review --register
```

`--register` uses the local Open-Science CLI when available. Otherwise import the JSON from `config` manually. The generated connector includes the selected profile; the root launcher reads that profile's protected local token. An Open-Science Credential bound to `SLR_AGENT_TOKEN` may be used as a host-managed override, but it is not required for the local-profile flow.

## Contents

- `mcp/slr-agent-mcp/` — local TypeScript MCP server, exposing exactly these four tools (no health, config, or helper tools):
  - `list_assigned_tasks`
  - `get_assigned_task`
  - `get_task_fulltext`
  - `submit_review_result`
- `skill/slr/` — `/slr` skill instructions for Open-Science task discovery, review drafting, and confirmation-gated submission.
- `docs/SLR_MCP_OPEN_SCIENCE_SETUP.md` — setup and troubleshooting guide.

Submission has exactly two confirmation gates: `/slr review` shows the saved draft and asks the user for `confirm` or `cancel`; only after `confirm` does it call `submit_review_result`. The first tool call returns a matching payload digest without writing, and the second call must include `confirmation: { confirm: true, digest }` immediately before the single backend POST. If either gate is declined, unavailable, or mismatched, no write is sent.

## Root MCP connector

Configure the released root package as the Open-Science connector command:

```text
Command: npx
Arguments: --yes github:ResearchPulse/slr_skill_open_science --mcp --profile afl-review
```

The equivalent shell command is:

```powershell
npx github:ResearchPulse/slr_skill_open_science --mcp --profile <profile-name>
```

The root `--mcp` entrypoint resolves the selected local profile and reads its protected token. When a profile is selected, its API URL is authoritative; `SLR_AGENT_TOKEN` may be supplied as an explicit host-managed override. Without a profile, direct environment values `SLR_API_BASE_URL` and `SLR_AGENT_TOKEN` are required. Optional `SLR_PROFILE_ID`, `SLR_PROJECT_ID`, `SLR_PROJECT_NAME`, and `SLR_API_ALLOWED_HOSTS` provide context and host validation. The root `--mcp` entrypoint forwards stdio to the MCP server without invoking a shell; stdout is reserved for MCP JSON-RPC and diagnostics use stderr.

## Local development run

From `mcp/slr-agent-mcp/`:

```powershell
$env:SLR_API_BASE_URL = "https://<backend-host>/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
npx slr-agent-mcp
```

The direct development package communicates over stdio and receives both values through the runtime environment. The production root connector instead loads the token from the selected local profile. In both flows, the token is sent to the backend only as an `Authorization: Bearer` header. Never place the project token in chat, prompts, the skill, source code, source control, issues, screenshots, or logs. If it is exposed, rotate it in SLR and update the profile or connector credential.

## Acceptance harness

The repository includes a deterministic harness that starts the compiled MCP over stdio and uses a local fake SLR API. It validates the real protocol boundary without touching the backend or requiring a project token:

```powershell
npm run typecheck:mcp
npm run test:harness
npm test
```

The harness checks exact four-tool discovery, bearer propagation, paginated task lookup, `202` full-text processing, declined submission with zero POSTs, digest-bound confirmation, one successful POST, and terminal `409` behavior without retry. `npm test` includes the harness through the MCP workspace test suite. `npm run pack:check` additionally validates a clean packed install; it requires npm registry/cache access for dependency installation.
