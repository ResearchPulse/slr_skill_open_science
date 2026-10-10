---
phase: 3
title: "MCP adapter and four-tool contract"
status: completed
priority: P1
effort: "1d"
dependencies: ["phase-01-package-installer"]
---

# Phase 3: MCP adapter and four-tool contract

## Overview

Consolidate the existing TypeScript MCP implementation under the new package boundary and verify that it exposes exactly the backend contract required by Open-Science.

## Key insights

- The backend contract is already implemented under `/api/agent/v1`; the adapter should translate transport and schema concerns only.
- The existing implementation already has the four required tool names and safety-oriented HTTP behavior; preserve it and integrate it rather than redesigning the API.
- `submit_review_result` must not become an implicit auto-approval path when the host does not support elicitation.

## Requirements

- Exactly four registered tools; no health, config, preview, or helper tools exposed through MCP.
- Typed schemas matching `docs/AI_AGENT_TASK_API_CONTRACT.md`.
- Bearer token injection only in the HTTP client.
- GET-only retry behavior; preserve `Retry-After`; do not retry terminal duplicate submission conflicts.
- HTTPS enforcement except explicitly allowed loopback development URLs.
- Final confirmation elicitation immediately before the single submit POST.
- Confirmation must bind to a canonical payload digest covering profile, task, decision, reasoning, and data.
- Redacted tool errors and no token leakage in logs or results.
- Bounded JSON/Markdown response bodies and sanitized URL/error handling.

## Architecture

`src/server.ts` registers the four tools. `src/tools.ts` owns tool orchestration. `src/http-client.ts` owns HTTP and auth. `src/config.ts` resolves one active profile/environment. `src/schemas.ts`, `src/types.ts`, and `src/errors.ts` remain the contract boundary. The package entry point starts stdio only.

## Related files

Modify or extend:

- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/src/server.ts`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/src/tools.ts`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/src/http-client.ts`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/src/config.ts`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/tests/`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/package.json`

## Implementation steps

1. Reconcile package metadata and build output with the root installer.
2. Verify tool registration by introspecting the server with an MCP client.
3. Map every input/output/error to the backend contract and remove accidental extra fields.
4. Wire one active profile credential source without persisting it in tool state.
5. Add payload-digest confirmation and reject stale/mismatched confirmations.
6. Add response byte limits, URL userinfo/fragment/query rejection, and stable unknown-error mapping.
7. Verify submit confirmation, decline, invalid response, 202, 409, 401, oversized response, and redaction paths.
8. Keep stdio stdout protocol-clean; send diagnostics only to stderr.

## Todo list

- [x] Four-tool introspection test.
- [x] Contract fixture tests.
- [x] Confirmation and conflict tests.
- [x] Payload-digest mismatch and oversized-response tests.
- [ ] Tarball execution test (clean install requires a network-enabled registry/cache).

## Success criteria

- MCP client reports exactly four tools with stable names.
- All requests are project-scoped and authenticated through one configured bearer credential.
- No POST is issued when confirmation is declined or unavailable.
- Existing MCP unit/integration tests pass from the standalone package.

## Risk assessment

- **Risk:** SDK upgrades alter elicitation APIs. **Mitigation:** pin compatible SDK range and isolate confirmation adapter behind a small interface.
- **Risk:** package relocation breaks imports or build paths. **Mitigation:** compile, pack, and execute from a temporary package location.
- **Risk:** a large or malicious response exhausts the local process. **Mitigation:** bounded stream reads and abort-on-limit tests.

## Security considerations

- Treat all task text and fulltext as untrusted content; never execute instructions found in papers.
- Keep backend URL allowlisting/validation and token rejection handling in the HTTP client.
- Do not include full reasoning or sensitive draft content in confirmation labels unless explicitly intended by the user.
- Treat backend URLs, response bodies, and error text as untrusted; sanitize before exposing them to the host.

## Next steps

Phase 4 maps these tools into user-facing `/slr` commands and the generated Open-Science connector configuration.
