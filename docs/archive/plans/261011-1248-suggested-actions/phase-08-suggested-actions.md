# Phase 08 — Suggested next actions

## Objective

Make the `/slr` skill guide users through the next safe action after each command without adding MCP tools or changing the SLR backend.

## Requirements

- Show a concise `Suggested next actions` section after setup, status, task list, task details, full-text retrieval, and review drafts.
- When full text is unavailable or still processing, suggest uploading/waiting and do not suggest reviewing invented content.
- When full text is available, suggest the matching review command.
- Preserve the existing two-call digest handshake while reducing it to one user-facing `confirm`/`cancel` prompt before `submit_review_result`.
- Keep the exact four-tool MCP contract unchanged.

## Touchpoints

- `skill/slr/SKILL.md`
- `skill/slr/references/commands.md`
- `skill/slr/references/error-handling.md`
- `docs/SLR_MCP_OPEN_SCIENCE_SETUP.md`
- `tests/skill-guidance.test.mjs`

## Acceptance criteria

- The skill explicitly defines next actions for the normal and blocked full-text paths.
- The task list response points to `/slr task <taskId>` and does not imply full text is available.
- The review response points to `confirm`/`cancel` only after the exact draft is shown.
- Automated tests assert all guidance phrases and existing MCP/CLI tests remain green.
