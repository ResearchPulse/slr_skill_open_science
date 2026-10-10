# Security red-team report

## Scope

- `docs/open-science-architecture.md`
- `plans/261010-1908-open-science-mcp/plan.md` and all six phase files
- Current TypeScript MCP prototype under `mcp/slr-agent-mcp/src/`
- Current package metadata and lockfile

The review used four attacker lenses: external security adversary, supply-chain attacker, insider threat, and infrastructure attacker, followed by a STRIDE/OWASP pass.

## Summary

| Severity | Count | Release decision |
|---|---:|---|
| Critical | 0 | No immediate critical finding |
| High | 2 | Must be resolved before release |
| Medium | 5 | Must be scheduled; several are release gates |
| Low | 1 | Defense-in-depth |
| Info | 1 | Re-run dependency audit with registry access |

No hardcoded token, JWT, private key, or bearer secret was found in the scanned source. The current `npm audit --json --package-lock-only` could not reach the npm advisory endpoint, so dependency status is unverified rather than clean.

## Findings

### H-01 — Local credential fallback is not secure enough by specification

- **Location:** `docs/open-science-architecture.md:74-77`; `phase-02-profiles-workspace.md:26`
- **Persona:** Infrastructure attacker / insider
- **OWASP:** A02 Cryptographic Failures, A05 Security Misconfiguration
- **Problem:** “Protected local fallback” and restrictive permissions do not define encryption, key ownership, recovery, or behavior on platforms without reliable file permissions. A naive JSON token file would expose a project-scoped bearer token at rest.
- **Impact:** Token theft can access every assigned task and submit reviews for that project until rotation.
- **Required mitigation:** Use Open-Science native credential binding first. If unavailable, use an OS-backed secret store such as Windows Credential Manager/DPAPI, macOS Keychain, or Linux Secret Service. If no secure store exists, do not persist the token and require a one-session environment binding/manual connector import. Add a fail-closed test.

### H-02 — Mutable GitHub `npx` source is a supply-chain trust boundary

- **Location:** `plan.md:18`; `phase-01-package-installer.md:19`
- **Persona:** Supply-chain attacker
- **OWASP:** A08 Software and Data Integrity Failures, A06 Vulnerable Components
- **Problem:** `npx github:<org>/slr_skill_open_science` resolves repository content that can change on the default branch. The installer executes local package code before a user can inspect it.
- **Impact:** A compromised repository, maintainer account, or release path can exfiltrate connector credentials or alter the submission flow.
- **Required mitigation:** Document immutable release tags/commit refs for production setup, pin dependency lockfiles, print the resolved version/commit before mutation, and provide a checksum/release verification step. Keep the unpinned command only for development.

### M-01 — MCP confirmation accepts only a boolean, not the approved payload

- **Location:** `mcp/slr-agent-mcp/src/tools.ts:112-127`
- **Persona:** External attacker / confused deputy
- **OWASP:** A04 Insecure Design, A01 Broken Access Control
- **Problem:** The second gate validates `{ confirm: true }`, but does not bind the approval to a canonical hash of profile, task, decision, reasoning, and data.
- **Impact:** A host or future refactor could display one draft and submit another while still returning an accepted confirmation.
- **Required mitigation:** Canonicalize the exact submit payload, compute a short confirmation digest, display it in the elicitation, and require the digest in the accepted response. Recompute and compare immediately before POST; reject mismatch.

### M-02 — Response bodies are unbounded

- **Location:** `mcp/slr-agent-mcp/src/http-client.ts:61`, `:70`, `:134-153`
- **Persona:** External backend/proxy attacker
- **OWASP:** A05 Security Misconfiguration, A06/A04 availability impact
- **Problem:** JSON errors, JSON envelopes, and ready fulltext use `response.text()` without a byte limit. `MAX_RESULT_BODY_BYTES` limits only the outgoing review body.
- **Impact:** A compromised/misbehaving endpoint can cause memory pressure or process termination through a large response.
- **Required mitigation:** Add separate bounded response limits for JSON and Markdown, read streams with byte counters, abort over-limit responses, and test 413-style local errors. Keep the fulltext limit configurable but bounded.

### M-03 — Confirmation text can be manipulated by control characters or prompt injection

- **Location:** `mcp/slr-agent-mcp/src/tools.ts:39-46`; `skill/slr/SKILL.md` safety policy
- **Persona:** External adversary through paper/task content
- **OWASP:** A03 Injection, A04 Insecure Design
- **Problem:** Raw task id, decision, and a reasoning preview are interpolated into the host confirmation message. Newlines or instruction-like text can visually alter the confirmation context.
- **Impact:** The user may confirm a misleading or incorrectly scoped write.
- **Required mitigation:** Use structured confirmation fields, escape/control-strip display values, bound each field, show active profile/project and payload digest, and label all paper/model text as untrusted evidence.

### M-04 — Arbitrary HTTPS base URLs and raw unknown errors widen disclosure/SSRF risk

- **Location:** `mcp/slr-agent-mcp/src/config.ts:15-32`; `src/errors.ts:44-50`
- **Persona:** Infrastructure attacker / malicious local config
- **OWASP:** A01 Broken Access Control, A10 SSRF, A05 Misconfiguration
- **Problem:** Any HTTPS hostname is accepted, URL userinfo is not rejected, and unknown error messages are returned after only token-string replacement.
- **Impact:** A poisoned profile can redirect the bearer token to an unintended HTTPS service; malformed URLs or network errors may disclose credentials embedded in URL userinfo or local paths.
- **Required mitigation:** Reject URL username/password, query, and fragment components; require explicit trusted backend host configuration or an explicit user-reviewed allowlist; block non-loopback private/link-local destinations where feasible; sanitize unknown errors to stable codes/messages.

### M-05 — Runtime review files need stronger filesystem isolation

- **Location:** `phase-02-profiles-workspace.md:27-33`, `:47-52`
- **Persona:** Insider / local process attacker
- **OWASP:** A01 Broken Access Control, A08 Integrity Failures
- **Problem:** The plan specifies workspace names but not symlink handling, path canonicalization, concurrent writers, or per-profile roots.
- **Impact:** A malicious or accidental path can overwrite files outside `paper-review`, or one profile can read another profile’s drafts/audit trail.
- **Required mitigation:** Resolve and validate paths under a profile-owned root, reject symlink escapes, use atomic exclusive writes, include profile id in the root, and test concurrent/partial writes.

### L-01 — Local `audit.jsonl` is not tamper-evident

- **Location:** `phase-05-safety-audit.md:34`
- **Persona:** Insider
- **OWASP:** A09 Security Logging and Monitoring Failures
- **Problem:** Append-only behavior in a local user-writable file does not prove historical integrity.
- **Impact:** A user with filesystem access can edit the local audit trail.
- **Required mitigation:** Treat the local audit as a convenience/resume log, not authoritative compliance evidence. Use backend submission state as the source of truth and optionally add hash chaining as defense-in-depth.

### I-01 — Dependency vulnerability status is currently unknown

- **Location:** `mcp/slr-agent-mcp/package-lock.json`
- **Persona:** Supply-chain attacker
- **Problem:** `npm audit` could not contact the npm advisory endpoint in this environment.
- **Required mitigation:** Re-run `npm audit --json --package-lock-only` in CI or a network-enabled release environment and record the result before publishing.

## Coverage

- STRIDE: Spoofing covered; Tampering covered; Repudiation covered; Information Disclosure covered; Denial of Service covered; Elevation of Privilege covered.
- OWASP: A01–A10 considered. The most material gaps are A01, A02, A04, A05, A06, A08, A09, and A10.

## Release gate

Do not publish or enable write operations until H-01 and H-02 are resolved and M-01 through M-05 have explicit tests or documented accepted risk. No automatic fixes were applied during this review.
