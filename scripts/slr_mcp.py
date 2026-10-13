#!/usr/bin/env python3
"""MCP server (stdio) for the SLR Agent Task API — the `slr` connector for Open-Science.

Open-Science launches it as a local custom connector on the host, so it always reaches the
backend and the real ~/.config/slr-open-science, even when the agent's shell is sandboxed.
It is the only channel the chat needs: API calls, configuration, and the local drafts +
audit log (~/slr-paper-review/<profile>/, or $REVIEW_WORKDIR). Open-Science agents may not run
scripts or read files inside the skill folder, so nothing in the skill depends on that.

Stdlib only. Config is read on every call from slr.py's stored profile, so
`/slr config token|url|use` takes effect immediately without reconnecting the connector.
Env overrides (API_BASE_URL, AGENT_TOKEN, REVIEW_PROFILE) still win if set.

Tools:
  connection_test()                                   check URL + token, task counts
  list_tasks(status?)                                 tasks + project context
  get_task(task_id)                                   one task / status / result
  get_markdown(task_id, max_wait?)                    full text (FULL_TEXT tasks only)
  save_draft(task_id, decision, reasoning, data, title?)  validate + save/replace a local draft
  list_drafts()                                       pending drafts table + submitted ids
  get_draft(task_id)                                  one saved draft (exact body)
  submit_drafts(task_ids?)                            POST saved drafts exactly as stored (final)
  submit_result(task_id, decision, reasoning, data)   POST a vote without a draft (final)
  config_show()                                       profiles, token masked
  config_set_url(url, profile?)                       save API base URL
  config_set_token(token, profile?)                   save token + test (never echoed)
  config_use(profile)                                 switch active profile
"""
import json
import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import slr  # noqa: E402
from slr import (ApiError, Client, active_profile, build_body, drafts_table,  # noqa: E402
                 get_draft, mark_submitted, save_draft, set_token, set_url, show_config,
                 submit_drafts, use_profile)

# Drafts live on the host, one folder per profile (the chat's working folder is not visible here).
slr.WORKDIR_DEFAULT = lambda: Path.home() / "slr-paper-review" / active_profile()

SERVER_INFO = {"name": "slr", "version": "1.0.0"}
SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

_OBJ = {"type": "object", "additionalProperties": False}
_TASK_ID = {"task_id": {"type": "string", "description": "Task id from list_tasks"}}
_PROFILE = {"profile": {"type": "string", "description": "Profile name; default = active profile"}}

# Mirrors slr.validate_data; data.criteria feeds the web app's "Criteria assessment" panel.
DATA_SCHEMA = {
    "type": "object",
    "description": ("Structured assessment. criteria must cover every inclusion (IC1…) and exclusion "
                    "(EC1…) criterion of the task's protocolSnapshot, in API order. Also include studyDesign, "
                    "population, intervention, comparator, outcomes, exclusionTriggered and evidence "
                    "(see 'Vote format' in the /slr skill)."),
    "properties": {
        "basis": {"type": "string", "enum": ["title_abstract", "full_text", "partial_full_text"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "criteria": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "IC1, IC2… / EC1, EC2…"},
                    "text": {"type": "string", "description": "The criterion text from protocolSnapshot"},
                    "status": {"type": "string", "enum": ["met", "not_met", "unclear"],
                               "description": "For EC: met = exclusion triggered"},
                    "evidence": {"type": "string",
                                 "description": "Short quote/finding with location, e.g. 'participants aged 12-17 (Methods)'"},
                },
                "required": ["id", "text", "status", "evidence"],
            },
        },
    },
    "required": ["basis", "confidence", "criteria"],
}

TOOLS = [
    {
        "name": "connection_test",
        "title": "Test SLR API connection",
        "description": ("Check that the connector reaches the API with the active profile's token; "
                        "returns profile, project name and assigned/completed counts."),
        "inputSchema": {**_OBJ, "properties": {}},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "list_tasks",
        "title": "List SLR tasks",
        "description": ("List tasks assigned to this reviewer workspace's agent (all cursor pages), "
                        "including each task's stage, instructions, protocolSnapshot and paper "
                        "metadata (title, abstract, fullTextStatus). The page also includes the "
                        "current project context."),
        "inputSchema": {**_OBJ, "properties": {
            "status": {"type": "string", "enum": ["ASSIGNED", "COMPLETED", "any"], "default": "ASSIGNED"}}},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "get_task",
        "title": "Get SLR task",
        "description": ("Return one task with stage, protocolSnapshot, markdownPath, paper metadata "
                        "and result. Use it to refresh a task or verify a submission landed "
                        "(status COMPLETED)."),
        "inputSchema": {**_OBJ, "properties": _TASK_ID, "required": ["task_id"]},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "get_markdown",
        "title": "Get paper full text",
        "description": ("Full-text Markdown for a FULL_TEXT task that has markdownPath. Never call for "
                        "TITLE_ABSTRACT tasks. Waits per Retry-After while extraction is pending (up "
                        "to max_wait seconds). Returns the Markdown text, or status pending / "
                        "unavailable."),
        "inputSchema": {**_OBJ, "properties": {
            **_TASK_ID,
            "max_wait": {"type": "integer", "default": 30, "minimum": 0, "maximum": 120}},
            "required": ["task_id"]},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "submit_result",
        "title": "Submit SLR screening vote",
        "description": (
            "Submit the screening recommendation for one assigned paper task. IRREVERSIBLE: the "
            "API rejects a second submission (409). Only call after the scientist approved this "
            "exact vote. Returns status submitted / already_completed / error."
        ),
        "inputSchema": {**_OBJ, "properties": {
            **_TASK_ID,
            "decision": {"type": "string", "description": "INCLUDE, EXCLUDE or UNCERTAIN", "maxLength": 100},
            "reasoning": {"type": "string", "description": "Reasoning text (max 16,000 chars)"},
            "data": DATA_SCHEMA},
            "required": ["task_id", "decision", "reasoning", "data"]},
        "annotations": {"destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "save_draft",
        "title": "Save SLR draft vote",
        "description": ("Validate and save (or replace) the draft vote for one task on the host. Does NOT "
                        "submit. Same body as submit_result; data must follow the rubric in the skill "
                        "(basis, confidence, criteria for every IC/EC). Use it for /slr review and "
                        "/slr edit."),
        "inputSchema": {**_OBJ, "properties": {
            **_TASK_ID,
            "title": {"type": "string", "description": "Short paper title for the drafts table"},
            "decision": {"type": "string", "description": "INCLUDE, EXCLUDE or UNCERTAIN", "maxLength": 100},
            "reasoning": {"type": "string", "description": "Reasoning text (max 16,000 chars)"},
            "data": DATA_SCHEMA},
            "required": ["task_id", "decision", "reasoning", "data"]},
        "annotations": {"idempotentHint": True},
    },
    {
        "name": "list_drafts",
        "title": "List SLR drafts",
        "description": ("Pending drafts (task id, title, decision, confidence, key reason), counts by "
                        "decision, and ids already submitted from this profile."),
        "inputSchema": {**_OBJ, "properties": {}},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "get_draft",
        "title": "Get SLR draft",
        "description": "Return one saved draft (pending or submitted) with its exact body.",
        "inputSchema": {**_OBJ, "properties": _TASK_ID, "required": ["task_id"]},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "submit_drafts",
        "title": "Submit approved SLR drafts",
        "description": ("POST saved drafts exactly as stored and move each accepted one to submitted. "
                        "IRREVERSIBLE. Only call after the scientist explicitly approved these drafts. "
                        "task_ids = the approved ids (omit only when every pending draft was approved). "
                        "Stops the batch on 401. Per task: submitted / already_completed / error."),
        "inputSchema": {**_OBJ, "properties": {
            "task_ids": {"type": "array", "items": {"type": "string"}}}},
        "annotations": {"destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "config_show",
        "title": "Show SLR profiles",
        "description": "List profiles with API URL and masked token, and which one is active.",
        "inputSchema": {**_OBJ, "properties": {}},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "config_set_url",
        "title": "Set SLR API URL",
        "description": "Save the backend API base URL (/api appended if missing) for a profile.",
        "inputSchema": {**_OBJ, "properties": {"url": {"type": "string"}, **_PROFILE}, "required": ["url"]},
        "annotations": {"idempotentHint": True},
    },
    {
        "name": "config_set_token",
        "title": "Set SLR agent token",
        "description": ("Save the reviewer-workspace agent token the user gave for a profile (file "
                        "with 0600 permissions on the host), then test the connection. The token is "
                        "never returned — the result shows only a masked form."),
        "inputSchema": {**_OBJ, "properties": {"token": {"type": "string"}, **_PROFILE}, "required": ["token"]},
        "annotations": {"idempotentHint": True},
    },
    {
        "name": "config_use",
        "title": "Switch SLR profile",
        "description": "Make another saved profile (project) the active one, then test it.",
        "inputSchema": {**_OBJ, "properties": {"profile": {"type": "string"}}, "required": ["profile"]},
        "annotations": {"idempotentHint": True},
    },
]


def log(msg):
    print(f"[slr-mcp] {msg}", file=sys.stderr, flush=True)


def tool_result(payload, is_error=False):
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
            "structuredContent": payload, "isError": is_error}


def connection_test():
    prof = active_profile()
    try:
        c = Client(retries=0)
        project, tasks = c.list_tasks(status="any")
    except ApiError as e:
        return {"connected": False, "profile": prof, "error": e.as_dict()}
    assigned = sum(1 for t in tasks if t.get("status") == "ASSIGNED")
    return {"connected": True, "profile": prof, "api": c.base, "project": (project or {}).get("name"),
            "assigned": assigned, "completed": len(tasks) - assigned}


def call_tool(name, args):
    try:
        if name == "connection_test":
            res = connection_test()
            return tool_result(res, not res["connected"])
        if name == "list_tasks":
            project, items = Client().list_tasks(status=args.get("status") or "ASSIGNED")
            return tool_result({"profile": active_profile(), "project": project,
                                "count": len(items), "items": items})
        if name == "get_task":
            return tool_result(Client().get_task(str(args["task_id"])))
        if name == "get_markdown":
            tid = str(args["task_id"])
            try:
                text = Client().markdown(tid, int(args.get("max_wait", 30)))
            except ApiError as e:
                if e.status == 202:
                    return tool_result({"taskId": tid, "status": "pending", "message": e.message})
                if e.status == 409:
                    return tool_result({"taskId": tid, "status": "unavailable", "code": e.code,
                                        "message": e.message})
                raise
            return {"content": [{"type": "text", "text": text}],
                    "structuredContent": {"taskId": tid, "status": "ready", "chars": len(text)},
                    "isError": False}
        if name == "submit_result":
            body = build_body(args.get("decision"), args.get("reasoning"), args.get("data"))
            tid = str(args["task_id"])
            try:
                task = Client().submit(tid, body)
                mark_submitted(tid, "submitted")
                return tool_result({"taskId": tid, "status": "submitted", "decision": body["decision"],
                                    "taskStatus": (task or {}).get("status")})
            except ApiError as e:
                if e.status == 409:
                    mark_submitted(tid, "already_completed")
                    return tool_result({"taskId": tid, "status": "already_completed", "message": e.message})
                raise
        if name == "save_draft":
            return tool_result(save_draft(str(args["task_id"]), args, str(args.get("title") or "")))
        if name == "list_drafts":
            return tool_result(drafts_table())
        if name == "get_draft":
            return tool_result(get_draft(str(args["task_id"])))
        if name == "submit_drafts":
            res = submit_drafts([str(i) for i in args.get("task_ids") or []] or None)
            return tool_result(res, not res["ok"])
        if name == "config_show":
            return tool_result(show_config())
        if name == "config_set_url":
            return tool_result(set_url(str(args["url"]), args.get("profile")))
        if name == "config_set_token":
            res = set_token(str(args["token"]), args.get("profile"))
            return tool_result(res, res.get("connected") is False)
        if name == "config_use":
            res = use_profile(str(args["profile"]))
            res.update(connection_test())
            return tool_result(res)
        return tool_result({"error": f"unknown tool {name}"}, True)
    except ApiError as e:
        return tool_result({**e.as_dict(), "status": "error", "httpStatus": e.status}, True)
    except Exception as e:  # never crash the server
        log(traceback.format_exc())
        return tool_result({"status": "error", "message": str(e)}, True)


def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:  # notification
        return None
    if method == "initialize":
        req = (msg.get("params") or {}).get("protocolVersion")
        ver = req if req in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0]
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": ver,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": ("Connector for the /slr skill (systematic literature review screening). "
                             "Use it for every SLR API call, /slr config and the drafts (save_draft, "
                             "list_drafts, get_draft). submit_drafts / submit_result only for votes the "
                             "scientist approved. Never repeat the agent token."),
        }}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
    if method == "tools/call":
        p = msg.get("params") or {}
        return {"jsonrpc": "2.0", "id": mid, "result": call_tool(p.get("name"), p.get("arguments") or {})}
    return {"jsonrpc": "2.0", "id": mid,
            "error": {"code": -32601, "message": f"Method not found: {method}"}}


def main():
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8", newline="\n")
        except Exception:
            pass
    log(f"started (profile {active_profile()})")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        else:
            msgs = msg if isinstance(msg, list) else [msg]
            out = [r for r in (handle(m) for m in msgs) if r is not None]
            if not out:
                continue
            resp = out if isinstance(msg, list) else out[0]
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
