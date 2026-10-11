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
- Updated `/slr` help/setup wording so chat remains read-only and never asks for
  a token.
- Preserved the digest-bound second confirmation for
  `submit_review_result`.

## Verification

- CLI tests: 10 passed.
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
- Run `/slr setup`, discover the four tools, and exercise both confirmation
  gates.
- Complete release security review and decide whether to commit/tag/push.
