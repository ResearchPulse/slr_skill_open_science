# Phase 09 — Open-Science daemon auto-start

## Objective

Let the root `npx` setup complete connector registration without requiring the
user to open Open-Science first, when the Open-Science CLI is installed.

## Requirements

- Keep skill installation, profile/token storage, and API testing independent
  from the Open-Science daemon.
- Detect the installed `open-science` CLI and check daemon status.
- Start the daemon with `open-science start --no-open` when it is not running,
  then poll readiness with a short bounded timeout.
- Register/update and enable the connector only after the daemon is ready.
- Preserve a manual secret-free connector fallback when the CLI is missing or
  the daemon cannot start.
- Do not modify the backend, API contract, token handling, or four MCP tools.
- Keep human output concise and distinguish CLI missing, daemon start failure,
  and connector registration failure.

## Touchpoints

- `cli/slr.js` — CLI detection, daemon readiness, registration flow, output.
- `tests/setup-flow.test.mjs` — deterministic registration/startup cases.
- `README.md` and `docs/SLR_MCP_OPEN_SCIENCE_SETUP.md` — behavior and fallback.

## Acceptance criteria

- A running daemon is reused without issuing a second start command.
- A stopped daemon is started once and registration proceeds after readiness.
- A daemon that cannot become ready returns a bounded, actionable fallback.
- Missing CLI still installs the skill, tests the API, and writes manual config.
- Existing connector registration tests continue to pass.
