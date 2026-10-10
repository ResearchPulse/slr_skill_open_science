---
title: "Open-Science SLR MVP status"
type: progress-report
date: 2026-10-10
status: in-progress
---

# Open-Science SLR MVP status

## Achievements

- Standalone `npx` package with Node/TypeScript local MCP runtime.
- Exactly four MCP tools preserved: task list, task detail, full text, and review submission.
- `/slr` skill now covers setup, status, list/tasks, review, drafts, config, and two-step confirmation.
- Multi-project profiles use metadata-only storage; profile recreation receives a fresh workspace.
- Local `paper-review/` workspace includes fulltext, drafts, submitted receipts, and bounded audit JSONL.
- Managed skill installation copies to `~/.agents/skills/slr` or an explicit `--skill-dir` without overwriting unmanaged content.
- Symlink/junction escapes, unsafe API URLs, oversized responses, token echo, stale confirmation digests, and missing elicitation capability are fail-closed.

## Verification

| Check | Result |
|---|---|
| CLI/workspace tests | 6 passed |
| MCP tests | 23 passed |
| TypeScript typecheck | Passed |
| Installer help/doctor | Passed; Open-Science CLI not installed in this environment |
| npm pack dry-run | Passed; 53 files, no workspace/token artifacts |
| Clean install smoke | Incomplete; `npm install` stalled in current registry/cache environment after compile passed |

## Remaining gates

- Run clean-install smoke on a network-enabled machine or a warm npm cache.
- Run manual Open-Science connector registration/test with a non-production project credential.
- Add packed-install end-to-end duplicate-conflict/interruption coverage.
- Decide whether to add explicit submit-attempt/confirmation audit events beyond current draft/submitted records.
- Pin and verify an immutable release commit/tag before publishing the GitHub `npx` reference.

## User handoff

1. In SLR web: connect **ChatGPT — Open-Science**, generate the project token, assign a paper.
2. In a terminal: run `npx --yes github:ResearchPulse/slr_skill_open_science#v0.1.0 setup`.
3. Import the copied skill from Open-Science **Settings → Skills → Import installed skills**.
4. Create a profile/workspace, bind the Open-Science token credential to `SLR_AGENT_TOKEN`, and import/register the generated connector.
5. In Open-Science: run `/slr status`, then `/slr list`, then `/slr review <taskId>`.
