---
phase: 6
title: "Release and clean-machine validation"
status: pending
priority: P1
effort: "1d"
dependencies: ["phase-01-package-installer", "phase-02-profiles-workspace", "phase-03-mcp-contract", "phase-04-skill-harness", "phase-05-safety-audit"]
---

# Phase 6: Release and clean-machine validation

## Overview

Validate the complete package as a user would consume it: install with npx, connect it from Open-Science, run the `/slr` workflow, and prove the write safety boundary.

## Requirements

- TypeScript compile, lint/type checks if configured, unit tests, MCP protocol tests, and package dry-run.
- Test from packed artifact or GitHub checkout, not only the source workspace.
- Verify exact four-tool discovery.
- Verify setup with native Open-Science connector/credential path and documented fallback path.
- Verify profile isolation and profile rotation/disable guidance.
- Verify no secrets in Git status, package contents, generated config, logs, drafts, or audit.
- Verify immutable release ref/checksum behavior and run `npm audit --json --package-lock-only` in a network-enabled environment.
- Verify backend behavior for success, empty list, unauthorized, rate limiting/retry, malformed content, `202`, and `409`.

## Related files

Create or modify:

- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/tests/installer.test.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/tests/profile-workspace.test.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/tests/acceptance/`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/README.md`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/docs/SLR_MCP_OPEN_SCIENCE_SETUP.md`

## Implementation steps

1. Add a deterministic validation script that starts the MCP process and introspects tools.
2. Run package tests and verify stdio stdout contains protocol frames only.
3. Pack the package, install it into a temporary directory, and execute the bin entry point.
4. Execute the manual Open-Science acceptance flow with a non-production project token.
5. Verify the two-step confirmation with accepted, declined, and unavailable-elicitation cases.
6. Review docs, version compatibility, release files, and rollback/update behavior.
7. Block release if secure credential storage, immutable ref verification, payload-digest confirmation, or response limits are missing.

## Todo list

- [ ] Automated package and installer gate.
- [ ] Four-tool discovery gate.
- [ ] Clean-machine setup gate.
- [ ] Manual Open-Science review/submit gate.
- [ ] Secret and regression scan.
- [ ] Supply-chain and dependency audit gate.

## Success criteria

- A new operator can follow README/setup docs from zero to `/slr status`.
- A complete review can be drafted, confirmed twice, submitted once, and audited.
- A declined review never changes backend state.
- Release artifact contains no local credentials or review workspace data.

## Risk assessment

- **Risk:** manual host validation cannot be automated in CI. **Mitigation:** keep a repeatable acceptance checklist and capture only sanitized results.
- **Risk:** release command name/org is not finalized. **Mitigation:** keep a single documented placeholder and make it a release-blocking checklist item.

## Security considerations

- Use a dedicated test project token with minimum scope.
- Rotate/revoke the token after manual acceptance.
- Do not paste real tokens into issues, test snapshots, or the repository.

## Next steps

After all criteria pass, tag/version the package and hand the final setup instructions to the SLR web-system owner for project-agent connection testing.
