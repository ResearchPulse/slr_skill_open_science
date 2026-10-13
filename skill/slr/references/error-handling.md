# SLR MCP error handling

| Status/code | Action |
|---|---|
| `401` | Stop. Confirm the API base URL is `https://slr-api.hyperdatalab.org/api`, then retrieve the current `slrp_...` token from the same reviewer's project workspace. Rotating the token, disabling access, or switching agents invalidates the previous token. If the endpoint and current workspace token match, ask the SLR administrator to verify the agent connection is active. Never ask them to paste the token into chat. |
| `404` | Stop the current task. Refresh the task list; do not guess an ID. |
| `409 FULLTEXT_STAGE_REQUIRED` | Stop without retrying. Markdown was requested outside the `FULL_TEXT` stage or without the task's `markdownPath`; use task details to determine the allowed action. |
| Other `409` on full text | Explain that Markdown is unavailable; suggest uploading the PDF in the SLR web app and retrying the task; do not submit based on invented content. |
| `409` on submit | Treat as terminal. The task was already completed or changed; refresh before any further action. |
| `202` on a `FULL_TEXT` task | Wait at least `retryAfterSeconds`; suggest retrying the task/full-text command after that delay; do not poll in a tight loop. |
| `500`/`502` | Retry a read-only call once if the MCP client has already bounded the retry. For a write, report failure and do not repeat automatically. |
| timeout/unreachable | Check the local SLR MCP connector and profile binding. Do not expose the token, invoke a shell fallback, or send a direct API request from the skill. |

When a tool returns `isError: true`, preserve the actionable code and status but omit secrets, headers, raw URLs, and stack traces. Ask the user before retrying a failed read. Never retry a failed write automatically.
