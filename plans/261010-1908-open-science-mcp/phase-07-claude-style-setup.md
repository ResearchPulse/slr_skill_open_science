---
phase: 7
title: "Claude-style interactive setup and profile-backed launch"
status: in-progress
priority: P1
effort: "2d"
dependencies: ["phase-02-profiles-workspace", "phase-03-mcp-contract", "phase-05-safety-audit"]
---

# Phase 7: Claude-style interactive setup and profile-backed launch

## Overview

Add the missing Claude-style onboarding flow to the existing Open-Science
package. The default unqualified `npx` command will configure one project
without requiring manual credential-field editing, while the MCP process stays
non-interactive and exposes the existing four tools only.

## Requirements

- Running `npx github:ResearchPulse/slr_skill_open_science` with no arguments
  is equivalent to `setup`.
- Setup detects and validates supported Node.js; Python is not introduced.
- Setup copies/updates the managed `/slr` skill and preserves unmanaged targets.
- Setup prompts for API URL and project token in the terminal; token input is
  hidden and Enter can retain an existing profile token.
- URL and token are stored by profile; raw token is never printed or put in
  generated MCP JSON, command arguments, logs, drafts, or audit records.
- Setup tests the profile using a read-only `list_assigned_tasks` request.
- Generated connector config contains the selected profile ID and URL but no
  secret, and points at the package `--mcp` entry point.
- The installer attempts supported Open-Science CLI registration and always
  retains a usable manual-import fallback when the host CLI is unavailable.
- `--mcp` starts the profile-aware launcher without prompting; stdout remains
  reserved for MCP JSON-RPC and diagnostics go to stderr.
- Profile changes require reconnect/restart and cannot mix project tokens.
- `/slr setup` remains an in-chat read-only check after the connector starts.

## Architecture

```text
npx package (interactive)
  |-- skill-store: copy /slr
  |-- profile-store: save URL + local token file
  |-- API probe: list_assigned_tasks(limit=1)
  `-- connector adapter: register or emit secret-free JSON

Open-Science connector
  `-- npx package --mcp --profile <name>
       `-- profile-aware launcher loads token
            `-- compiled TypeScript MCP over stdio
                 `-- SLR Agent API
```

The profile store must use a versioned schema and separate secret material
from metadata. On Unix-like systems token files use `0600`; on Windows apply
the strongest practical local permission restriction available through the
Node runtime and emit only a non-secret warning if it cannot be enforced.

The launcher resolves one profile before importing/starting the MCP server and
passes the resolved values in process memory. It must not write the token back
to environment files or connector JSON. If the profile is missing or invalid,
the launcher fails with a redacted error and does not start a partially
configured server.

## Related Code Files

- Modify: `cli/profile-store.js` - versioned token storage, load/save/delete,
  masking, permission handling, and profile migration.
- Modify: `cli/slr.js` - interactive setup prompts, API probe, profile
  selection, redacted setup output, and connector metadata.
- Modify: `bin/install.js` - default setup dispatch and profile-aware `--mcp`
  dispatch without interactive prompts.
- Create or modify: `cli/mcp-launcher.js` - resolve profile and start the
  compiled MCP while preserving stdio protocol boundaries.
- Modify: `cli/skill-store.js` - preserve managed/unmanaged skill behavior.
- Modify: `mcp/slr-agent-mcp/src/config.ts` - accept launcher-provided resolved
  configuration without weakening validation or redaction.
- Modify: `tests/profile-workspace.test.mjs` - token isolation, masking,
  migration, and permission behavior.
- Create: `tests/setup-flow.test.mjs` - prompt/test/connector fallback flow.
- Modify: `mcp/slr-agent-mcp/tests/stdio.test.ts` - profile-aware launcher and
  stdout/stderr behavior.
- Modify: `README.md` and `docs/SLR_MCP_OPEN_SCIENCE_SETUP.md` - new quick
  setup, profile switching, token rotation, and fallback instructions.
- Modify: `docs/open-science-architecture.md` - reconcile previous host-first
  credential wording with the accepted ADR.

## Implementation Steps

1. Define the profile token-file schema, migration rules, active-profile
   resolution, and redacted public representation.
2. Implement hidden interactive prompts with non-interactive detection; never
   prompt when `--mcp`, JSON mode, or piped stdio is active.
3. Add a read-only setup probe that uses the same HTTP validation and error
   redaction rules as the MCP client.
4. Add the profile-aware MCP launcher and pass `--profile` in generated
   connector arguments.
5. Add capability detection for supported Open-Science connector commands;
   use argument arrays and secret-free payloads only.
6. Preserve the manual-import JSON fallback and clearly distinguish
   "registered", "generated", and "connected".
7. Update help, README, setup guide, and architecture documentation.
8. Add unit, integration, stdio, and packed-artifact tests before release
   validation in Phase 6.

## Success Criteria

- [x] No-argument `npx` invokes interactive setup.
- [x] URL and hidden token prompt save a selectable local profile.
- [x] Setup test succeeds or returns a redacted actionable error.
- [x] Profile token never appears in process arguments, generated JSON, logs,
      skill files, drafts, audit records, or test snapshots.
- [x] Generated connector starts the selected profile and the compiled MCP
      acceptance harness discovers exactly
      four tools.
- [x] `--mcp` never prompts and emits clean MCP stdio.
- [x] Open-Science registration is attempted only when capability detection
      passes; fallback JSON remains valid otherwise.
- [x] `/slr setup` succeeds only after the connector can call the read-only
      task listing.
- [x] Existing digest confirmation tests remain green.
- [x] Backend repository files are unchanged.

## Risk Assessment

- **Local token exposure:** a filesystem token store expands the trust boundary.
  Mitigate with restrictive permissions, redaction tests, no token-in-config,
  and clear rotation/removal commands.
- **Windows permissions:** POSIX mode bits may not provide equivalent ACLs.
  Mitigate with best-effort ACL handling and an explicit warning; keep native
  Open-Science Credential support available for stronger protection.
- **Open-Science CLI drift:** registration syntax may change. Isolate the
  adapter, detect capabilities, and retain manual import.
- **Profile mix-up:** a running connector may retain old state. Require
  reconnect/restart and show the active profile in setup/status responses.
- **Stdio corruption:** prompts or logs can break MCP. Keep setup and MCP
  entry paths separate and test stdout byte-for-byte at the protocol boundary.

## Security Considerations

- Never accept token values through ordinary command-line flags.
- Never echo, log, serialize, or include tokens in diagnostics or generated
  skill/config files.
- Never let task/paper content influence executable paths, arguments, or
  profile selection.
- Delete/rotate a local token when the user removes or rotates the project
  credential.
- Keep `submit_review_result` digest confirmation unchanged and fail closed on
  missing, declined, stale, or mismatched confirmation.

## Next Steps

After this phase is implemented and reviewed, run Phase 6 clean-machine and
manual Open-Science acceptance tests, then release from an immutable Git ref.
