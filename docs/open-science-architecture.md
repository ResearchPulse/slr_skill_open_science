# Open-Science SLR integration architecture

## Overview

This document defines the approved architecture for distributing the SLR `/slr` skill and its local MCP connector to AIPOCH Open-Science.

The packaging experience follows the useful parts of `ResearchPulse/slr_skill_claude_science`: one `npx github:ResearchPulse/slr_skill_open_science` entrypoint, an installer, project profiles, local review drafts, and an audit trail. Node remains the npx installer/compatibility launcher; the long-lived API client and both MCP stdio servers run from Python stdlib scripts like the Claude package.

## Connector split

The package intentionally has two MCP processes with separate responsibilities:

```text
/slr review, /slr status, /slr tasks
  -> slr-agent-mcp
  -> Claude-compatible SLR screening and extraction task tools

/slr config
  -> slr-config-mcp
  -> slr_config_profiles
  -> slr_config_validate
  -> slr_config_commit
  -> slr_config_cancel
```

The config process is local-only. Interactive install can optionally collect the project token, or `/slr config token <TOKEN>` can set it later. It validates the project token, stores that same value in the encrypted host Credential associated with the target profile, and writes only local profile/connector state. Each project profile has a separate Credential so configuring one project cannot replace another project's token. A Credential is Open-Science's storage/binding mechanism, not a second token. The review process receives the token bound to its profile and the backend repository is not modified.

## Approved decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Distribution | GitHub-installable npm package with an `npx` installer | Reproduces the simple Claude-style onboarding flow |
| MCP runtime | Python 3.8+ stdlib | Matches the Claude package and avoids a long-lived Node/npm process and Windows `_npx` locks |
| MCP surface | Five bounded screening tools plus isolated extraction tools | Matches the Claude connector while keeping config tools separate |
| Host | Open-Science local connector | Open-Science manages local connectors, skills, permissions, and credentials |
| Profiles | Multi-project profiles | A user can manage multiple SLR projects without mixing tokens |
| Drafts | Local `paper-review/` workspace | Keeps draft/edit/submit workflow auditable and recoverable |
| Submission safety | One user confirmation plus an internal digest-bound MCP handshake | The skill prepares the exact payload, asks once, then performs the matching confirmed call immediately before the backend write |
| Project token | Optional hidden prompt during interactive installation; can be entered later with `/slr config token` | One project token identifies the agent/project and scopes task access; each profile stores/supplies its matching token through Open-Science Credential |

## Goals

- Install or update the skill and connector with one `npx github:ResearchPulse/slr_skill_open_science` command.
- Automatically register and enable both Open-Science local connectors when the Open-Science CLI is available. Interactive setup prompts for the project token and allows Enter to skip; `/slr config token <TOKEN>` validates and binds it later.
- Fail closed when required connector registration or credential binding is unavailable; no manual connector-import path is supported.
- Expose the five bounded screening tools plus the isolated Phase-2 extraction tools; keep configuration tools in `slr-config`.
- Support the Claude-compatible `/slr` command surface: setup, status, list/tasks, task, fulltext, review, drafts, edit, submit, auto, mcp, diag, config subcommands, and help; `doctor` remains a root CLI command.
- Preserve the project-scoped bearer-token API contract without changing backend routes.
- Keep the project token out of prompts, skill text, drafts, audit records, and normal tool results.

## Non-goals

- Adding direct-API or arbitrary-shell fallback paths.
- Replacing the existing SLR agent API or duplicating backend business logic.
- Supporting batch submission without an explicit user command and per-result safety checks.
- Requiring Python for the Node-only installer path.
- Automatically searching literature or downloading arbitrary URLs.

## Target package layout

```text
slr_skill_open_science/
├── package.json                 # npx distribution metadata and installer entrypoint
├── package-lock.json
├── bin/
│   └── install.js               # cross-platform installer and upgrade command
├── cli/
│   └── slr.js                   # config/profile/doctor/draft utilities
├── scripts/
│   ├── slr.py                    # shared Python stdlib API/profile runtime
│   ├── slr_mcp.py                # released screening/extraction MCP server
│   └── slr_config_mcp.py         # released configuration MCP server
├── mcp/                          # TypeScript transition/parity implementation
│   └── ...
├── skill/
│   └── slr/
│       ├── SKILL.md
│       └── references/
└── docs/
```

The package includes the three Python stdlib runtime scripts above. The TypeScript `mcp/` trees remain in the repository for transition and parity tests but are not required in the packed npx artifact. `paper-review/` is a runtime workspace, not a package source directory. It contains `fulltext/`, `drafts/`, `submitted/`, and `audit.jsonl` and can be placed in the current Open-Science project workspace.

## Component responsibilities

### `bin/install.js`

The installer is intentionally small and cross-platform:

1. Detect the current package directory and the Open-Science CLI.
2. Copy or update the `/slr` skill through the supported local skill/import path.
3. Create or update secret-free API/profile metadata without requesting a token.
4. Register and enable the local config connector.
5. If a project token is supplied during interactive installation or `/slr config token`, validate it, store that same token as the encrypted `SLR_AGENT_TOKEN` Credential for the review connector, and register/enable both connectors. The config connector accepts the token as a tool argument and does not bind the credential.
6. Use the selected profile when starting the root MCP launcher.

The installer must never put a raw token in command-line arguments, generated skill content, printed configuration, profile metadata, ordinary JSON files, drafts, audit records, or ordinary chat. The token may be entered only through the hidden installer prompt or explicit `/slr config token` flow. The host-managed encrypted `SLR_AGENT_TOKEN` Credential is the storage/binding for that one project token, injected into the connectors.

### `cli/slr.js`

The CLI provides the Claude-style operational layer without adding MCP tools:

- profile create/list/use/remove;
- URL and credential setup;
- connection and connector diagnostics;
- draft listing and local audit inspection;
- MCP configuration output;
- package/skill update and uninstall.

The CLI uses `open-science connector` commands. Before registration it checks the daemon and starts it with `open-science start --no-open` when needed, so the desktop window does not have to be opened manually. Initial installation enables only the config connector. After token configuration, registration is atomic across the review and config connectors; any list/add/update/enable failure stops activation of the project profile.

### MCP server

The MCP server remains a thin adapter over `/api/agent/v1`:

```text
Open-Science
  ├── /slr skill
  └── local MCP connector
       └── Python stdlib MCP server
            └── SLR /api/agent/v1
```

It does not own project selection UI, task business rules, or review criteria. The released connector process is the Python stdlib server in `scripts/`; the TypeScript tree is retained only for transition/parity tests. The root launcher resolves secret-free profile metadata and requires `SLR_AGENT_TOKEN` from the host credential binding. The MCP process sends the token only as an Authorization bearer header.

## Profile and credential model

Each profile represents one SLR project/agent connection:

```text
profile name
├── api base URL
├── optional Open-Science credential ID (required for review)
├── connector ID/name
└── credential fingerprint when configured
```

Changing the active profile must not silently change a long-running connector. The user must reconnect or restart the connector so the selected profile becomes active. The selected profile and project must be shown before review or submission.

The profile-owned runtime root must be canonicalized and protected against path traversal and symlink escapes. Draft and audit writes are atomic and scoped to the selected profile.

The raw project token is never stored in Git, the skill, review drafts, `audit.jsonl`, or MCP result text. Token rotation/disable is handled in the SLR web UI, followed by profile/credential refresh.

## Review and submission flow

```text
/slr setup
   → /slr status
   → /slr list
   → /slr review <task>
   → get_assigned_task
   → get_task_fulltext
   → local draft + evidence review
   → user reviews exact payload
   → user confirms
   → submit_review_result
   → second submit call with matching digest
   → one backend POST
   → audit record + submitted record
```

`submit_review_result` must not POST on its first call, when the user cancels, when the confirmation content is invalid, or when the digest does not match. The skill shows the exact draft and asks once before calling the tool; after the affirmative response it performs the first safe call and then automatically performs the second call when `CONFIRMATION_REQUIRED` returns. The second call is bound to a canonical digest of the exact profile, task, decision, reasoning, and data payload. A 409 result is terminal and must not be retried.

## Tool contract

The public MCP tool names are:

1. `list_assigned_tasks`
2. `connection_test`
3. `get_assigned_task`
4. `get_task_fulltext`
5. `submit_review_result`
6. `get_extraction_context`
7. `get_extraction_fulltext`
8. `save_extraction_draft`
9. `check_extraction_draft`
10. `submit_extraction_draft`
11. `finalize_extraction_consensus`

`submit_extraction_draft` writes only an isolated pending proposal after one user confirmation and a backend challenge/idempotency check. `finalize_extraction_consensus` is named for compatibility but creates or updates a leader-scoped consensus proposal; human promotion/finalization remains separate. Extraction tasks require explicit `taskKind: "extraction"`; task-kind migration is an explicit backend operation, not an implicit read fallback. Both reviewer and leader proposals are checked against template/source/version bindings before acceptance. `/slr status`, `doctor`, profile management, and audit inspection are CLI/skill behavior, not additional MCP tools.

## Alternatives considered

### Exact Claude implementation

Python stdlib CLI/MCP, its own profile/token store, and the legacy MCP tool set.

Rejected as the primary runtime because it would diverge from the Claude package and keep npm/Node in every long-lived connector process. The TypeScript implementation remains only for transition and parity tests.

### Minimal current implementation

Only a TypeScript MCP package plus a static skill and Open-Science-managed connector setup.

Rejected because it lacks the one-command installer, profiles, local drafts, audit trail, and operational diagnostics the user wants.

### Approved hybrid

Claude-style installer/CLI/profile/draft experience, Node-only npx installation, Python stdlib screening/extraction/config MCP tools, and Open-Science-native connector/credential integration when available.

Chosen because it preserves the desired user experience while matching the target host and existing codebase.

## Acceptance criteria

- `npx github:ResearchPulse/slr_skill_open_science` installs or updates the skill and produces a usable connector configuration.
- A registered connector starts the bundled Python runtime and discovers bounded screening and extraction tools.
- `/slr status` works through `list_assigned_tasks`.
- Profile switching never mixes project tokens and visibly identifies the active project.
- Drafts can be reviewed/edited locally and audit records contain no raw token.
- Cancelled user confirmation causes no write.
- Missing or mismatched second digest call causes no write.
- Accepted confirmation produces exactly one POST.
- A duplicate submission is surfaced as terminal 409 and is not retried.
- The packed artifact can be installed and launched outside the backend repository.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Open-Science CLI changes | Automatic registration or daemon startup breaks | Fail closed with a deterministic reason and require a compatible CLI/daemon |
| Native credential API unavailable | Host registration cannot bind the token | Fail closed; do not write or print a local token fallback |
| Profile changes while connector is running | Wrong project token | Require reconnect/restart and show active profile/project |
| Host does not support MCP elicitation | Interactive connector prompt unavailable | Use the skill-managed staging + digest call; never silently bypass the digest check |
| GitHub `npx` package lacks built artifacts | Installer starts but MCP fails | Prepack compile, tarball smoke test, and release checklist |
| Mutable GitHub ref or compromised release path | Installer executes untrusted code | Use immutable production tags/commits, lockfiles, revision display, and artifact verification |

## References

- [Open-Science connector and credentials guide](https://aipoch.com/docs/guides/connectors/)
- [Open-Science CLI and structured output](https://aipoch.com/docs/reference/cli/)
- [Open-Science skills guide](https://aipoch.com/docs/settings/skills/)
- [ResearchPulse Claude SLR package](https://github.com/ResearchPulse/slr_skill_claude_science)
- [MCP TypeScript server SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/README.md)

## Implementation status

The two-connector implementation, skill migration, safety tests, and tarball smoke checks are part of this repository. The backend remains outside the change scope.
