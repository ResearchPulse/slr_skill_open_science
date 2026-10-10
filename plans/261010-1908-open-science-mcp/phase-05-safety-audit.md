---
phase: 5
title: "Confirmation, audit, and security hardening"
status: in-progress
priority: P1
effort: "1d"
dependencies: ["phase-02-profiles-workspace", "phase-03-mcp-contract", "phase-04-skill-harness"]
---

# Phase 5: Confirmation, audit, and security hardening

## Overview

Prove the two-step write boundary and make the local review trail useful without turning it into a secret store or a second source of truth.

## Key insights

- Open-Science permission mode is a host-level control, but it is not sufficient as the only product guarantee for this domain write.
- The skill-level confirmation and MCP elicitation should be independent gates immediately before the one write request.
- A declined or failed confirmation must leave a resumable draft and must not create a submitted record.

## Requirements

- Confirmation summary includes active profile/project, task identifier, decision, concise sanitized reasoning preview, and a canonical payload digest.
- First gate is explicit skill interaction after the draft is shown.
- Second gate is MCP elicitation at `submit_review_result` execution time.
- Exactly one POST on a confirmed submission; never retry `409` duplicate/terminal conflicts.
- Audit events cover draft created, confirmation accepted/declined, submit attempted, submitted, conflict, and failure.
- Audit records exclude bearer tokens, authorization headers, full paper text, and unbounded model reasoning.
- Reopening a draft never implies approval.
- The MCP confirmation response must include the digest that was shown; a boolean-only or stale response is rejected.

## Architecture

`paper-review/drafts/<task>.json` stores the candidate result and status. `paper-review/submitted/<task>.json` stores a redacted submission receipt only after success. `audit.jsonl` is append-only and contains event type, timestamp, profile id, task id, result status, and sanitized error code.

## Related files

Modify or create:

- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/skill/slr/SKILL.md`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/src/tools.ts`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/src/server.ts`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/cli/workspace.js`
- `E:/Scientific_Journal_Publication_Trend_Tracking_System/slr_skill_open_science/mcp/slr-agent-mcp/tests/`

## Implementation steps

1. Specify draft state transitions and terminal states.
2. Add the skill-level confirmation checklist and exact payload/digest preview policy.
3. Add/verify server-side elicitation, digest binding, and decline behavior.
4. Add redacted audit and receipt writers with bounded fields.
5. Test process interruption between each gate and after a successful POST.
6. Run a secret scan over source, test fixtures, package output, and generated artifacts.

## Todo list

- [x] Draft state machine documented.
- [x] Both confirmation gates tested.
- [x] Audit and receipt redaction tested.
- [ ] Duplicate submission and interrupted-flow behavior tested end-to-end through a packed install.

## Success criteria

- An unconfirmed review cannot reach the backend POST.
- A declined confirmation is visible to the user and resumable without data loss.
- A successful submission has a redacted local receipt and audit event.
- Automated checks find no token-like secret in package artifacts or logs.

## Risk assessment

- **Risk:** confirmation is bypassed by direct MCP invocation. **Mitigation:** enforce elicitation in the write tool itself, not only in the skill.
- **Risk:** a confirmation is replayed for a changed payload. **Mitigation:** one-request payload digest binding and fail-closed mismatch handling.
- **Risk:** audit files grow without bound. **Mitigation:** bound event fields and document rotation/retention without deleting active drafts.

## Security considerations

- Treat fulltext, title, and model-generated reasoning as untrusted data when building confirmation UI/messages.
- Escape control characters/newlines in JSONL audit fields.
- Never log request bodies on submit failures.

## Next steps

Phase 6 validates the packaged result through a clean-machine and Open-Science host acceptance matrix.
