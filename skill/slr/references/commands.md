# `/slr` command reference

## Menu

For `/slr` without arguments and for `/slr help`, show the same menu:

```text
SLR review menu
1. Check connection and assigned tasks (/slr status)
2. List assigned papers (/slr tasks)
3. Review a paper (/slr review next)
4. Run quick setup/check (/slr setup)
5. Show help (/slr help)
```

Use numbered choices as a fallback when the host does not provide command buttons.
`/slr help` must render this menu even when the host does not provide command buttons.

## Quick setup response

`/slr setup` must first perform exactly one read-only connection check using `list_assigned_tasks` with `limit: 1`. It does not install a package, change connector settings, or call a write tool.

When it succeeds, show:

```text
SLR setup ready
Project: <project name when available>
Assigned tasks: <count or none>
Next: /slr tasks or /slr review next
```

When it fails because the connector is missing or disconnected, show the minimum setup checklist:

```text
SLR setup is incomplete
1. Add/restart the local SLR connector.
2. Set SLR_API_BASE_URL in the connector environment.
3. Bind the Open-Science Access token Credential to SLR_AGENT_TOKEN.
4. Run /slr setup again.
```

Never request or display the raw project token in chat. Do not claim setup is ready until the read-only call succeeds.

If the user offers to paste a token into chat, decline that path and direct them to the connector's encrypted Access token Credential for `SLR_AGENT_TOKEN`. If the token was already pasted, do not echo or use it; recommend rotation in the SLR project settings.

## Status response

Call `list_assigned_tasks` with `limit: 1`. Report:

- connected or not connected;
- project name only when returned by the API;
- whether at least one `ASSIGNED` task exists;
- the next action.

Do not claim the local process is online independently of a successful read-only call.

## Task list response

Call `list_assigned_tasks` with the requested limit, defaulting to 25. Show task ID, status, paper title, year, journal, and full-text status when available. Preserve `nextCursor` internally and ask before loading another page.

Filter review selection to `status: ASSIGNED`. A completed task is informational only.

## Full-text response

When `get_task_fulltext` returns Markdown, summarize or quote only what is needed for the review. When it returns pending state, show:

```text
Full text is still processing. Retry after <retryAfterSeconds> seconds.
No submission was made.
```

For `404`, explain that the task or assigned paper is unavailable. For `409`, explain that Markdown is unavailable. Do not expose backend URLs or credentials.
