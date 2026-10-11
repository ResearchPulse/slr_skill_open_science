---
phase: 2
title: "Profiles, credentials, and local review workspace"
status: completed
priority: P1
effort: "1d"
dependencies: ["phase-01-package-installer"]
---

# Phase 2: Profiles, credentials, and local review workspace

## Overview

Implement the Claude-style local operating model for multiple SLR projects while keeping raw tokens in a separate protected local profile store and retaining optional Open-Science credential interoperability.

## Key insights

- The project token is issued by the SLR web system after connecting the agent and assigning scope to that project.
- A profile must identify the backend URL and the credential/connector binding, not duplicate raw token material in several files.
- Local review artifacts make drafts auditable and allow a user to resume safely after an interrupted session.

## Requirements

- Profile commands: create, list, use, inspect masked metadata, remove, and doctor.
- Profile metadata includes backend URL, project label/id if available, credential id, connector id, and masked token state.
- Native Open-Science credential storage/binding is preferred; protected local fallback is explicit and documented.
- The default quick setup stores the raw token only in the profile token directory under `SLR_CONFIG_DIR` (default `~/.slr`), outside profile metadata; the generated connector remains secret-free.
- Runtime layout: `paper-review/fulltext/`, `paper-review/drafts/`, `paper-review/submitted/`, `paper-review/audit.jsonl`.
- Atomic exclusive writes, profile-owned roots, path canonicalization, symlink-escape rejection, and restrictive permissions where the platform supports them.
- Profile selection cannot silently change an already-running MCP process.

## Architecture

The CLI owns profile lifecycle and workspace paths. The MCP process receives one resolved active profile through environment/configuration at startup. The MCP process never edits the profile store. Draft and audit writers use redacted metadata and stable task identifiers.

## Related files

Create or modify:

- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/cli/slr.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/cli/profile-store.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/cli/workspace.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/docs/SLR_MCP_OPEN_SCIENCE_SETUP.md`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/.gitignore`

## Implementation steps

1. Define the profile schema and version it for future migration.
2. Implement native credential/connector binding detection and a protected fallback path.
3. Implement profile selection and active-profile diagnostics with masked output.
4. Implement workspace initialization, draft naming, submitted-record naming, and append-only audit records.
5. Add profile mismatch detection to generated MCP configuration and skill instructions.
6. Document how to rotate/disable a project token in the SLR web system and reconnect locally.
7. Add tests for secure-store absence, path traversal, symlink escape, concurrent writes, and partial-write recovery.

## Todo list

- [x] Profile schema and migration marker.
- [x] Native Open-Science credential-reference path and manual import fallback.
- [x] Multi-project isolation tests.
- [x] Runtime workspace and audit format.

## Success criteria

- Two profiles can coexist without sharing tokens, drafts, or audit records.
- `/slr status` shows the active profile and backend connectivity without exposing secrets.
- A profile switch requires an explicit reconnect/restart message.
- A draft survives process interruption and can be resumed.

## Risk assessment

- **Risk:** Open-Science credential APIs change between releases. **Mitigation:** isolate integration behind capability adapters and retain a documented fallback.
- **Risk:** local file permissions differ on Windows/macOS/Linux. **Mitigation:** best-effort restrictive mode plus clear warning when unavailable.
- **Risk:** no native host credential store is available. **Mitigation:** use the protected local profile token flow, keep connector JSON secret-free, and require reconnect after profile changes.

## Security considerations

- Do not write raw tokens to `paper-review`, audit, package files, or skill instructions.
- Redact authorization headers and token-like strings from diagnostics.
- Validate profile names and prevent path traversal.
- Never put the token in profile metadata, generated JSON, drafts, audit records, logs, or chat. Restrictive local file permissions are best-effort on Windows; host-managed credentials remain available as an optional override.

## Next steps

Phase 4 consumes profile/workspace commands from the skill. Phase 5 verifies audit and secret-handling behavior end to end.
