---
phase: 1
title: "Package and installer foundation"
status: completed
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Package and installer foundation

## Overview

Create the standalone package boundary and the `npx` entry point. Keep the package installable without a checkout while allowing the MCP and skill artifacts to evolve together.

## Key insights

- The current MCP package is nested under `mcp/slr-agent-mcp`; it is reusable but not yet the root-level Claude-style distribution.
- `npx github:<org>/slr_skill_open_science` requires a root `package.json` with a `bin` entry and all runtime artifacts included in the package.
- Runtime review files must not be placed inside the installed package.

## Requirements

- This phase establishes the launcher and safe preview only; profile persistence, skill copying, and connector mutation are delivered in Phases 2 and 4.
- Root package metadata, versioning, license, engines, files allowlist, and bin entry.
- Installer setup/update preview is repeatable and non-destructive; later mutation commands must require explicit user intent.
- Installer performs read-only capability detection before calling optional Open-Science CLI commands.
- Production setup uses an immutable GitHub tag/commit reference; the moving default branch is development-only.
- Installer invokes only allowlisted executables with argument arrays, never shell-composed strings.
- Build output is present in the tarball and does not depend on a repository checkout.
- No secrets are accepted as command-line arguments that can leak through shell history or process listings.

## Architecture

`bin/install.js` is a small Node launcher. It invokes `cli/slr.js` for setup, profile selection, connector configuration, and diagnostics. The MCP package remains a separately testable workspace under `mcp/slr-agent-mcp` and is referenced by the generated connector command.

## Related files

Create or modify:

- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/package.json`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/package-lock.json`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/bin/install.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/cli/slr.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/scripts/pack-smoke.mjs`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/README.md`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/package.json`

## Implementation steps

1. Define the root package as the public GitHub-installable artifact and document the organization/package-name placeholder.
2. Add an idempotent installer dispatcher with explicit commands for setup, update, doctor, and help.
3. Add package path resolution that works from a temporary npx cache and from a local checkout.
4. Add a dry-run/configuration preview mode before any Open-Science mutation.
5. Add tarball and clean-install scripts to the validation matrix.
6. Document release verification requirements for resolved Git ref, package version, lockfile integrity, and artifact checksum; execute the release gate in Phase 6.

## Todo list

- [x] Root package and bin contract defined.
- [x] Installer is idempotent and non-destructive in preview mode.
- [x] Local checkout and npx cache paths both resolve.
- [x] Package contents exclude credentials and runtime review data.

## Success criteria

- `npm pack --dry-run` includes the installer, skill, MCP build output, and documentation.
- The package starts from a temporary install directory without importing source through relative checkout paths.
- Re-running setup does not duplicate the skill or overwrite an existing profile without an explicit choice.
- Production documentation does not use an unpinned moving GitHub ref.
- `pack:check` clean-installs the tarball and resolves the compiled MCP runtime dependencies.

## Risk assessment

- **Risk:** GitHub npx execution has a different working directory. **Mitigation:** resolve all package assets from the module location.
- **Risk:** optional Open-Science CLI versions differ. **Mitigation:** capability detection and a documented manual fallback.
- **Risk:** a compromised GitHub branch or CLI command path executes code with access to credentials. **Mitigation:** immutable release refs, checksum/revision display, and no-shell process spawning.

## Security considerations

- Never print token values during setup, errors, or diagnostics.
- Avoid shell interpolation for user-provided URLs, profile names, and paths.
- Keep installer commands allowlisted; do not execute arbitrary package or database content.

## Next steps

Phase 2 adds persistent profile and runtime workspace behavior; Phase 3 can proceed in parallel after the root package boundary is stable.
