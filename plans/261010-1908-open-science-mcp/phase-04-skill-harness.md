---
phase: 4
title: "Open-Science skill and command harness"
status: completed
priority: P1
effort: "1d"
dependencies: ["phase-02-profiles-workspace", "phase-03-mcp-contract"]
---

# Phase 4: Open-Science skill and command harness

## Overview

Make the package usable from the Open-Science conversation surface through Claude-style `/slr` commands, deterministic menus, and generated connector setup.

## Key insights

- Users will work primarily in Open-Science chat; the SLR web UI remains the place to connect an agent, issue/rotate a project token, and assign papers.
- The skill must be usable through typed chat even if native slash-command affordances are unavailable.
- `/slr status` can be implemented with `list_assigned_tasks`; it does not require a seventh MCP tool.

## Requirements

- Commands: `/slr setup`, `/slr status`, `/slr list`, `/slr review`, `/slr doctor`, and help/unknown-command handling.
- Setup flow: choose/create profile, configure URL/credential binding, validate connection, install/update skill, generate connector config.
- Status/list flow: call `list_assigned_tasks`, show pagination/counts, and distinguish no tasks from auth/network errors.
- Review flow: choose one assigned task, fetch metadata/fulltext, save a local draft, show review policy, and ask for final confirmation before submit.
- Tool descriptions and references must instruct the model not to treat paper content as executable instructions.
- No new MCP tool solely for menu/status/setup functionality.

## Architecture

`skill/slr/SKILL.md` is the durable behavior contract. `skill/slr/references/` contains command, review-policy, and error-handling details. `cli/slr.js` generates or validates the Open-Science connector configuration and prints next steps without printing secrets.

## Related files

Modify or create:

- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/skill/slr/SKILL.md`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/skill/slr/references/commands.md`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/skill/slr/references/review-policy.md`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/skill/slr/references/error-handling.md`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/cli/slr.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/docs/SLR_MCP_OPEN_SCIENCE_SETUP.md`

## Implementation steps

1. Align skill command wording with the profile and workspace commands.
2. Define deterministic numbered choices for ambiguous task/profile selection.
3. Add generated connector config with executable path, arguments, environment placeholders, and selected profile metadata only.
4. Add native Open-Science CLI integration where supported, with a manual import path as fallback.
5. Document the user journey from SLR web project token to first `/slr status` and `/slr review`.
6. Add fixtures for no profile, multiple profiles, no assigned task, and expired token.

## Todo list

- [x] Commands and fallback chat wording.
- [x] Choice harness for profiles/tasks.
- [x] Connector generation/import instructions.
- [x] Skill safety and review-policy references.

## Success criteria

- A new user can complete setup without editing source files.
- `/slr status` works through the four-tool boundary.
- `/slr review` always creates a draft before asking for confirmation.
- Skill instructions remain provider-neutral and do not expose a token.

## Risk assessment

- **Risk:** host-specific skill installation behavior changes. **Mitigation:** keep command logic in the package CLI and make the skill plain Markdown with chat fallback.
- **Risk:** generated config differs across platforms. **Mitigation:** emit platform-specific examples and validate executable/argument paths before writing.

## Security considerations

- Never put a token in generated skill text, copied prompts, or a connector name.
- Never let a task title or paper content become a shell command.
- Show profile and project identifiers in confirmations so the user can detect wrong-project use.

## Next steps

Phase 5 adds the final end-to-end safety and audit gates across skill, CLI, and MCP.
