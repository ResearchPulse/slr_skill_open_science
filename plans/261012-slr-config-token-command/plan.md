# Plan: `/slr config token <TOKEN>`

## Objective

Support one explicit in-chat configuration command, `/slr config token <TOKEN>`, that validates a project token and automatically updates the selected local profile, encrypted Open-Science credential, and both SLR connectors without printing or persisting the raw token in profile metadata, connector JSON, logs, or tool results.

## Scope

- Extend the `slr-config` MCP contract with one explicit token-configuration operation while preserving the existing profile-first flow.
- Validate the candidate token against the configured API before mutation.
- Detect exact-token, project-ID, and new-project matches.
- Auto switch/update/save when the match is unambiguous; return safe profile metadata when user selection is required.
- Update the `/slr` skill, command reference, README, and setup documentation.
- Add regression tests for validation, matching, credential binding, connector registration, redaction, and failure rollback behavior.

## Non-goals

- No backend/API route changes.
- No arbitrary shell execution or terminal fallback from the skill.
- No raw token in profile files, connector JSON, drafts, logs, or response text.
- No compare feature.

## Implementation phases

1. **Contract and flow**: add the explicit token command, reuse existing validation/matching/credential/connector logic, and keep ambiguous matches non-mutating.
2. **Secret handling**: accept the token only in the explicit config operation, redact token-derived values, and update the encrypted credential before profile/connectors.
3. **Skill/docs**: document `/slr config token <TOKEN>` as the only token command syntax and remove stale terminal-fallback instructions for this path.
4. **Verification**: run tests/typechecks/package checks and verify both MCP connectors; invalid tokens and registration failures must preserve the previous active configuration.

## Acceptance criteria

- The skill recognizes `/slr config token <TOKEN>` and performs the flow without a second confirmation.
- Valid exact/project/new matches produce switch/update/save respectively.
- Invalid tokens fail before mutation; ambiguous matches return safe choices without mutation.
- Credential and connector updates are automatic when Open-Science is available.
- No test or command output contains a raw token.
- Existing review tools and `/slr setup`, `/slr status`, and `/slr tasks` remain compatible.

## Risks and mitigations

- Host credentials are not fully transactional; update profile/connectors only after credential binding succeeds and report reconnect state on partial failure.
- Running connectors may retain old credentials; require reconnect/restart and verify with `/slr status`.
- MCP clients may cache schemas; document starting a new conversation after connector changes.
