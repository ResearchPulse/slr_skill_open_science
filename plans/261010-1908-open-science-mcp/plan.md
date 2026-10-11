---
title: "Complete Claude-style Open-Science SLR setup"
description: "Add Claude-style interactive URL/token setup and profile-backed MCP launch while preserving the four-tool Open-Science contract."
status: in-progress
priority: P1
effort: 6d
branch: main
tags: [feature, mcp, skill, open-science, api, auth, security]
blockedBy: []
blocks: []
created: 2026-10-10
updated: 2026-10-11
---

# Build Claude-style Open-Science SLR package

## Overview

Turn the existing local MCP prototype into a standalone sibling package that can be installed with `npx github:ResearchPulse/slr_skill_open_science`. The package follows the useful separation from `ResearchPulse/slr_skill_claude_science`: an installer, `/slr` skill, local profile/configuration layer, review workspace, and a thin MCP adapter.

The backend remains the source of truth. The package must expose exactly these four MCP tools:

1. `list_assigned_tasks`
2. `get_assigned_task`
3. `get_task_fulltext`
4. `submit_review_result`

`submit_review_result` is write-capable and requires both the skill-level final confirmation and a second digest-bound confirmation call immediately before the POST. The handshake does not depend on host MCP elicitation support.

## Design reference

- [Approved architecture](../../docs/open-science-architecture.md)
- [API contract in backend](../../../slr-be/docs/AI_AGENT_TASK_API_CONTRACT.md)
- [Claude-style comparison](../../docs/CLAUDE_MCP_COMPARISON.md)
- [Claude-style local setup ADR](../../docs/decisions/261011-claude-style-local-setup.md)
- Supersedes `slr-be/plans/20261010-slr-open-science-mcp/plan.md`.

## Phases

| Phase | Name | Status | Depends on |
|---|---|---|---|
| 1 | [Package and installer foundation](./phase-01-package-installer.md) | Completed | Design doc |
| 2 | [Profiles, credentials, and local review workspace](./phase-02-profiles-workspace.md) | Completed | Phase 1 |
| 3 | [MCP adapter and four-tool contract](./phase-03-mcp-contract.md) | Completed | Phase 1 |
| 4 | [Open-Science skill and command harness](./phase-04-skill-harness.md) | Completed | Phases 2–3 |
| 5 | [Confirmation, audit, and security hardening](./phase-05-safety-audit.md) | In Progress | Phases 2–4 |
| 6 | [Release and clean-machine validation](./phase-06-release-validation.md) | In Progress | Phases 1–5 |
| 7 | [Claude-style interactive setup and profile-backed launch](./phase-07-claude-style-setup.md) | In Progress | Phases 2–5 |

## Additional phase

Phase 7 extends the completed profile/skill foundation with the approved
Claude-style local setup and profile-backed MCP launcher:

- [Claude-style interactive setup and profile-backed launch](./phase-07-claude-style-setup.md)

Phase 6 release validation is not complete until Phase 7 passes its setup,
redaction, profile-isolation, and stdio gates.

## Architecture decisions

- Keep Node/TypeScript. JavaScript files are only package entry points where a direct `npx` launcher is useful; do not introduce a Python runtime.
- Keep the MCP adapter thin. Do not copy backend task/review business logic into the package.
- Use the Claude-style local profile flow: prompt for the URL and hidden token in the terminal, test the profile, and persist the token only in the protected local profile store.
- Never write raw tokens to Git, generated MCP JSON, prompts, tool results, drafts, audit entries, command arguments, or logs. Open-Science native credentials remain an optional interoperability path, not a prerequisite for the default setup.
- Make the MCP launcher profile-aware. It loads one selected profile before starting the compiled server; profile changes require reconnect/restart.
- Use one active profile per MCP process. Switching profiles requires reconnect/restart so tokens cannot cross project boundaries.
- Keep `paper-review/` as runtime state outside package source, with `fulltext/`, `drafts/`, `submitted/`, and `audit.jsonl`.
- Preserve backend semantics: project-scoped bearer auth, pagination, `202` plus `Retry-After`, terminal `409`, and error redaction.
- Keep the root package command unqualified and interactive by default: `npx github:ResearchPulse/slr_skill_open_science` runs setup; `--mcp` remains non-interactive and stdio-safe.

## Dependencies

- Existing SLR backend routes and API contract.
- Node.js 20+ and npm/npx.
- Open-Science CLI/skill/connector behavior documented at [aipoch.com/docs](https://aipoch.com/docs/).
- MCP TypeScript SDK stdio server and host-independent confirmation handshake.

## Success criteria

- A clean machine can install the package with the documented `npx github:ResearchPulse/slr_skill_open_science` command.
- Running that command without arguments performs the seven-step setup: runtime check, skill copy, URL/token prompt, local profile save, read-only API test, connector registration/fallback config, and `/slr setup` handoff.
- Open-Science can discover the `/slr` skill and connect one generated local MCP configuration.
- The MCP client discovers exactly four tools, with no helper tools exposed.
- `/slr setup`, `/slr status`, `/slr list`, and `/slr review` have deterministic behavior; root `slr doctor` reports package readiness.
- A review draft is saved locally before submission; no write request occurs before both confirmations.
- Profile separation, token redaction, retries, duplicate submission handling, package packing, and clean-machine install are verified.

## Out of scope

- Changes to the backend API contract or SLR web UI.
- Python implementation, remote/public MCP hosting, OAuth, or ChatGPT cloud deployment. Node is the supported runtime for this package; Python auto-discovery belongs to the separate Claude package.
- Automatic literature search, OCR, citation management, batch submission, or autonomous final submission.

## Handoff

Security red-team results are recorded in [security-red-team.md](./reports/security-red-team.md). Resolve H-01/H-02 and add tests or explicit accepted-risk decisions for M-01–M-05 before release. Then implement with the cook workflow from Phase 1 through Phase 6.
