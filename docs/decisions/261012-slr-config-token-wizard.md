---
status: accepted
date: 2026-10-12
title: In-chat /slr config token wizard
---

# In-chat `/slr config` token wizard

## Context

The Open-Science package already supports Claude-style setup through the root
`npx github:ResearchPulse/slr_skill_open_science` command. That flow asks for a
hidden terminal token, stores it in a local profile, tests the API, and can
register the connector.

The in-chat `/slr config` command currently only explains the active profile and
connector binding. Users must leave Open-Science and run the installer whenever
they want to configure a project token. The requested experience is a fast
profile-aware setup wizard that lets the user choose or create a profile,
paste a project token, and finish the local configuration from the SLR skill.

The backend and the review MCP contract are out of scope. The review MCP keeps
exactly four task tools; the separate config MCP exposes a dedicated token
configuration operation.

## Decision

Add a profile-aware `/slr config` setup flow to the Open-Science integration.
The flow uses the existing local profile/connector setup layer as its mutation
boundary; it does not add configuration or health tools to the SLR MCP server.

The user flow is:

1. `/slr config` lists existing local profiles using non-secret metadata and
   offers `Create new profile`.
2. The user selects an existing profile or creates a profile name before
   entering a token.
3. The user pastes the project token into the setup input.
4. The local setup bridge stores the token outside profile metadata, performs a
   read-only API test, and obtains the project identity returned by the API.
5. The bridge checks whether the token is already known locally or whether the
   API project identity matches another local profile.
6. If a matching profile exists, the wizard recommends switching to it instead
   of creating a duplicate. A project-identity match with a different token is
   treated as a possible token rotation and recommends updating the existing
   project profile.
7. After the user accepts the suggested switch/update, the bridge activates the
   selected profile, writes a secret-free connector definition, and attempts to
   update and enable the Open-Science connector.
8. The wizard reports a concise result and suggests `/slr status`.

The raw token may be entered through the requested in-chat input path, but it
must never be echoed, printed, placed in profile metadata, connector JSON,
skill files, drafts, audit records, tool results, or diagnostic output.

## Profile matching rules

Matching is evaluated without displaying secret values:

| Match | Behavior |
| --- | --- |
| Exact token matches a local profile | Recommend switching to that profile; do not duplicate the token. |
| API project ID matches another profile, token differs | Treat as a likely rotation; recommend updating that existing profile. |
| No local match and API test succeeds | Save the token to the chosen/new profile and record returned project metadata. |
| API test fails | Do not activate or overwrite a profile; report a concise failure and allow retry. |

The wizard must not infer identity from project name alone when a stable project
ID is available. If the API does not return a project ID, it may use the
returned project name only as a non-authoritative suggestion and must ask before
merging profiles.

## Architecture

```text
/slr config
    |
    v
Open-Science skill setup bridge
    |
    +--> profile store and protected token file
    +--> read-only GET /agent/v1/tasks?limit=1
    +--> secret-free connector config
    +--> Open-Science CLI: update/add + enable
    |
    v
local root MCP launcher --profile <name>
    |
    v
exactly four SLR MCP tools
```

The existing root CLI remains the canonical implementation for profile writes,
token loading, API testing, connector registration, and daemon readiness. The
in-chat command must call that local setup layer through the host-supported
local command/configuration bridge. It must not send the token through any of
the four SLR MCP tools.

The connector remains profile-aware and secret-free:

```text
command: npx
args: --yes github:ResearchPulse/slr_skill_open_science --mcp --profile <name>
```

Changing the active profile requires connector update/restart before the new
project is considered active. The wizard must not claim success until the
read-only MCP check succeeds after reconnection.

## User-facing output

The normal flow is concise:

```text
SLR profiles
1. default — Project ABC — active
2. demo — Project Demo
3. Create new profile

Choose a profile: 3
Profile name: research-demo
Paste project token:

Checking token…
SLR configured · Project ABC
Profile: research-demo
Connector: enabled
Next: /slr status
```

When a match is found:

```text
This token belongs to profile `default` · Project ABC.
Switch to that profile? (yes/no)
```

The switch/update decision is one user-facing choice. It must not introduce a
second confirmation prompt for the same configuration action.

Failure output must contain only an actionable status, for example:

```text
SLR configuration failed · API returned 401
No profile or connector was changed.
Next: paste a valid token and retry /slr config
```

Detailed diagnostics remain available through the root CLI `--json` or
`doctor` commands, not in the normal chat response.

## Constraints and safety invariants

- Do not modify the backend, API routes, database schema, or web application.
- Keep exactly these four review MCP tools: `list_assigned_tasks`,
  `get_assigned_task`, `get_task_fulltext`, and `submit_review_result`.
- Do not add arbitrary health or command-execution tools; token configuration is
  limited to `slr_config_token` in the separate config MCP.
- Do not pass a raw token in command-line arguments or generated connector
  JSON; use a non-echoing local input path.
- Never print, echo, log, or include the token in skill text, chat output,
  drafts, audit records, tool results, or error messages.
- Do not overwrite a profile or change the active profile before the token
  passes the read-only API check and the user accepts a detected match.
- Do not automatically switch a long-running connector without updating or
  restarting it.
- If the Open-Science CLI/daemon is unavailable, preserve the existing manual
  import fallback and state that automatic registration was not completed.
- `/slr setup` remains a read-only connection check; `/slr config` is the only
  configuration wizard.

## Acceptance criteria

- `/slr config` lists profiles without exposing secrets.
- The user chooses or creates a profile before token entry.
- A valid token can be saved through the local setup bridge and tested with a
  read-only task request.
- An exact local token match recommends switching instead of duplicating.
- A project-ID match with a different token recommends updating the existing
  profile as a rotation path.
- A new project creates or updates only the selected profile.
- Successful configuration writes a secret-free profile-aware connector and
  attempts to enable it.
- Connector restart/reconnect is required after profile switching.
- Normal output is concise and ends with `/slr status` as the next action.
- The connector still discovers exactly four MCP tools.
- No backend files are changed.
- Invalid tokens leave the previous active profile and connector unchanged.

## Alternatives considered

### Add a fifth MCP configuration tool

Accepted for the separate config MCP. It keeps token mutation out of the review
MCP and reuses the host credential and connector-registration boundary.

### Keep `/slr config` read-only and require the root `npx` installer

Rejected for the requested UX. It is simple and safer, but forces users to
leave Open-Science for every new project or token rotation.

### Make `/slr config` write directly from skill instructions

Rejected as an implementation boundary. Skill text alone cannot guarantee
local filesystem writes or connector lifecycle operations across hosts. The
skill must delegate to the existing local setup bridge and retain a manual
fallback when the host bridge is unavailable.

## Open implementation question

The implementation must verify which Open-Science host capability is available
for invoking the local setup bridge from a skill. If the host does not expose a
local command/configuration bridge, the package must report that limitation and
fall back to the existing root `npx` setup command rather than pretending that
`/slr config` changed connector state.

## Out of scope

- Compare between agents or projects.
- New backend endpoints or project-token semantics.
- Automatic paper assignment, PDF retrieval, or review submission changes.
- Changes to the existing digest-bound review confirmation flow.
# Superseded note

The four-tool review-MCP constraint in this earlier decision is superseded by the
Claude/Open-Science unification plan. The current review connector adds the bounded
read-only `connection_test` tool; configuration tools remain in the separate
`slr-config` connector and the token/credential safety rules below still apply.
