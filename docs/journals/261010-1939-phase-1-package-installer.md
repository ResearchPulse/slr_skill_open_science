---
title: "Phase 1 package and installer foundation"
date: 2026-10-10
phase: 1
status: complete
---

# Phase 1: Package and installer foundation

## Context

Established the standalone `slr_skill_open_science` distribution boundary so it can be consumed through `npx` without a repository checkout.

## What happened

- Added the root npm package, `bin` entry, files allowlist, workspace declaration, and root lockfile.
- Added the installer/CLI with `help`, `setup`, `doctor`, `update`, and `--mcp`; package assets resolve from the installed package and child processes avoid shell composition.
- Added `pack:check` and a clean-tarball smoke script covering pack, temporary install, asset checks, MCP startup, runtime imports, and rejected credential arguments.
- Fixed packaged MCP runtime dependency resolution by declaring runtime dependencies in the package/workspace metadata and validating the compiled import after clean installation.
- Added token non-disclosure guards: credential flags are rejected, setup/diagnostics do not print credentials, and smoke checks assert rejected inputs are absent from output.

## Verification

- `npm.cmd run typecheck:mcp`: passed.
- `npm.cmd run test:mcp`: passed — 4 files, 14 tests.
- The clean-tarball smoke gate is implemented in `scripts/pack-smoke.mjs`; its final result was not observed after this session’s interrupted run.

## Decisions and deferred work

Phase 1 remains non-destructive and preview-only. Credentials stay in the Open-Science connector or protected runtime environment; production documentation uses an immutable package reference.

Deferred: Phase 2 profiles/workspace, Phase 3 MCP contract completion, Phase 4 skill harness, Phase 5 confirmation/audit/security hardening, and Phase 6 release and clean-machine validation.

## Next

Complete the deferred phases, then run the full packaged-artifact, host-integration, secret-scan, supply-chain, and release acceptance gates.
