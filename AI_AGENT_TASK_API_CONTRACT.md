# AI Agent Task API Contract

This contract describes the reviewer-owned AI review workspace and how an external AI agent retrieves review tasks, reads paper content, and submits recommendations. Agent recommendations remain separate from official human screening decisions.

## 1. Base URL and authentication

Use the backend API base URL, for example:

```text
https://<backend-host>/api
```

Screening and reviewer extraction endpoints require the reviewer/project-scoped token issued when a Human Reviewer connects the agent from their screening workspace. Leader-only consensus endpoints require a separate project-scoped token provisioned with the `extraction:leader` capability. Send the applicable token as a bearer token:

```http
Authorization: Bearer <project-agent-token>
```

Reviewer tokens scope requests to one agent, one project, and one reviewer workspace. Leader tokens scope requests to one agent and project and can see only server-owned leader extraction tasks. The server rejects inactive or capability-mismatched tokens and does not return tasks belonging to another reviewer or project. Never put the token in source code or logs.

All JSON success responses use this envelope:

```json
{
  "success": true,
  "data": {}
}
```

Errors use:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

## 2. Reviewer workspace endpoints

All endpoints below use the authenticated user's Firebase token and require the project `REVIEWER` role. A reviewer can connect catalog agents and manage only their own agent access and tasks.

| Method and path | Purpose |
| --- | --- |
| `GET /api/projects/{projectId}/ai-review/agents` | List catalog agents and this reviewer's project connections |
| `POST /api/projects/{projectId}/ai-review/agents` | Connect a catalog agent; returns a reviewer scoped `accessToken` |
| `GET /api/projects/{projectId}/ai-review/agents/{agentId}/token` | Retrieve this reviewer's current token (`Cache-Control: no-store`) |
| `POST /api/projects/{projectId}/ai-review/agents/{agentId}/rotate-token` | Rotate this reviewer's token and invalidate its previous value |
| `PATCH /api/projects/{projectId}/ai-review/agents/{agentId}` | Enable or disable this reviewer's agent access |
| `POST /api/projects/{projectId}/ai-review/agents/{agentId}/tasks` | Create a task for a paper assigned to this reviewer |
| `GET /api/projects/{projectId}/ai-review/agents/{agentId}/tasks` | List this reviewer's tasks for the selected agent |
| `DELETE /api/projects/{projectId}/ai-review/agents/{agentId}/tasks/{taskId}` | Remove a pending task owned by this reviewer |
| `GET /api/projects/{projectId}/ai-review/tasks?paperIds={id}` | List this reviewer's agent results for selected papers |

Create task body:

```json
{
  "paperId": "paper-id",
  "stage": "TITLE_ABSTRACT",
  "taskKind": "screening",
  "instructions": "Assess each protocol criterion and cite evidence."
}
```

`stage` is `TITLE_ABSTRACT` or `FULL_TEXT` (default `TITLE_ABSTRACT`), and `taskKind` is `screening` or `extraction` (default `screening`). A screening task at `FULL_TEXT` can be created only when the paper status is `SCREENING_FULL_TEXT`, meaning both Title & Abstract votes passed it to full-text eligibility (or a leader resolved it into that stage), and an attached PDF exists. Otherwise the API returns `409 FULLTEXT_STAGE_NOT_READY`, `FULLTEXT_NOT_AVAILABLE`, or `FULLTEXT_UNAVAILABLE`. Extraction that is pending or processing is allowed; the agent receives `202` and `Retry-After` when it requests Markdown. `TITLE_ABSTRACT` tasks use only the title and abstract. Extraction tasks must set `taskKind: "extraction"` explicitly; they are created only for an `INCLUDED` paper assigned to the reviewer with a canonical extraction template snapshot. A task stores its reviewer owner, stage, kind, and a snapshot of the project's research questions and eligibility criteria at assignment time. Reviewers can only assign papers in their human assignment list. Completed tasks cannot be removed.

Agent access management and task creation through former owner-facing `/api/projects/{projectId}/agents` mutations are disabled. Project Leaders continue to assign papers to Human Reviewers and can monitor AI task progress.

## 3. Retrieve a page of assigned tasks

```http
GET /api/agent/v1/tasks?stage=TITLE_ABSTRACT&limit=25&cursor=<nextCursor>
```

Query parameters:

| Parameter | Required | Rules |
| --- | --- | --- |
| `limit` | No | Integer from 1 to 100; defaults to 50 |
| `cursor` | No | `nextCursor` returned by the previous page; cursor must belong to this token's reviewer and project scope |
| `stage` | No | `TITLE_ABSTRACT` or `FULL_TEXT`; returns only screening tasks for that round. When paginating a stage-filtered list, reuse a cursor returned for that same stage. Omit to list all task stages visible to the token. |

The `stage` filter is available on reviewer-scoped screening tokens. A project/leader token receives `400` if it sends this filter because those tokens do not retrieve reviewer screening tasks. Pending tasks from a stage the paper has already left are omitted; completed tasks remain available as history.

Example:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  "$API_BASE_URL/agent/v1/tasks?limit=25"
```

Response shape:

```json
{
  "success": true,
  "data": {
    "project": {
      "id": "project-id",
      "name": "Example review",
      "researchQuestions": [],
      "inclusionCriteria": [],
      "exclusionCriteria": []
    },
    "items": [
      {
        "id": "task-id",
        "agentId": "agent-id",
        "projectId": "project-id",
        "projectName": "Example review",
        "paperId": "paper-id",
        "reviewerId": "reviewer-user-id",
        "taskKind": "screening",
        "stage": "TITLE_ABSTRACT",
        "reviewPolicy": {
          "role": "ADVISORY_ONLY",
          "consensusEligible": false,
          "humanDecisionRequired": true,
          "stage": "TITLE_ABSTRACT",
          "scope": "Assess title and abstract only. ADVANCE_TO_FULL_TEXT means the paper needs full-text eligibility review; it is not final inclusion.",
          "allowedRecommendations": ["ADVANCE_TO_FULL_TEXT", "EXCLUDE", "UNCERTAIN"]
        },
        "paperTitle": "Paper title",
        "instructions": "Review against the project's criteria.",
        "protocolSnapshot": {
          "version": "2026-10-09T10:00:00.000Z",
          "capturedAt": "2026-10-09T10:00:00.000Z",
          "researchQuestions": [],
          "inclusionCriteria": [],
          "exclusionCriteria": []
        },
        "status": "ASSIGNED",
        "createdAt": "2026-10-09T10:00:00.000Z",
        "createdBy": "reviewer-user-id",
        "paper": {
          "id": "paper-id",
          "title": "Paper title",
          "abstract": "Paper abstract",
          "authors": [{ "name": "Author Name" }],
          "doi": "10.1234/example",
          "year": 2024,
          "journal": "Example Journal",
          "source": "PDF",
          "fullTextStatus": "COMPLETED"
        }
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

`project` contains current review context once per page. Each item contains its task-time `protocolSnapshot`, instructions, and a bibliographic summary so the agent does not need one metadata request per task. The snapshot is authoritative if the protocol changes after assignment. Screening items include `reviewPolicy` with `role: "ADVISORY_ONLY"`, `consensusEligible: false`, `humanDecisionRequired: true`, stage-specific scope, and `allowedRecommendations`. At `TITLE_ABSTRACT`, allowed recommendations are `ADVANCE_TO_FULL_TEXT`, `EXCLUDE`, and `UNCERTAIN`; advancing only requests the next review round and is not final inclusion. At `FULL_TEXT`, allowed recommendations are `INCLUDE`, `EXCLUDE`, and `UNCERTAIN`. For compatibility, stage-less legacy screening tasks are normalized to `FULL_TEXT` in the response; their `reviewPolicy.stage` and `stage` agree, and they may include `markdownPath`. **Only request Markdown when the task has `stage: "FULL_TEXT"` and includes `markdownPath`.** For title/abstract tasks, do not construct or call the Markdown URL; a `409 FULLTEXT_STAGE_REQUIRED` is an expected stage restriction and should not be retried. `paper.authors` may contain strings or objects with a `name` field. `paper.fullTextStatus` reflects the current extraction status; it may be `PENDING`, `PROCESSING`, `COMPLETED`, `PARTIAL`, `FAILED`, or `UNAVAILABLE` depending on the paper record.

Task `status` is `ASSIGNED` until a result is accepted, then `COMPLETED`. A completed task may also contain `completedAt` and `result`.

Continue while `hasMore` is `true`, passing `nextCursor` as `cursor`. Stop when `hasMore` is `false` or `nextCursor` is `null`.

## 4. Retrieve one task

```http
GET /api/agent/v1/tasks/{taskId}
```

This returns `{ "task": ..., "project": ..., "paper": ... }` inside `data`. Use it to refresh an individual task or retrieve its review context. Screening tasks include the same stage-specific `reviewPolicy` as the task list. The task must be assigned to this token's agent, reviewer workspace, and project; otherwise the API returns `404`. If an assigned task is still pending after its paper has moved to another stage, the API returns `409 TASK_STAGE_INACTIVE`; completed tasks remain readable as history. Use the task's `protocolSnapshot` as the criteria of record for this analysis.

## 5. Retrieve full-text Markdown

```http
GET /api/agent/v1/tasks/{taskId}/markdown
```

On success, the body is the paper's Markdown (`Content-Type: text/markdown; charset=utf-8`). The API checks task ownership and project scope on every request. It does not expose a Cloudinary URL.

| HTTP status | Meaning |
| --- | --- |
| `200` | Markdown is ready for a `FULL_TEXT` task; response body is Markdown text |
| `202` | GROBID extraction is pending for a `FULL_TEXT` task; response includes `Retry-After: 10` and a JSON status envelope |
| `404` | Task, assigned paper, or PDF does not exist for this token |
| `409` | Task stage is inactive (`TASK_STAGE_INACTIVE`), task is not at `FULL_TEXT` stage (`FULLTEXT_STAGE_REQUIRED`), or Markdown is unavailable/extraction failed (`FULLTEXT_UNAVAILABLE`) |
| `502` | Backend could not retrieve the Markdown asset |

When a response is `202`, wait at least the number of seconds in `Retry-After` before trying again. Do not repeatedly poll faster than that. `PARTIAL` Markdown is not extractable; wait for a `COMPLETED` source revision.

## 6. Submit an AI recommendation

```http
POST /api/agent/v1/tasks/{taskId}/result
Content-Type: application/json
```

Request body:

```json
{
  "decision": "ADVANCE_TO_FULL_TEXT",
  "reasoning": "The study matches the population and intervention criteria because ...",
  "data": {
    "population": "...",
    "evidence": ["..."],
    "confidence": 0.91
  }
}
```

`decision` is a required non-empty string (maximum 100 characters), validated against the task stage:

| Task stage | Accepted decisions | Interpretation |
| --- | --- | --- |
| `TITLE_ABSTRACT` | `ADVANCE_TO_FULL_TEXT`, `EXCLUDE`, `UNCERTAIN` | Recommend whether the assigned reviewer should advance the paper for full-text assessment. Legacy `INCLUDE` is accepted as an alias and normalized to `ADVANCE_TO_FULL_TEXT`. |
| `FULL_TEXT` | `INCLUDE`, `EXCLUDE`, `UNCERTAIN` | Recommend the final full-text eligibility outcome. |

Other stage/decision combinations return `400`. `reasoning` is required (maximum 16,000 characters) and serves as the agent's explanation. `data` is optional and must be a JSON object; use it for criterion assessments and evidence. The complete normalized result must not exceed 30 KB. A successful saved result is tagged with `kind: "ADVISORY_RECOMMENDATION"`, its `stage`, and `consensusEligible: false`. Submitting this result completes only the AI task: it does not create a human screening decision, change paper status, or create a Human-vs-Human conflict. Each of the two assigned Human Reviewers must still submit their own vote; AI results never count toward reviewer quorum or leader conflict resolution.

Successful submission returns HTTP `200`, the updated task, and sets its status to `COMPLETED`. A completed task cannot be submitted again; the API returns `409`.

## 7. Phase-2 extraction agent contract

Extraction tasks are marked with `taskKind: "extraction"`. They use the same reviewer-scoped agent token as screening tasks, but the screening detail, Markdown, and result endpoints reject them with `409 EXTRACTION_TASK_REQUIRED`. A bounded server migration backfills only legacy tasks with an unambiguous screening shape; missing or ambiguous task kinds return `409 TASK_KIND_REQUIRED` and are never defaulted during a request.

Create an extraction task from the reviewer workspace by adding `taskKind: "extraction"` to the existing task body. The paper must be `INCLUDED`, have a canonical `extractionAssignments/{paperId}` record containing the reviewer, and have an available template snapshot.

| Method and path | Purpose |
| --- | --- |
| `GET /api/agent/v1/extraction/tasks/{taskId}/context` | Read the assigned extraction task, assignment, immutable template snapshot, paper metadata, and isolated agent draft |
| `GET /api/agent/v1/extraction/tasks/{taskId}/fulltext` | Read normalized Markdown, source asset/revision/hash, and paragraph offset coordinates |
| `PUT /api/agent/v1/extraction/tasks/{taskId}/draft` | Save an isolated field-value/evidence draft; canonical reviewer records are untouched |
| `POST /api/agent/v1/extraction/tasks/{taskId}/check` | Run deterministic value and evidence checks |
| `POST /api/agent/v1/extraction/tasks/{taskId}/submit-challenge` | Create a short-lived one-time submit challenge |
| `POST /api/agent/v1/extraction/tasks/{taskId}/submit` | Consume the challenge and create an isolated pending reviewer proposal idempotently; canonical records remain untouched |
| `POST /api/agent/v1/extraction/tasks/{taskId}/consensus-challenge` | Leader-only challenge for a consensus proposal |
| `POST /api/agent/v1/extraction/tasks/{taskId}/consensus-proposal` | Leader-only proposal write; official finalization remains separately gated |

`check` returns a versioned `PASS`, `WARN`, or `BLOCK` result. A reviewer proposal cannot be challenged while the current draft has no non-blocking check. The human web workflow promotes a pending proposal with `POST /api/projects/{projectId}/papers/{paperId}/agent-proposals/{proposalId}/promote`; this route is Firebase-authenticated and is the only step that writes the canonical reviewer or consensus record.

Consensus agents are provisioned separately with the server-owned `extraction:leader` capability and a leader task. A reviewer-scoped task cannot call either consensus route. Legacy task repair is an explicit admin operation at `POST /api/admin/agents/{agentId}/migrate-task-kinds`; it reports migrated and rejected counts and is never performed implicitly by a read request.

Evidence references carry `sourceAssetId`, `sourceRevision`, `sourceHash`, normalized Markdown `startOffset`/`endOffset`, a bounded `quote`, and `quoteHash`. Optional `pdfPage` metadata is supplemental and never replaces normalized offsets. Quotes must match the source hash and exact offsets or the API returns `400 INVALID_EVIDENCE`.

The draft is stored under a task/agent/reviewer-scoped extraction namespace and includes the source asset, source revision/hash, template version, and canonical `baseVersion`. The submit challenge binds the exact draft payload digest and expires after ten minutes. A second confirmation is not required from the user: the MCP tool performs the backend challenge handshake internally after the single explicit confirmation. The result is `PENDING_HUMAN_PROMOTION`; it is not an official reviewer submission. If the source revision or canonical reviewer version changed, submission fails with a conflict and the human web workflow remains the only canonical writer.

### MCP tool mapping

The Open-Science adapter exposes `get_extraction_context`, `get_extraction_fulltext`, `save_extraction_draft`, `check_extraction_draft`, `submit_extraction_draft`, and `finalize_extraction_consensus`. The last name is retained for compatibility but creates or updates a leader consensus proposal; it does not finalize canonical consensus. `submit_extraction_draft` and `finalize_extraction_consensus` each require one explicit user confirmation and perform the backend challenge/idempotency handshake internally.

## 8. Common HTTP errors

| HTTP status | Typical cause |
| --- | --- |
| `400` | Invalid `limit`, cursor, or result body |
| `401` | Missing, malformed, rotated, or inactive token. Copy the current reviewer workspace token and update the MCP connection. |
| `404` | Task does not exist or is outside the token's agent/project scope |
| `409` | Task already completed, task stage is no longer active (`TASK_STAGE_INACTIVE`), Full Text task created before eligibility (`FULLTEXT_STAGE_NOT_READY`), PDF missing (`FULLTEXT_NOT_AVAILABLE`), wrong task kind, or full-text content unavailable |
| `500` | Unexpected backend error; retry with backoff |
| `502` | Backend could not read a paper asset |

## 9. Recommended agent workflow

1. Request a task page for a single stage (`stage=TITLE_ABSTRACT` or `stage=FULL_TEXT`) and retain `nextCursor` for pagination. Call separately for each round so one round's cursor cannot mix with the other.
2. Process only tasks with `status: "ASSIGNED"` and follow `reviewPolicy.scope` and `allowedRecommendations`.
3. At `TITLE_ABSTRACT`, assess only title and abstract and return `ADVANCE_TO_FULL_TEXT`, `EXCLUDE`, or `UNCERTAIN`. Do not call the Markdown endpoint or describe an advance recommendation as final inclusion.
4. At `FULL_TEXT`, fetch `markdownPath` to read the paper. If extraction is pending or processing, the endpoint returns `202`; wait for `Retry-After` and retry. If `paper.fullTextStatus` is `FAILED` or `UNAVAILABLE`, submit `UNCERTAIN` with a clear explanation and `data.fullTextAvailability` so the task is closed without pretending the full text was reviewed. Otherwise use `INCLUDE`, `EXCLUDE`, or `UNCERTAIN` based on the paper.
5. Include criterion-level evidence in `data` and a concise rationale in `reasoning`. Submit one recommendation for each completed task. Human reviewers still make and submit the official votes; agents never count toward quorum.

Swagger UI is available at `/api-docs`; the OpenAPI JSON is at `/api-docs.json`.
