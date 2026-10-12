# SLR Open-Science integration

This folder contains the Open-Science integration for the SLR project. It is intentionally kept outside the backend repository.

## Install the root package

Use the GitHub package reference for setup and connector configuration:

```powershell
npx github:ResearchPulse/slr_skill_open_science
```

## Fast setup (default)

Strict setup contract: the project token is held only in the encrypted Open-Science Credential `SLR_AGENT_TOKEN`; setup succeeds only after both `slr-default` and `slr-config` are registered and enabled. There is no local token file or manual connector-import fallback.

Current connector model: setup prepares two local MCP connectors. The review connector is used for the five Claude-compatible SLR task tools; the separate `slr-config` connector is used only by `/slr config` and reads `SLR_AGENT_TOKEN` from an encrypted Open-Science Credential binding. When the Open-Science CLI is available, setup creates or updates the `SLR_AGENT_TOKEN` Credential and binds it to both connectors automatically. Setup also stages a dependency-complete runtime under `~/.slr/runtimes/<fingerprint>` and registers a direct Node launcher, so a long-running connector never re-runs `npx` against a locked `_npx` cache on Windows.

Running the command with no subcommand starts the Claude-style interactive setup. It detects the runtime, copies `/slr`, uses the production API URL by default, asks only for the hidden project token, stores only secret-free profile metadata plus a token fingerprint, tests the API, creates or updates the encrypted `SLR_AGENT_TOKEN` Credential, and creates or updates then enables both Open-Science connectors. When the Open-Science CLI is installed but its daemon is stopped, setup starts it with `open-science start --no-open` and waits briefly for readiness; the desktop window does not need to be opened manually. On Windows it also checks common per-user install locations and the optional `OPEN_SCIENCE_CLI` path when the CLI is not on `PATH`. Human output is intentionally concise; use `--json` for the full report. Use `--api-base-url` only when targeting another server.

The token is held only by the encrypted Open-Science Credential named `SLR_AGENT_TOKEN`. It is never printed, placed in profile metadata or connector JSON, or sent to chat. Use `--json` for a non-interactive report; it never prompts for credentials. Setup fails closed if Open-Science registration or credential binding fails. After setup, open a new Open-Science conversation and run `/slr setup` for the read-only check.

The root package provides the `slr` installer. `setup` performs the interactive setup described above: it can create/update secret-free profile metadata, bind the host credential, test the API, and register and enable both connectors. It never prints the project token. Add `--json` for machine-readable, non-interactive output:

```powershell
npx github:ResearchPulse/slr_skill_open_science --json
```

`setup` also copies the managed skill directory to `~/.agents/skills/slr`. In Open-Science, import that installed directory from Settings → Skills → Import installed skills, then enable `/slr`. Use `--skill-dir PATH` to choose another local import directory. If an unmanaged skill already exists at the target, the command stops instead of overwriting it.

After the skill is enabled, `/slr setup` is the quick in-chat setup check. It calls the bounded read-only `connection_test`, reports the connected project and assigned-task state, or shows only the missing connector settings. It never asks for the project token in chat and cannot modify Open-Science connector settings.

Use `/slr config` for the profile-first wizard. For the quick path, use `/slr config token <TOKEN>`: the config connector validates the supplied token, automatically binds the encrypted `SLR_AGENT_TOKEN` credential, chooses switch/update/save from the project match, updates the secret-free profile, and enables both connectors. The token is never echoed, returned, or written to profile metadata or connector JSON. After success, run `/slr status`.

This in-chat flow requires the separate `slr-config` connector. If it is unavailable or its credential is missing, `/slr config` must report the missing capability, ask the user to reconnect/start a new conversation, and must not claim that the profile or connector changed.

The staged operation is kept in memory inside the config-MCP process, expires after ten minutes, and is committed only after both connectors are enabled.

There is no terminal/manual fallback for the explicit in-chat token path. Profile changes are available through the connected `slr-config` MCP connector; a missing or disconnected connector is a hard failure. The pending operation expires after ten minutes and failed validation does not modify the selected profile.

Use `doctor` to inspect packaged assets and Open-Science CLI availability:

```powershell
npx github:ResearchPulse/slr_skill_open_science doctor
```

`doctor` prints a JSON report and exits non-zero when a packaged asset is missing. An unavailable `open-science` CLI is reported in the result; it is not itself a package-asset failure. `doctor` and `setup --json` never prompt for credentials or print the project token.

Create a profile and workspace without putting the token in the shell:

```powershell
npx github:ResearchPulse/slr_skill_open_science profile create `
  --name afl-review `
  --api-base-url https://slr-api.hyperdatalab.org/api `
  --project-id <project-id> `
  --project-name "AFL review" `
  --credential-id <open-science-credential-id>
npx github:ResearchPulse/slr_skill_open_science workspace init --profile afl-review
```

Register both connectors:

```powershell
npx github:ResearchPulse/slr_skill_open_science setup --profile afl-review --register
```

Setup uses the local Open-Science CLI, starts its daemon if needed, binds `SLR_AGENT_TOKEN`, and enables both connectors. If any required capability is unavailable, setup exits non-zero and reports the reason; there is no manual connector import path. Set `OPEN_SCIENCE_CLI` to an absolute CLI path if Open-Science uses a non-standard install location.

## Contents

- `mcp/slr-config-mcp/` — separate local configuration MCP server with five narrowly scoped `slr_config_*` tools.
- `mcp/slr-agent-mcp/` — local TypeScript MCP server, exposing the five Claude-compatible review tools:
  - `list_assigned_tasks`
  - `connection_test`
  - `get_assigned_task`
  - `get_task_fulltext`
  - `submit_review_result`
- `skill/slr/` — `/slr` skill instructions for Open-Science task discovery, review drafting, and confirmation-gated submission.
- `docs/SLR_MCP_OPEN_SCIENCE_SETUP.md` — setup and troubleshooting guide.

Submission has one user-facing confirmation. `/slr review` shows the exact draft and asks for `confirm` or `cancel` once. On `confirm`, it calls `submit_review_result`; if that safe first call returns a matching payload digest, the skill automatically calls the same tool with `confirmation: { confirm: true, digest }` immediately before the single backend POST. If the user cancels, the host lacks the confirmation path, or the digest mismatches, no write is sent.

## Root MCP connector

Setup registers the released package as a direct Node connector. The generated configuration is equivalent to:

```text
Command: <Node executable>
Arguments: <managed runtime>/bin/install.js --mcp --profile afl-review
```

The one-time package installation remains:

```powershell
npx github:ResearchPulse/slr_skill_open_science
```

The managed `install.js --mcp` entrypoint resolves the selected secret-free profile and requires the host credential binding `SLR_AGENT_TOKEN` in its environment. The profile API URL is authoritative. The root `--mcp` entrypoint forwards stdio to the MCP server without invoking a shell; stdout is reserved for MCP JSON-RPC and diagnostics use stderr.

## Config MCP connector

Use the separate managed connector for `/slr config`:

```text
Command: <Node executable>
Arguments: <managed runtime>/bin/install.js --config-mcp
Credential binding: SLR_AGENT_TOKEN
```

It exposes `slr_config_profiles`, `slr_config_validate`, `slr_config_token`, `slr_config_commit`, and `slr_config_cancel`. Only `slr_config_token` accepts a raw token, and only for the explicit `/slr config token <TOKEN>` flow; it validates and binds the token immediately and never returns it. Setup must register and enable the connector automatically; if it is unavailable, the command stops with `CONFIG_CONNECTOR_UNAVAILABLE` and does not claim a configuration change.

## Local development run

From `mcp/slr-agent-mcp/`:

```powershell
$env:SLR_API_BASE_URL = "https://slr-api.hyperdatalab.org/api"
$env:SLR_AGENT_TOKEN = "<project-token>"
npx slr-agent-mcp
```

The direct development package communicates over stdio and receives both values through the runtime environment. The production root connector receives the token from the host credential binding and profile metadata supplies the API URL. In both flows, the token is sent to the backend only as an `Authorization: Bearer` header. Never place the project token in chat, prompts, the skill, source code, source control, issues, screenshots, or logs. If it is exposed, rotate it in SLR and update the connector credential.

## Acceptance harness

The repository includes a deterministic harness that starts the compiled MCP over stdio and uses a local fake SLR API. It validates the real protocol boundary without touching the backend or requiring a project token:

```powershell
npm run typecheck:mcp
npm run test:harness
npm test
```

The harness checks five-tool discovery including the bounded `connection_test`, bearer propagation, paginated task lookup, `202` full-text processing, declined submission with zero POSTs, digest-bound confirmation, one successful POST, and terminal `409` behavior without retry. `npm test` includes the harness through the MCP workspace test suite. `npm run pack:check` additionally validates a clean packed install; it requires npm registry/cache access for dependency installation.

## Claude-compatible command surface

The package has one canonical `/slr` skill, with the same command vocabulary as
`slr_skill_claude_science`.

`/slr list` is an alias for `/slr tasks`. Draft workflows support
`/slr review [N|ids]`, `/slr drafts`, `/slr edit <taskId> <instruction>`,
`/slr submit [ids]`, and explicit `/slr auto [N]`. Operational commands
`/slr mcp`, `/slr diag`, and `/slr config show|url|use|test|remove` use safe
MCP/profile metadata only. Submission always uses the existing one-prompt
confirmation plus internal digest handshake; no command bypasses it.

The package CLI also accepts `install` as a setup alias, exposes `mcp` for safe
connector metadata, `doctor` for diagnostics, and `uninstall --yes` for removing
only the managed skill. Profiles, encrypted credentials, and registered
connectors are preserved by uninstall so a reinstall can reuse them.
