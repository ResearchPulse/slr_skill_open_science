# `/slr` command reference

## Menu

For `/slr` without arguments and for `/slr help`, show the same menu:

```text
SLR review menu
1. Check connection and assigned tasks (/slr status)
2. List assigned papers (/slr tasks)
3. Review a paper (/slr review next)
4. Extract a paper (/slr extract <taskId>)
5. Configure or switch a project profile (/slr config)
6. Run quick setup/check (/slr setup)
7. Show help (/slr help)
```

Use the numbered choices as the normal command menu when the host does not provide command buttons.
`/slr help` must render this menu even when the host does not provide command buttons.

## Claude-compatible aliases

The Open-Science skill keeps the Claude command vocabulary:

| Command | Behavior |
|---|---|
| `/slr list` | Alias for `/slr tasks` |
| `/slr review [N|ids]` | Create drafts for eligible assigned tasks; never submit implicitly |
| `/slr extract <taskId>` | Extract one assigned `taskKind: extraction` task with evidence coordinates and one confirmation |
| `/slr drafts` | Show local drafts only |
| `/slr edit <taskId> <instruction>` | Revise a local draft and show the exact new payload |
| `/slr submit [ids]` | Confirm a selected draft batch once, then use the digest-bound MCP write |
| `/slr auto [N]` | Explicit opt-in batch review and submission with one confirmation |
| `/slr mcp` | Run the bounded `connection_test` health check |
| `/slr diag` | Show safe MCP/profile diagnostics; no terminal or direct-API fallback |
| `/slr config show|url|use|test|remove` | Use the safe config connector operations |

## Suggested next actions

Append one concise block to command responses. These are guidance only; they do not call tools automatically.

```text
Suggested next actions:
- /slr tasks — list assigned papers
- /slr review next — review the first ASSIGNED paper
```

Use these state-specific variants:

| Current result | Suggested action |
|---|---|
| Setup/status succeeds with assigned tasks | `/slr tasks` or `/slr review next` |
| Setup/status succeeds with no assigned tasks | Assign a paper in the SLR web app, then `/slr tasks` |
| TITLE_ABSTRACT task is assigned | `/slr review <taskId>` using title and abstract |
| FULL_TEXT is available | `/slr review <taskId>` |
| FULL_TEXT is processing | Retry after `retryAfterSeconds`; do not review yet |
| FULL_TEXT is unavailable | Upload the paper PDF in the SLR web app, then retry `/slr task <taskId>` |
| Exact review draft is displayed | Reply `confirm` once or `cancel`; the digest call is handled automatically |

Do not suggest `/slr review` for FULL_TEXT tasks with unavailable or pending Markdown. Never suggest
`/slr submit` or `/slr auto` unless the user explicitly asks for that workflow.
Both still require the same confirmation-gated MCP write.

For extraction tasks, suggest `/slr extract <taskId>` instead of `/slr review`. The extraction flow requires explicit `taskKind: "extraction"`, uses the template snapshot/version, normalized Markdown source asset/revision/hash, bounded offsets, isolated draft storage, deterministic checks, and one confirmation before `submit_extraction_draft`. The result is a pending proposal for human promotion. Leader consensus uses `finalize_extraction_consensus`, which records a proposal rather than finalizing consensus.

## Review confirmation response

The skill shows the exact payload, including the agent's reasoning/reason-comment, before the first submission call. The user sees one confirmation prompt:

```text
Reply `confirm` once to record this result, or `cancel` to stop.
The connector digest step will be handled automatically.
```

After `confirm`, call `submit_review_result` with the unchanged payload. If it returns `CONFIRMATION_REQUIRED`, immediately call it again with the returned digest. Never ask the user to confirm the digest separately.

After a successful submission:

```text
Suggested next actions:
- /slr tasks — choose the next assigned paper
- /slr status — refresh project state
```

## Quick setup response

`/slr setup` must first perform exactly one bounded read-only connection check using `connection_test`. It does not install a package, change connector settings, or call a write tool.

When it succeeds, show:

```text
SLR setup ready
Project: <project name when available>
Assigned tasks: <count or none>
Next: /slr tasks or /slr review next
```

If `Assigned tasks` is `none`, replace the next line with:

```text
Next: Assign a paper in the SLR web application, then run /slr tasks
```

When it fails because the connector is missing or disconnected, show only:

```text
SLR setup is incomplete
Reconnect the SLR review connector, then run /slr setup again.
```

The user may provide the project token directly in chat using `/slr config token <TOKEN>`. Do not redirect them to a terminal or hidden prompt. Do not claim setup is ready until the read-only connection check succeeds.

If the user uses `/slr config token <TOKEN>`, pass the supplied token only to `slr_config_token`. It is permitted to receive the project token in chat for this explicit configuration command; do not redirect the user to a terminal or connector settings. Do not unnecessarily repeat it in replies or put it into unrelated tools, drafts, or results. The production API base URL is `https://slr-agent.hyperdatalab.org/api`. Rotation, disabling access, or switching agents invalidates the prior value. If the tool returns `ok: false`, show its safe `connection.status`, `connection.code`, and `connection.message` (or `error.code` and `error.message`) so the user can see why it failed. If the current token still gets `401`, report that the API rejected it for this endpoint.

## Config response

`/slr config` should use the separate `slr-config` connector and remain concise:

1. Call `slr_config_profiles`.
2. For `/slr config url <URL>`, call `slr_config_url` directly. It saves the URL to the active profile without needing a token or credential binding.
3. For `/slr config token <TOKEN>`, call `slr_config_token` directly. It validates the token supplied in chat, binds the host-managed credential automatically, updates the profile, and enables both connectors without a second confirmation.
4. If `slr_config_token` reports multiple matching profiles, ask only for the safe profile name and retry with `profileName`; do not repeat the token in the response.

If the config connector is unavailable, report `CONFIG_CONNECTOR_UNAVAILABLE` and never claim a profile changed without a successful tool result.

```text
SLR profile configured
Profile: <name>
Project: <project name or id>
Connector: <enabled|reconnect required>

Suggested next actions:
- Restart/reconnect the connector if requested
- /slr status — verify the read-only connection
```

For plain `/slr config`, when a token matches another local profile, show one choice only: `Token belongs to profile <name>. Switch to it?` The explicit `/slr config token <TOKEN>` command is itself the user's confirmation and applies an unambiguous switch/update/save without a second prompt. If multiple safe profiles match, ask the user to choose a profile name and retry. Do not display the token or expose the pending operation secret. Report `reconnect required` until `/slr status` succeeds after the connector restart.

## Status response

Call `list_assigned_tasks` with `limit: 1`. Report:

- connected or not connected;
- project name only when returned by the API;
- whether at least one `ASSIGNED` task exists;
- the next action.

Do not claim the local process is online independently of a successful read-only call.

## Task list response

Call `list_assigned_tasks` with the requested limit, defaulting to 25. Show task ID, status, stage, paper title, year, journal, and full-text status when available. Preserve `nextCursor` internally and ask before loading another page.

Filter review selection to `status: ASSIGNED`. A completed task is informational only.

End the response with a visible block like this, using only the applicable branch:

```text
Suggested next actions:
- /slr task <taskId> — inspect the selected paper
- For TITLE_ABSTRACT: /slr review <taskId> using title and abstract
- For FULL_TEXT with Markdown ready: /slr review <taskId>
- For FULL_TEXT processing or unavailable: wait the returned delay or upload the PDF
```

Do not suggest `/slr review` for a FULL_TEXT task with unavailable or pending Markdown. A TITLE_ABSTRACT task may be reviewed from its title and abstract regardless of full-text status.

## Task detail response

After `/slr task <taskId>`, always show a visible `Suggested next actions` block:

```text
Suggested next actions:
- TITLE_ABSTRACT: /slr review <taskId> using title and abstract
- FULL_TEXT with Markdown available: /slr review <taskId>
- FULL_TEXT processing: retry after <retryAfterSeconds> seconds
- FULL_TEXT unavailable: upload the paper PDF, then retry /slr task <taskId>
```

Render only the branch that matches the task stage and returned status. For FULL_TEXT, call `get_task_fulltext` only if `stage` is `FULL_TEXT` and `markdownPath` is present; pass the exact returned values. Never construct a Markdown URL or retry `409 FULLTEXT_STAGE_REQUIRED`.

## Full-text response

When `get_task_fulltext` returns Markdown, summarize or quote only what is needed for the review. When it returns pending state, show:

```text
Full text is still processing. Retry after <retryAfterSeconds> seconds.
No submission was made.

Suggested next actions:
- Retry /slr fulltext <taskId> after the delay.
- Or retry /slr task <taskId> after the delay.
```

For `404`, explain that the task or assigned paper is unavailable and suggest refreshing `/slr tasks`; do not suggest uploading a PDF for a missing task. For `409 FULLTEXT_STAGE_REQUIRED`, stop without retrying; this indicates Markdown was requested outside the permitted FULL_TEXT task/path. For other full-text `409` errors, explain that Markdown is unavailable and suggest uploading the PDF in the SLR web application. Do not expose backend URLs or credentials.

For a `409` full-text-unavailable result, end with:

```text
Suggested next actions:
- Upload the paper PDF in the SLR web application.
- Retry /slr task <taskId> after the upload is complete.
```
