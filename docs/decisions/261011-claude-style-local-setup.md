---
status: accepted
date: 2026-10-11
title: Claude-style local setup for Open-Science
---

# Claude-style local setup for Open-Science

## Context

The Open-Science package currently exposes the correct four-tool Node/TypeScript
MCP server, but its setup flow is host-first: the user must create an
Open-Science Credential and bind it to the connector before the package can
test the API. The Claude Science package provides a simpler onboarding flow:
one `npx` command detects the runtime, copies the skill, uses the production API
URL by default, asks for the hidden token, saves a project profile, tests the API, and registers the
MCP server.

The desired user experience is the Claude flow while preserving the existing
SLR backend contract and the Open-Science integration. The backend is out of
scope and must not be changed.

## Decision

Adopt the Claude-style setup and profile experience, but keep the existing
Node.js/TypeScript MCP runtime. Python is not required for the Open-Science
package because the current MCP implementation and release artifact are
Node-based.

The root package command remains:

```text
npx github:ResearchPulse/slr_skill_open_science
```

With no subcommand, it runs interactive setup. The setup sequence is:

1. Verify the supported Node runtime and locate the package assets.
2. Copy or update the managed `/slr` skill.
3. Use the production API base URL by default and ask only for the project token; the token input is hidden. A custom URL remains available through `--api-base-url`.
4. Save the URL, selected profile, and token in the local profile store.
5. Run a read-only API connection test using `list_assigned_tasks`.
6. Generate and, when the Open-Science CLI is available, register a local MCP connector.
7. Print the next action: import/enable the skill if needed, restart the connector if needed, and run `/slr setup`.

The CLI installer and the in-chat `/slr setup` command are separate:

- Package `setup` performs local installation, profile configuration, API test,
  and connector registration.
- In-chat `/slr setup` performs only the read-only MCP health check and reports
  the active project/task state. It does not ask for a token or mutate host
  settings.

## Runtime and profile model

The MCP launcher must load the selected profile before starting the compiled
MCP server. The generated connector configuration contains profile metadata,
not the raw token.

```text
~/.slr/
├── profiles.json                 # URL, active profile, masked metadata
└── tokens/
    └── <profile>                # raw token, local-only, restrictive permissions
```

On Unix-like systems the token file uses mode `0600`. On Windows the launcher
uses the strongest practical local file protection available through the Node
runtime and never prints the token. The profile name is passed to the MCP
launcher through connector metadata; a profile change requires connector
restart/reconnect so a long-running process cannot silently switch projects.

The token is never placed in:

- command-line arguments;
- generated MCP JSON;
- skill files or prompts;
- drafts or `audit.jsonl`;
- normal tool results, diagnostics, or logs;
- source control.

## Connector registration

Registration is best-effort because Open-Science connector management is owned
by the host application and its CLI may not be installed or may change shape.

The installer will:

1. Detect the Open-Science CLI.
2. Invoke only a supported structured connector-registration command when
   available.
3. Pass a secret-free connector definition containing the package command,
   profile ID, API URL, and required environment metadata.
4. Save the same secret-free definition as `mcp-config.json`.
5. If registration is unavailable, report that fact and give the exact manual
   import path; setup must not claim the connector is connected until the
   subsequent read-only check succeeds.

The fallback is an explicit compatibility path, not a second authentication
model. The MCP launcher still reads the local profile token when Open-Science
starts it.

## MCP contract and safety invariants

The public MCP surface remains exactly:

1. `list_assigned_tasks`
2. `get_assigned_task`
3. `get_task_fulltext`
4. `submit_review_result`

`submit_review_result` keeps the existing digest-bound two-step confirmation:

1. The first call returns the exact proposed payload and digest without making
   a backend write.
2. The user confirms the displayed draft.
3. The second call must carry the matching confirmation digest.
4. Only the matching second call may perform the single backend POST.

Cancellation, missing confirmation, changed payload, mismatched digest, and
terminal duplicate responses remain fail-closed.

## Acceptance criteria

- Running `npx github:ResearchPulse/slr_skill_open_science` with no arguments
  starts interactive setup.
- Runtime discovery succeeds on a clean machine with supported Node.js.
- The installer copies the managed `/slr` skill without overwriting an
  unmanaged skill.
- API URL and token are entered in the terminal; token input is hidden and
  never echoed.
- A profile can be created, listed, selected, and tested without exposing the
  token.
- The test uses a read-only task request and reports the connected project or
  a precise failure.
- Generated connector configuration contains no raw token.
- Connector registration works when the supported Open-Science CLI is
  available; otherwise the installer produces a usable manual-import JSON.
- Starting the generated connector exposes exactly four tools.
- `/slr setup` succeeds only after the connector can call
  `list_assigned_tasks`.
- Profile switching requires a connector restart/reconnect and cannot mix
  projects.
- The write confirmation handshake remains enforced and is covered by tests.
- Backend files and routes are unchanged.

## Alternatives considered

### Exact Claude port

Port the Python stdlib MCP and Python profile/token implementation wholesale.
This gives maximum source-level parity but replaces the validated Node MCP,
adds Python runtime discovery and packaging complexity, and increases the
chance of divergence from the Open-Science package.

### Open-Science-native credentials only

Keep the current host-managed Credential flow and do not prompt/store tokens
locally. This is the safest host integration, but it does not meet the desired
Claude-style one-command onboarding experience.

### Chosen hybrid

Keep Node/TypeScript and the four-tool server, while reproducing Claude's
interactive setup, local profiles, hidden token prompt, API test, and
best-effort connector registration. This provides the requested UX with the
smallest runtime change and keeps the backend untouched.

## Consequences

Positive:

- Users can complete most setup from one `npx` command.
- Multiple projects can be managed without manually rebuilding connector JSON.
- The existing MCP contract and write safety remain unchanged.
- Open-Science remains the host for skill enablement and connector lifecycle.

Costs and risks:

- A local token store becomes part of the security boundary.
- Open-Science CLI registration must be version-detected and retain a manual
  fallback.
- Connector restart is required after profile changes.
- The generated package must include the launcher and compiled MCP artifact.

## Implementation boundary

The implementation plan must cover only the Open-Science package:

- installer and interactive prompts;
- local profile/token store and redaction tests;
- profile-aware MCP launcher;
- Open-Science registration adapter and fallback config;
- `/slr` help/setup wording;
- package/tarball/manual acceptance tests.

No backend route, database schema, project-token generation, or web UI change
is included.
