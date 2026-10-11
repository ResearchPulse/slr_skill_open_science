---
date: 2026-10-11
session: claude-style-setup
status: in-progress
---

# Journal: 2026-10-11 — Claude-style Open-Science setup

## Context

The package needed the same low-friction onboarding shape as the Claude SLR
repository while preserving the Node/TypeScript MCP runtime and exact
four-tool contract.

## Changes

- Made the no-argument `npx github:ResearchPulse/slr_skill_open_science`
  command run interactive setup.
- Added hidden terminal token input, profile-separated token files, read-only
  API probing, and profile-aware root `--mcp` startup.
- Added a profile-aware, secret-free `mcp-config.json` fallback for manual
  connector import.
- Kept generated connector configuration secret-free and added `--profile` to
  connector arguments.
- Made connector registration start the Open-Science daemon with
  `open-science start --no-open` when the CLI is available but the daemon is
  stopped; Windows setup also checks common per-user install paths and
  `OPEN_SCIENCE_CLI`.
- Updated `/slr` help/setup wording so chat remains read-only and never asks for
  a token.
- Preserved the digest-bound second MCP call for
  `submit_review_result` while reducing it to one user-facing confirmation.

## Verification

- CLI tests: 26 passed.
- MCP tests: 22 passed.
- MCP typecheck and stdio acceptance harness: passed.
- Profile-backed launcher startup smoke: passed.
- `npm pack --dry-run --ignore-scripts`: passed with a task-local npm cache.
- Full pack smoke install remains blocked by Windows npm cache permissions and
  the previously observed registry/cache hang.

## Decisions and risks

The default profile root is `~/.slr`, overridable with `SLR_CONFIG_DIR`.
Tokens are kept outside JSON metadata and generated connector files, with
best-effort restrictive file permissions. Host-managed Open-Science
credentials remain an optional override. A future hardening pass should add
OS-native encrypted secret storage before treating the local fallback as a
high-assurance production credential store.

No backend files, routes, schemas, or project-token generation logic were
changed.

## Next steps

- Validate the generated connector manually in Open-Science with a
  non-production project.
- Run `/slr setup`, discover the four tools, and exercise the single
  user-facing confirmation flow.
- Verify auto-start registration on a machine with Open-Science installed and
  retain manual connector import as the fallback when its CLI is unavailable.
- Complete release security review and decide whether to commit/tag/push.
