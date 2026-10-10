---
phase: 2
title: "Profiles, credentials, and local review workspace"
status: pending
priority: P1
effort: "1d"
dependencies: ["phase-01-package-installer"]
---

# Phase 2: Profiles, credentials, and local review workspace

## Overview

Implement the Claude-style local operating model for multiple SLR projects while binding credentials to the Open-Science connector whenever possible.

## Key insights

- The project token is issued by the SLR web system after connecting the agent and assigning scope to that project.
- A profile must identify the backend URL and the credential/connector binding, not duplicate raw token material in several files.
- Local review artifacts make drafts auditable and allow a user to resume safely after an interrupted session.

## Requirements

- Profile commands: create, list, use, inspect masked metadata, remove, and doctor.
- Profile metadata includes backend URL, project label/id if available, credential id, connector id, and masked token state.
- Native Open-Science credential storage/binding is preferred; protected local fallback is explicit and documented.
- A fallback may persist secrets only through an OS-backed secure store; if unavailable, setup must use session-only/manual import and fail closed for persistence.
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

- [ ] Profile schema and migration marker.
- [ ] Native credential path and fallback path.
- [ ] Multi-project isolation tests.
- [ ] Runtime workspace and audit format.

## Success criteria

- Two profiles can coexist without sharing tokens, drafts, or audit records.
- `/slr status` shows the active profile and backend connectivity without exposing secrets.
- A profile switch requires an explicit reconnect/restart message.
- A draft survives process interruption and can be resumed.

## Risk assessment

- **Risk:** Open-Science credential APIs change between releases. **Mitigation:** isolate integration behind capability adapters and retain a documented fallback.
- **Risk:** local file permissions differ on Windows/macOS/Linux. **Mitigation:** best-effort restrictive mode plus clear warning when unavailable.
- **Risk:** no secure credential store is available. **Mitigation:** do not persist the token; require one-session binding or native Open-Science import.

## Security considerations

- Do not write raw tokens to `paper-review`, audit, package files, or skill instructions.
- Redact authorization headers and token-like strings from diagnostics.
- Validate profile names and prevent path traversal.
- Never treat a local JSON token file with ordinary filesystem permissions as a secure fallback.

## Next steps

Phase 4 consumes profile/workspace commands from the skill. Phase 5 verifies audit and secret-handling behavior end to end.
