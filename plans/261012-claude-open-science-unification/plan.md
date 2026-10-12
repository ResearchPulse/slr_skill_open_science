# Plan: Claude/Open-Science SLR surface unification

## Objective

Make the Open-Science package expose the same user-facing SLR capability surface as
`ResearchPulse/slr_skill_claude_science`, while keeping Open-Science as the only
execution and credential boundary.

## Source manifest

- Source: `https://github.com/ResearchPulse/slr_skill_claude_science`
- Inspected ref: local clone at `C:/Users/LENOVO/AppData/Local/Temp/slr-claude-science-inspect/repo`
- Inspected commit: `41c8aec7f4986af38525ed33a534d02c4072552f`
- Source skill count: 1 (`SKILL.md`)
- Source installer commands: 4 command families (`install`/`update`, `mcp`, `doctor`, `uninstall`)
- Source `/slr` command forms: 17 forms across help, setup, status, list, review,
  drafts, edit, submit, auto, config subcommands, mcp, and diag
- Source MCP tools: 5 (`submit_result`, `list_tasks`, `get_markdown`, `get_task`,
  `connection_test`)
- Source runtime assets: Node installer, Python stdlib CLI, Python stdlib MCP server,
  and one review rubric

## Local anatomy and dependency matrix

| Source capability | Open-Science equivalent | State | Decision |
| --- | --- | --- | --- |
| One `/slr` skill | `skill/slr/SKILL.md` | EXISTS | Extend the command contract and keep Open-Science wording canonical |
| Python API CLI | `cli/slr.js`, profile/workspace modules, TS MCP | CONFLICT | Do not transplant; preserve Node/TS and encrypted host credentials |
| Python stdio MCP | `mcp/slr-agent-mcp` | EXISTS/PARTIAL | Port the missing `connection_test` tool idiomatically |
| Five review tools | Four review tools | PARTIAL | Add `connection_test`; do not add direct-API or bulk-write tools |
| Profile/token files | `slr-config-mcp` + Open-Science credentials | CONFLICT | Keep token out of profile/connector JSON and bind `SLR_AGENT_TOKEN` |
| Drafts/submission audit | `cli/workspace.js` | EXISTS/PARTIAL | Document and expose Claude-compatible draft/edit/submit surface |
| Installer `mcp` | package CLI | PARTIAL | Add a safe connector/status view, never print secrets |
| Installer `doctor` | package CLI `doctor` | EXISTS | Expand checks to the unified connector/tool surface |
| Installer `uninstall` | package CLI | NEW | Add explicit, confirmation-gated package cleanup; preserve credentials by default |
| `review-rubric.md` | `review-policy.md` | EXISTS/IMPROVED | Keep local policy; it is stricter and already covers the source rubric |

## Approved challenge decisions

1. **Need:** users need one command vocabulary across Claude and Open-Science, not a
   second Python implementation. Port the interface and behavior, not the stack.
2. **Simpler alternative:** aliases and skill guidance provide most parity; only the
   missing MCP health tool and installer surfaces require code.
3. **Existing overlap:** profiles, encrypted credentials, workspaces, drafts,
   confirmation digest, setup, doctor, and connector registration already exist.
4. **Maintenance:** Open-Science owns the canonical implementation; Claude command
   names become compatibility aliases documented in one command reference.
5. **Dependency:** no new runtime dependency; reuse current MCP SDK and Node APIs.
6. **Security:** raw-token chat configuration remains explicit-only and redacted;
   no source fallback that stores plaintext tokens or invokes arbitrary shell.

## Decision matrix

| Decision | Claude source | Open-Science target | Choice |
| --- | --- | --- | --- |
| Auth/token storage | `~/.config/slr/tokens/<profile>` | Encrypted Open-Science credential binding | Open-Science credential |
| Network reads | Python CLI direct API with fallback | Review MCP boundary | MCP-only |
| Review health | `connection_test` | `list_assigned_tasks` only | Add bounded `connection_test` |
| Confirmation | Skill approval plus MCP submit | One user approval plus internal digest call | Preserve one prompt |
| Profiles | Python config file | Safe metadata + host credential | Preserve local model |
| MCP output | Manual JSON snippet | Registered connector metadata | Safe status output, no secret config |
| Cleanup | Remove MCP/skill, optional purge | Need explicit cleanup | Add `uninstall --yes`; keep credential/profile unless `--purge` |

## Implementation phases

1. **Contract parity:** add `connection_test`, update review MCP schemas/tests/docs,
   and make the tool count/documentation consistent.
2. **Skill command parity:** add Claude-compatible aliases and workflow commands for
   task listing, drafts, edit, submission, auto-review, MCP status, diagnostics, and
   config subcommands. All writes remain confirmation-gated and MCP-mediated.
3. **Installer parity:** add safe `mcp` and explicit `uninstall` command surfaces;
   expand `doctor` output to distinguish package, connector, credential, and API
   readiness without printing secrets.
4. **Documentation/tests:** publish the source-to-local mapping, update README/setup
   docs, add regression tests for command aliases, health tool, safe cleanup, and
   secret redaction.
5. **Verification:** run CLI/MCP tests, typechecks, package smoke test, and inspect
   the final generated package. Host Open-Science must reinstall/reconnect after
   release; local source tests cannot update a previously registered GitHub connector.

## Rollback strategy

- Revert only the files in this plan; do not touch the prior token-config work.
- Keep old four-tool clients compatible by making `connection_test` additive.
- `uninstall --yes` removes only the managed `/slr` skill directory. Profile
  metadata, encrypted credentials, and registered connectors remain untouched;
  connector removal is intentionally outside this safe command.
- If a host rejects the new connector tool list, use the previous package revision;
  the review tools remain unchanged.

## Acceptance criteria

- The package reports exactly one canonical `/slr` skill with Claude-compatible command
  names and state-dependent next-action guidance.
- Review MCP exposes five tools including `connection_test`; existing four tools and
  the digest confirmation contract remain compatible.
- `/slr config token <TOKEN>` remains the explicit quick path and never echoes or
  persists the raw token in profile metadata, connector JSON, drafts, or results.
- `slr mcp`, `slr doctor`, and `slr uninstall --yes` are safe and do not require a
  Python runtime or direct API fallback.
- All existing tests plus new parity tests pass; package smoke confirms all shipped
  entrypoints.

## Files expected to change

- Modify: `mcp/slr-agent-mcp/src/http-client.ts`, `src/tools.ts`, schemas/types/tests,
  README
- Modify: `skill/slr/SKILL.md`, `skill/slr/references/commands.md`,
  `skill/slr/references/error-handling.md`
- Modify: `cli/slr.js` and CLI tests
- Modify: root `README.md` and Open-Science setup/architecture docs
- Create: parity/cleanup tests and this plan documentation

