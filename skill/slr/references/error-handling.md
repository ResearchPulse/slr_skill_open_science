# SLR MCP error handling

| Status/code | Action |
|---|---|
| `401` | Stop. Ask the user to check local connector token or rotate it in SLR settings. Never ask them to paste it into chat. |
| `404` | Stop the current task. Refresh the task list; do not guess an ID. |
| `409` on full text | Explain that Markdown is unavailable; suggest uploading the PDF in the SLR web app and retrying the task; do not submit based on invented content. |
| `409` on submit | Treat as terminal. The task was already completed or changed; refresh before any further action. |
| `202` | Wait at least `retryAfterSeconds`; suggest retrying the task/full-text command after that delay; do not poll in a tight loop. |
| `500`/`502` | Retry a read-only call once if the MCP client has already bounded the retry. For a write, report failure and do not repeat automatically. |
| timeout/unreachable | Check `SLR_API_BASE_URL` and local MCP process. Do not expose the token while diagnosing. |

When a tool returns `isError: true`, preserve the actionable code and status but omit secrets, headers, raw URLs, and stack traces. Ask the user before retrying a failed read. Never retry a failed write automatically.
