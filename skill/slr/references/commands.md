# `/slr` command reference

## Menu

For `/slr` without arguments, show:

```text
SLR review menu
1. Check connection and assigned tasks (/slr status)
2. List assigned papers (/slr tasks)
3. Review a paper (/slr review next)
4. Show setup instructions (/slr setup)
5. Show help (/slr help)
```

Use numbered choices as a fallback when the host does not provide command buttons.

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
