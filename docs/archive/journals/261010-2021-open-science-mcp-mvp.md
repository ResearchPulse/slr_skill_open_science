---
date: 2026-10-10
session: open-science-mcp-mvp
status: in-progress
---

# Journal: 2026-10-10 — Open-Science MCP MVP

## Context

Implemented the first usable Open-Science SLR integration as a standalone package, keeping credentials in the connector/runtime boundary and limiting the MCP write surface.

## What Happened

- Exposed exactly four MCP tools: `list_assigned_tasks`, `get_assigned_task`, `get_task_fulltext`, and `submit_review_result`.
- Added metadata-only profiles with isolated, fresh `paper-review/` workspaces for full text, drafts, submitted receipts, and bounded audit JSONL.
- Added managed `/slr` skill installation under `~/.agents/skills/slr` (or `--skill-dir`), refusing to overwrite an unmanaged target.
- Added confirmation digests: canonical profile/project/task and review payload fields are SHA-256 hashed; submission requires the displayed digest to match immediately before POST.
- Hardened boundaries with token redaction, safe confirmation display, URL validation, bounded review data, traversal/symlink/junction rejection, atomic workspace writes, and no-secret profile storage.

## Reflection

The MVP now has a coherent read-heavy workflow with an explicit, user-confirmed write path. Validation is strong for the checked-in implementation, but clean-install behavior remains environment-dependent.

## Decisions Made

| Decision | Rationale | Impact |
|---|---|---|
| Store profile metadata, not tokens | Keep project credentials in Open-Science bindings | Connector setup remains responsible for secret handling |
| Bind confirmation to a digest | Prevent approving one review payload and submitting another | Stale or mismatched confirmations fail closed |
| Treat local audit files as bounded convenience records | Backend state remains authoritative | Local logs support resume/debugging without becoming compliance evidence |

## Verification

- CLI/workspace tests: 6 passed.
- MCP tests: 23 passed; TypeScript typecheck passed.
- `npm pack` dry-run: passed, 53 files with no workspace or token artifacts.
- Clean-install smoke: incomplete; `npm install` stalled in the current registry/cache environment after compilation passed.

## Next Steps / Unresolved Questions

- Re-run clean-install smoke on a network-enabled machine or warm npm cache.
- Complete manual connector registration and non-production submission validation.
- Decide whether explicit submit-attempt/confirmation audit events are needed beyond draft/submitted records.
