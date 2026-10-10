# Open-Science SLR integration architecture

## Overview

This document defines the approved architecture for distributing the SLR `/slr` skill and its local MCP connector to AIPOCH Open-Science.

The packaging experience follows the useful parts of `ResearchPulse/slr_skill_claude_science`: one `npx github:ResearchPulse/slr_skill_open_science` entrypoint, an installer, project profiles, local review drafts, and an audit trail. The runtime remains Node.js/TypeScript because the backend and current MCP implementation already use that stack.

## Approved decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Distribution | GitHub-installable npm package with an `npx` installer | Reproduces the simple Claude-style onboarding flow |
| MCP runtime | Node.js + TypeScript | Matches the backend, Windows environment, and validated MCP SDK implementation |
| MCP surface | Exactly four tools | Preserves the API contract and avoids accidental extra capabilities |
| Host | Open-Science local connector | Open-Science manages local connectors, skills, permissions, and credentials |
| Profiles | Multi-project profiles | A user can manage multiple SLR projects without mixing tokens |
| Drafts | Local `paper-review/` workspace | Keeps draft/edit/submit workflow auditable and recoverable |
| Submission safety | Skill confirmation plus MCP elicitation | The user must approve the draft and then confirm immediately before the backend write |
| Credential priority | Open-Science credential binding first; protected local fallback only when unavailable | Avoids duplicating secret storage when the host can securely manage it |

## Goals

- Install or update the skill and connector with one `npx github:ResearchPulse/slr_skill_open_science` command.
- Automatically register an Open-Science local connector when the Open-Science CLI is available.
- Print an importable connector configuration when automatic registration is unavailable.
- Expose only `list_assigned_tasks`, `get_assigned_task`, `get_task_fulltext`, and `submit_review_result`.
- Support `/slr setup`, `/slr status`, `/slr list`, `/slr review`, `/slr drafts`, `/slr edit`, `/slr submit`, `/slr config`, `/slr doctor`, and `/slr help`.
- Preserve the project-scoped bearer-token API contract without changing backend routes.
- Keep the project token out of prompts, skill text, drafts, audit records, and normal tool results.

## Non-goals

- Adding a fifth MCP `connection_test` tool.
- Replacing the existing SLR agent API or duplicating backend business logic.
- Supporting batch submission without an explicit user command and per-result safety checks.
- Requiring Python for installation or runtime.
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
├── mcp/
│   └── slr-agent-mcp/
│       ├── src/                  # TypeScript MCP implementation
│       ├── tests/
│       └── out/                  # release artifact produced before packing
├── skill/
│   └── slr/
│       ├── SKILL.md
│       └── references/
└── docs/
```

`paper-review/` is a runtime workspace, not a package source directory. It contains `fulltext/`, `drafts/`, `submitted/`, and `audit.jsonl` and can be placed in the current Open-Science project workspace.

## Component responsibilities

### `bin/install.js`

The installer is intentionally small and cross-platform:

1. Detect the current package directory and the Open-Science CLI.
2. Copy or update the `/slr` skill through the supported local skill/import path.
3. Create or update a project profile without echoing the raw token.
4. Prefer Open-Science credential storage and connector registration.
5. Generate a credential-reference connector configuration for manual import; never serialize the raw token into that file.
6. Run a read-only doctor/connection check when credentials are available.

The installer must never put a raw token in command-line arguments, generated skill content, printed configuration, or ordinary JSON files. When a host-native credential binding is not available, use an OS-backed secure store. If no secure store exists, use a one-session environment binding/manual import and fail closed rather than persist the token.

### `cli/slr.js`

The CLI provides the Claude-style operational layer without adding MCP tools:

- profile create/list/use/remove;
- URL and credential setup;
- connection and connector diagnostics;
- draft listing and local audit inspection;
- MCP configuration output;
- package/skill update and uninstall.

The CLI can use `open-science connector` and `open-science credential` commands when available. Otherwise it maintains only protected local profile metadata and asks the user to import a credential-reference connector configuration. It must not create an ordinary local token JSON file.

### MCP server

The MCP server remains a thin adapter over `/api/agent/v1`:

```text
Open-Science
  ├── /slr skill
  └── local MCP connector
       └── TypeScript MCP server
            └── SLR /api/agent/v1
```

It does not own project selection UI, task business rules, or review criteria. It receives the active project URL/token from the connector environment and sends the token only as an Authorization bearer header.

## Profile and credential model

Each profile represents one SLR project/agent connection:

```text
profile name
├── api base URL
├── Open-Science credential ID (preferred)
├── connector ID/name
└── masked token metadata only
```

Changing the active profile must not silently change a long-running connector. The installer either updates/restarts the connector or produces a new connector entry for the selected profile. The selected profile and project must be shown before review or submission.

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
   → MCP elicitation confirmation
   → one backend POST
   → audit record + submitted record
```

`submit_review_result` must not POST when the user cancels, the host declines elicitation, the confirmation content is invalid, or the connector lacks elicitation capability. The elicitation confirmation is bound to a canonical digest of the exact profile, task, decision, reasoning, and data payload. A 409 result is terminal and must not be retried.

## Tool contract

The public MCP tool names remain:

1. `list_assigned_tasks`
2. `get_assigned_task`
3. `get_task_fulltext`
4. `submit_review_result`

`/slr status`, `doctor`, profile management, and audit inspection are CLI/skill behavior, not additional MCP tools. This keeps the connector compatible with the existing API contract and prevents tool sprawl.

## Alternatives considered

### Exact Claude implementation

Python stdlib CLI/MCP, its own profile/token store, and five MCP tools.

Rejected because it introduces Python as a required runtime, duplicates Open-Science credential management, and violates the exact-four-tools requirement.

### Minimal current implementation

Only a TypeScript MCP package plus a static skill and manual connector setup.

Rejected because it lacks the one-command installer, profiles, local drafts, audit trail, and operational diagnostics the user wants.

### Approved hybrid

Claude-style installer/CLI/profile/draft experience, Node/TypeScript runtime, four MCP tools, and Open-Science-native connector/credential integration when available.

Chosen because it preserves the desired user experience while matching the target host and existing codebase.

## Acceptance criteria

- `npx github:ResearchPulse/slr_skill_open_science` installs or updates the skill and produces a usable connector configuration.
- A registered connector starts without Python and discovers exactly four tools.
- `/slr status` works through `list_assigned_tasks`.
- Profile switching never mixes project tokens and visibly identifies the active project.
- Drafts can be reviewed/edited locally and audit records contain no raw token.
- Declined first confirmation causes no write.
- Declined MCP elicitation causes no write.
- Accepted confirmation produces exactly one POST.
- A duplicate submission is surfaced as terminal 409 and is not retried.
- The packed artifact can be installed and launched outside the backend repository.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Open-Science CLI changes | Automatic registration breaks | Keep generated JSON import fallback and version-check CLI capabilities |
| Native credential API unavailable | Token setup becomes manual | OS-backed secure store; otherwise session-only binding and fail-closed persistence |
| Profile changes while connector is running | Wrong project token | Require reconnect/restart and show active profile/project |
| Host does not support MCP elicitation | Unsafe write path | Refuse to submit; do not silently downgrade to one confirmation |
| GitHub `npx` package lacks built artifacts | Installer starts but MCP fails | Prepack compile, tarball smoke test, and release checklist |
| Mutable GitHub ref or compromised release path | Installer executes untrusted code | Use immutable production tags/commits, lockfiles, revision display, and artifact verification |

## References

- [Open-Science connector and credentials guide](https://aipoch.com/docs/guides/connectors/)
- [Open-Science CLI and structured output](https://aipoch.com/docs/reference/cli/)
- [Open-Science skills guide](https://aipoch.com/docs/settings/skills/)
- [ResearchPulse Claude SLR package](https://github.com/ResearchPulse/slr_skill_claude_science)
- [MCP TypeScript server SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/README.md)

## Next step

Create an implementation plan from this design. The plan should be split into package foundation, installer/CLI, Open-Science connector integration, skill migration, safety tests, and tarball/manual acceptance.
