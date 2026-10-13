# AI Agent Task API Contract

This contract describes the reviewer-owned AI review workspace and how an external AI agent retrieves review tasks, reads paper content, and submits recommendations. Agent recommendations remain separate from official human screening decisions.

## 1. Base URL and authentication

Use the backend API base URL, for example:

```text
https://<backend-host>/api
```

Every agent endpoint requires the reviewer and project scoped token issued when a Human Reviewer connects the agent from their screening workspace. Send it as a bearer token:

```http
Authorization: Bearer <project-agent-token>
```

The token scopes requests to one agent, one project, and one reviewer workspace. The server rejects inactive tokens and does not return tasks belonging to another reviewer or project. Never put the token in source code or logs.

For the production SLR deployment, use `https://slr-agent.hyperdatalab.org/api` as the API base URL. The token must be the current `slrp_...` token shown in the same reviewer's **My AI review workspace** for the intended project. Rotating the token, disabling access, or switching agents invalidates the old token; retrieve the current token from that workspace before configuring it with `/slr config token <TOKEN>`.

Deployment check (2026-10-13): `https://slr-agent.hyperdatalab.org/api/health` responds successfully. The current token supplied by the user returned HTTP `200` and assigned tasks at this host, while the same token returned `401 UNAUTHORIZED` at `slr-api.hyperdatalab.org`. The local `default` profile was still pointing at the old `slr-api` host. Set the URL in chat with `/slr config url https://slr-agent.hyperdatalab.org/api`.

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
  "instructions": "Assess each protocol criterion and cite evidence."
}
```

`stage` is `TITLE_ABSTRACT` or `FULL_TEXT` (default `TITLE_ABSTRACT`). A task stores its reviewer owner, stage, and a snapshot of the project's research questions and eligibility criteria at assignment time. Reviewers can only assign papers in their human assignment list. Completed tasks cannot be removed.

Agent access management and task creation through former owner-facing `/api/projects/{projectId}/agents` mutations are disabled. Project Leaders continue to assign papers to Human Reviewers and can monitor AI task progress.

## 3. Retrieve a page of assigned tasks

```http
GET /api/agent/v1/tasks?limit=25&cursor=<nextCursor>
```

Query parameters:

| Parameter | Required | Rules |
| --- | --- | --- |
| `limit` | No | Integer from 1 to 100; defaults to 50 |
| `cursor` | No | `nextCursor` returned by the previous page; cursor must belong to this token's reviewer and project scope |

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
        "stage": "TITLE_ABSTRACT",
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

`project` contains current review context once per page. Each item contains its task-time `protocolSnapshot`, instructions, and a bibliographic summary so the agent does not need one metadata request per task. The snapshot is authoritative if the protocol changes after assignment. A `markdownPath` is included for `FULL_TEXT` tasks (and legacy tasks without a stage); `TITLE_ABSTRACT` tasks use the title and abstract only. **Only request Markdown when the task has `stage: "FULL_TEXT"` and includes `markdownPath`.** For title/abstract tasks, do not construct or call the Markdown URL; a `409 FULLTEXT_STAGE_REQUIRED` is an expected stage restriction and should not be retried. `paper.authors` may contain strings or objects with a `name` field. `paper.fullTextStatus` reflects the current extraction status; it may be `PENDING`, `PROCESSING`, `COMPLETED`, `PARTIAL`, `FAILED`, or `UNAVAILABLE` depending on the paper record.

Task `status` is `ASSIGNED` until a result is accepted, then `COMPLETED`. A completed task may also contain `completedAt` and `result`.

Continue while `hasMore` is `true`, passing `nextCursor` as `cursor`. Stop when `hasMore` is `false` or `nextCursor` is `null`.

## 4. Retrieve one task

```http
GET /api/agent/v1/tasks/{taskId}
```

This returns `{ "task": ..., "project": ..., "paper": ... }` inside `data`. Use it to refresh an individual task or retrieve its review context. The task must be assigned to this token's agent, reviewer workspace, and project; otherwise the API returns `404`. Use the task's `protocolSnapshot` as the criteria of record for this analysis.

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
| `409` | Task is not at `FULL_TEXT` stage, or Markdown is unavailable/extraction failed |
| `502` | Backend could not retrieve the Markdown asset |

When a response is `202`, wait at least the number of seconds in `Retry-After` before trying again. Do not repeatedly poll faster than that. `PARTIAL` Markdown is available when extraction completed with partial content.

## 6. Submit an AI recommendation

```http
POST /api/agent/v1/tasks/{taskId}/result
Content-Type: application/json
```

Request body:

```json
{
  "decision": "INCLUDE",
  "reasoning": "The study matches the population and intervention criteria because ...",
  "data": {
    "population": "...",
    "evidence": ["..."],
    "confidence": 0.91
  }
}
```

`decision` is a required non-empty string (maximum 100 characters). Recommended values are `INCLUDE`, `EXCLUDE`, or `UNCERTAIN`; align them with the project's screening workflow. `reasoning` is required (maximum 16,000 characters) and serves as the agent's explanation. `data` is optional and must be a JSON object; use it for criterion assessments and evidence. The complete body must not exceed 30 KB. Submitting this result completes only the AI task: it does not create a human screening decision, change paper status, or create a Human-vs-Human conflict.

Successful submission returns HTTP `200`, the updated task, and sets its status to `COMPLETED`. A completed task cannot be submitted again; the API returns `409`.

## 7. Common HTTP errors

| HTTP status | Typical cause |
| --- | --- |
| `400` | Invalid `limit`, cursor, or result body |
| `401` | Missing, malformed, rotated, inactive, or issued for a different agent/reviewer/project. Confirm the API base URL is `https://slr-agent.hyperdatalab.org/api` and retrieve the current `slrp_...` token from the same reviewer's project workspace. Rotating, disabling, or switching agents invalidates an older token. |
| `404` | Task does not exist or is outside the token's agent/project scope |
| `409` | Task already completed or full-text content unavailable |
| `500` | Unexpected backend error; retry with backoff |
| `502` | Backend could not read a paper asset |

## 8. Recommended agent workflow

1. Request a task page and retain `nextCursor` for pagination.
2. Process only tasks with `status: "ASSIGNED"`.
3. Use the task's `stage` and `protocolSnapshot` as the review scope. `TITLE_ABSTRACT` tasks use title/abstract; `FULL_TEXT` tasks may fetch Markdown.
4. Check paper metadata and input availability. Fetch `markdownPath` for Full-text tasks when needed. Respect `202` and `Retry-After`.
5. Submit one result for each completed task. Treat `409` on submission as a terminal task state and refresh the task if needed.

Swagger UI is available at `/api-docs`; the OpenAPI JSON is at `/api-docs.json`.
