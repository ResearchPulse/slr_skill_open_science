# `/slr` command reference

## Menu

For `/slr` without arguments and for `/slr help`, show the same menu:

```text
SLR review menu
1. Check connection and assigned tasks (/slr status)
2. List assigned papers (/slr tasks)
3. Review a paper (/slr review next)
4. Configure or switch a project profile (/slr config)
5. Run quick setup/check (/slr setup)
6. Show help (/slr help)
```

Use the numbered choices as the normal command menu when the host does not provide command buttons.
`/slr help` must render this menu even when the host does not provide command buttons.

## Claude-compatible aliases

The Open-Science skill keeps the Claude command vocabulary:

| Command | Behavior |
|---|---|
| `/slr list` | Alias for `/slr tasks` |
| `/slr review [N|ids]` | Create drafts for eligible assigned tasks; never submit implicitly |
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
| Task details have full text available | `/slr review <taskId>` |
| Full text is processing | Retry after `retryAfterSeconds`; do not review yet |
| Full text is unavailable | Upload the paper PDF in the SLR web app, then retry `/slr task <taskId>` |
| Exact review draft is displayed | Reply `confirm` once or `cancel`; the digest call is handled automatically |

Do not suggest `/slr review` for unavailable or pending full text. Never suggest
`/slr submit` or `/slr auto` unless the user explicitly asks for that workflow.
Both still require the same confirmation-gated MCP write.

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

Never request or display the raw project token in chat. Do not claim setup is ready until the read-only call succeeds.

If the user uses `/slr config token <TOKEN>`, pass the token only to `slr_config_token`; never echo it, summarize it, put it in a draft, or return it in a tool result. If the token was exposed outside this internal command flow, recommend rotation in the SLR project settings.

## Config response

`/slr config` should use the separate `slr-config` connector and remain concise:

1. Call `slr_config_profiles`.
2. For plain `/slr config`, ask the user to choose or create a profile, then call `slr_config_validate`; the connector reads `SLR_AGENT_TOKEN` from the host credential binding.
3. For `/slr config token <TOKEN>`, call `slr_config_token` directly. It validates first, binds the encrypted credential, updates the profile, and enables both connectors without a second confirmation.
4. If `slr_config_token` reports multiple matching profiles, ask only for the safe profile name and retry with `profileName`; do not repeat the token in the response.

If the config connector is unavailable or returns `CREDENTIAL_MISSING`, report `CONFIG_CONNECTOR_UNAVAILABLE` or the credential error, ask the user to reconnect the connector or start a new conversation, and never claim a profile changed without a successful commit.

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

Call `list_assigned_tasks` with the requested limit, defaulting to 25. Show task ID, status, paper title, year, journal, and full-text status when available. Preserve `nextCursor` internally and ask before loading another page.

Filter review selection to `status: ASSIGNED`. A completed task is informational only.

End the response with a visible block like this, using only the applicable branch:

```text
Suggested next actions:
- /slr task <taskId> — inspect the selected paper
- If full text is available: /slr review <taskId>
- If full text is processing: retry after the returned delay
- If full text is unavailable: upload the PDF in the SLR web application
```

Do not suggest `/slr review` for unavailable or pending full text.

## Task detail response

After `/slr task <taskId>`, always show a visible `Suggested next actions` block:

```text
Suggested next actions:
- Full text available: /slr review <taskId>
- Full text processing: retry after <retryAfterSeconds> seconds
- Full text unavailable: upload the paper PDF, then retry /slr task <taskId>
```

Render only the branch that matches the returned full-text status.

## Full-text response

When `get_task_fulltext` returns Markdown, summarize or quote only what is needed for the review. When it returns pending state, show:

```text
Full text is still processing. Retry after <retryAfterSeconds> seconds.
No submission was made.

Suggested next actions:
- Retry /slr fulltext <taskId> after the delay.
- Or retry /slr task <taskId> after the delay.
```

For `404`, explain that the task or assigned paper is unavailable and suggest refreshing `/slr tasks`; do not suggest uploading a PDF for a missing task. For `409`, explain that Markdown is unavailable and suggest uploading the PDF in the SLR web application. Do not expose backend URLs or credentials.

For a `409` full-text-unavailable result, end with:

```text
Suggested next actions:
- Upload the paper PDF in the SLR web application.
- Retry /slr task <taskId> after the upload is complete.
```
