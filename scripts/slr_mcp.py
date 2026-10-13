#!/usr/bin/env python3
"""Python stdlib MCP stdio server for SLR screening and extraction."""

from __future__ import annotations

import json
import re
import sys
import traceback
from typing import Any

from slr import (
    AgentApiClient,
    ApiError,
    McpConfig,
    build_confirmation_payload,
    build_review_body,
    canonical_json,
    confirmation_digest,
    load_mcp_config,
    redact_secret,
    safe_display,
    sha256_hex,
)


SERVER_INFO = {"name": "slr-agent-mcp-server", "version": "0.1.0"}
SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
EXTRACTION_CHALLENGES: dict[str, dict[str, Any]] = {}
CONSENSUS_CHALLENGES: dict[str, dict[str, Any]] = {}


def _schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        result["required"] = required
    return result


def _string(description: str, minimum: int = 1, maximum: int | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"type": "string", "description": description, "minLength": minimum}
    if maximum is not None:
        value["maxLength"] = maximum
    return value


TASK_ID = _string("Task identifier returned by list_assigned_tasks.", 1, 160)
CONFIRMATION = _schema({
    "confirm": {"type": "boolean", "description": "Set true only after the user confirms the displayed payload."},
    "digest": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
}, ["confirm", "digest"])


TOOLS = [
    {
        "name": "list_assigned_tasks",
        "title": "List Assigned SLR Tasks",
        "description": "List project-scoped assigned tasks. Pass nextCursor as cursor to continue pagination.",
        "inputSchema": _schema({
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50},
            "cursor": {"type": "string", "minLength": 1, "maxLength": 2000},
        }),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "connection_test",
        "title": "Test SLR API Connection",
        "description": "Check the connector with one bounded read-only task request.",
        "inputSchema": _schema({}),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "get_assigned_task",
        "title": "Get Assigned SLR Task",
        "description": "Get one assigned task with project criteria, instructions, and paper metadata.",
        "inputSchema": _schema({"taskId": TASK_ID}, ["taskId"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "get_task_fulltext",
        "title": "Get SLR Task Full Text",
        "description": "Retrieve assigned paper Markdown; pending extraction returns a retry hint.",
        "inputSchema": _schema({"taskId": TASK_ID}, ["taskId"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "submit_review_result",
        "title": "Submit SLR Review Result",
        "description": "Write one review result only after a matching explicit user confirmation digest.",
        "inputSchema": _schema({
            "taskId": TASK_ID,
            "decision": _string("Screening decision, commonly INCLUDE, EXCLUDE, or UNCERTAIN.", 1, 100),
            "reasoning": _string("Evidence-based reasoning.", 1, 16000),
            "data": {"type": "object"},
            "confirmation": CONFIRMATION,
        }, ["taskId", "decision", "reasoning"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "get_extraction_context",
        "title": "Get Extraction Context",
        "description": "Read an assigned extraction task, template snapshot, paper metadata, and isolated draft.",
        "inputSchema": _schema({"taskId": TASK_ID}, ["taskId"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "get_extraction_fulltext",
        "title": "Get Extraction Full Text",
        "description": "Read normalized Markdown with source hash, revision, and evidence coordinates.",
        "inputSchema": _schema({"taskId": TASK_ID}, ["taskId"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "save_extraction_draft",
        "title": "Save Extraction Draft",
        "description": "Save field values and bounded evidence coordinates to the isolated agent draft.",
        "inputSchema": _schema({
            "taskId": TASK_ID,
            "templateVersion": {"type": "integer", "minimum": 1},
            "values": {"type": "object"},
            "evidence": {"type": "array", "maxItems": 500, "items": {"type": "object"}},
            "expectedVersion": {"type": "integer", "minimum": 0},
        }, ["taskId", "templateVersion", "values", "expectedVersion"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "check_extraction_draft",
        "title": "Check Extraction Draft",
        "description": "Run deterministic validation on the isolated extraction draft.",
        "inputSchema": _schema({"taskId": TASK_ID}, ["taskId"]),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
    },
    {
        "name": "submit_extraction_draft",
        "title": "Submit Extraction",
        "description": "Submit the exact extraction draft after one explicit user confirmation.",
        "inputSchema": _schema({"taskId": TASK_ID, "confirmation": CONFIRMATION}, ["taskId"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "finalize_extraction_consensus",
        "title": "Propose Extraction Consensus",
        "description": "Create or update a leader consensus proposal after one explicit confirmation.",
        "inputSchema": _schema({
            "taskId": TASK_ID,
            "expectedVersion": {"type": "integer", "minimum": 0},
            "values": {"type": "object"},
            "findings": {"type": "array", "maxItems": 500, "items": {"type": "object"}},
            "confirmation": CONFIRMATION,
        }, ["taskId", "expectedVersion", "values", "findings"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    },
]


def _json_result(value: Any, secret: str) -> dict[str, Any]:
    text = redact_secret(json.dumps(value, ensure_ascii=False), secret)
    return {"content": [{"type": "text", "text": text}], "isError": False}


def _markdown_result(value: str, secret: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": redact_secret(value, secret)}], "isError": False}


def _tool_error(error: Exception, secret: str) -> dict[str, Any]:
    if isinstance(error, ApiError):
        details = error.as_dict()
        details["message"] = redact_secret(details.get("message", ""), secret)
        return {"content": [{"type": "text", "text": json.dumps({"error": details}, ensure_ascii=False)}], "isError": True}
    print(traceback.format_exc(), file=sys.stderr, flush=True)
    return {"content": [{"type": "text", "text": json.dumps({"error": {"code": "INTERNAL_ERROR", "status": 500, "message": "Unexpected MCP server error."}})}], "isError": True}


def _require(args: dict[str, Any], key: str) -> Any:
    value = args.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ApiError(f"{key} is required", code="VALIDATION")
    return value


def _strict_object(value: Any, allowed: set[str], required: set[str] = set()) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ApiError("tool arguments must be an object", code="VALIDATION")
    unknown = set(value) - allowed
    missing = required - set(value)
    if unknown:
        raise ApiError(f"unknown tool argument: {sorted(unknown)[0]}", code="VALIDATION")
    if missing:
        raise ApiError(f"missing required tool argument: {sorted(missing)[0]}", code="VALIDATION")
    return value


def _string_arg(value: Any, name: str, maximum: int | None = None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{name} must be a non-empty string", code="VALIDATION")
    result = value.strip()
    if maximum is not None and len(result) > maximum:
        raise ApiError(f"{name} is too long", code="VALIDATION")
    return result


def _integer_arg(value: Any, name: str, minimum: int = 0, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ApiError(f"{name} must be an integer", code="VALIDATION")
    if value < minimum or (maximum is not None and value > maximum):
        raise ApiError(f"{name} is outside the allowed range", code="VALIDATION")
    return value


def _validate_confirmation(value: Any) -> None:
    if value is None:
        return
    confirmation = _strict_object(value, {"confirm", "digest"}, {"confirm", "digest"})
    if not isinstance(confirmation["confirm"], bool):
        raise ApiError("confirmation.confirm must be boolean", code="VALIDATION")
    _string_arg(confirmation["digest"], "confirmation.digest", 64)
    if not re.fullmatch(r"[a-f0-9]{64}", confirmation["digest"]):
        raise ApiError("confirmation.digest must be a SHA-256 hex digest", code="VALIDATION")


def _validate_evidence(value: Any) -> None:
    if not isinstance(value, list) or len(value) > 500:
        raise ApiError("evidence must be an array with at most 500 items", code="VALIDATION")
    fields = {"fieldId", "sourceAssetId", "sourceRevision", "sourceHash", "startOffset", "endOffset", "quote", "quoteHash", "section", "paragraph", "pdfPage"}
    required = {"fieldId", "sourceAssetId", "sourceRevision", "sourceHash", "startOffset", "endOffset", "quote", "quoteHash"}
    for item in value:
        evidence = _strict_object(item, fields, required)
        for key in ("fieldId", "sourceAssetId", "sourceRevision", "quote"):
            _string_arg(evidence[key], f"evidence.{key}", 4000 if key == "quote" else None)
        for key in ("sourceHash", "quoteHash"):
            digest = _string_arg(evidence[key], f"evidence.{key}", 64)
            if not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ApiError(f"evidence.{key} must be a SHA-256 hex digest", code="VALIDATION")
        _integer_arg(evidence["startOffset"], "evidence.startOffset", 0)
        _integer_arg(evidence["endOffset"], "evidence.endOffset", 1)
        if evidence["endOffset"] <= evidence["startOffset"]:
            raise ApiError("evidence.endOffset must be greater than startOffset", code="VALIDATION")
        if "section" in evidence:
            _string_arg(evidence["section"], "evidence.section", 500)
        if "paragraph" in evidence:
            _integer_arg(evidence["paragraph"], "evidence.paragraph", 0)
        if "pdfPage" in evidence:
            _integer_arg(evidence["pdfPage"], "evidence.pdfPage", 1)


def _validate_tool_args(name: str, args: dict[str, Any]) -> dict[str, Any]:
    if name == "list_assigned_tasks":
        value = _strict_object(args, {"limit", "cursor"})
        value.setdefault("limit", 50)
        _integer_arg(value["limit"], "limit", 1, 100)
        if "cursor" in value:
            _string_arg(value["cursor"], "cursor", 2000)
        return value
    if name == "connection_test":
        return _strict_object(args, set())
    if name in {"get_assigned_task", "get_task_fulltext", "get_extraction_context", "get_extraction_fulltext", "check_extraction_draft"}:
        value = _strict_object(args, {"taskId"}, {"taskId"})
        _string_arg(value["taskId"], "taskId", 160)
        return value
    if name == "submit_review_result":
        value = _strict_object(args, {"taskId", "decision", "reasoning", "data", "confirmation"}, {"taskId", "decision", "reasoning"})
        _string_arg(value["taskId"], "taskId", 160)
        _string_arg(value["decision"], "decision", 100)
        _string_arg(value["reasoning"], "reasoning", 16000)
        if "data" in value and not isinstance(value["data"], dict):
            raise ApiError("data must be an object", code="VALIDATION")
        _validate_confirmation(value.get("confirmation"))
        return value
    if name == "save_extraction_draft":
        value = _strict_object(args, {"taskId", "templateVersion", "values", "evidence", "expectedVersion"}, {"taskId", "templateVersion", "values", "expectedVersion"})
        _string_arg(value["taskId"], "taskId", 160)
        _integer_arg(value["templateVersion"], "templateVersion", 1)
        if not isinstance(value["values"], dict):
            raise ApiError("values must be an object", code="VALIDATION")
        value.setdefault("evidence", [])
        _validate_evidence(value["evidence"])
        _integer_arg(value["expectedVersion"], "expectedVersion", 0)
        return value
    if name == "submit_extraction_draft":
        value = _strict_object(args, {"taskId", "confirmation"}, {"taskId"})
        _string_arg(value["taskId"], "taskId", 160)
        _validate_confirmation(value.get("confirmation"))
        return value
    if name == "finalize_extraction_consensus":
        value = _strict_object(args, {"taskId", "expectedVersion", "values", "findings", "confirmation"}, {"taskId", "expectedVersion", "values", "findings"})
        _string_arg(value["taskId"], "taskId", 160)
        _integer_arg(value["expectedVersion"], "expectedVersion", 0)
        if not isinstance(value["values"], dict) or not isinstance(value["findings"], list) or len(value["findings"]) > 500:
            raise ApiError("values must be an object and findings must contain at most 500 items", code="VALIDATION")
        finding_fields = {"findingId", "fieldId", "kind", "status", "reviewer1Value", "reviewer2Value", "proposedValue", "resolution", "reason"}
        for item in value["findings"]:
            finding = _strict_object(item, finding_fields, {"findingId", "fieldId", "kind", "status"})
            _string_arg(finding["findingId"], "finding.findingId")
            _string_arg(finding["fieldId"], "finding.fieldId")
            if finding["kind"] not in {"VALUE_DISAGREEMENT", "MISSING_REQUIRED", "AI_SUGGESTION"} or finding["status"] not in {"PENDING", "RESOLVED", "DISMISSED"}:
                raise ApiError("finding kind or status is invalid", code="VALIDATION")
            if "reason" in finding and not isinstance(finding["reason"], str):
                raise ApiError("finding.reason must be a string", code="VALIDATION")
        _validate_confirmation(value.get("confirmation"))
        return value
    return args


def _confirmation_message(task_id: str, body: dict[str, Any], config: McpConfig, digest: str) -> str:
    preview = body["reasoning"][:500] + ("…" if len(body["reasoning"]) > 500 else "")
    return "\n".join([
        "Final confirmation required before writing an SLR review result.",
        f"Profile: {safe_display(config.profile_id, config.agent_token, 100)}",
        f"Project: {safe_display(config.project_name, config.agent_token, 160)} ({safe_display(config.project_id, config.agent_token, 160)})",
        f"Task: {safe_display(task_id, config.agent_token, 160)}",
        f"Decision: {safe_display(body['decision'], config.agent_token, 100)}",
        f"Reason/comment preview: {safe_display(preview, config.agent_token)}",
        f"Payload digest: {digest}",
        "No backend write has happened yet.",
        "After confirmation, call submit_review_result again with confirmation.confirm=true and this digest.",
    ])


def _challenge_key(task_id: str, digest: str) -> str:
    return f"{task_id}:{digest}"


def _call_tool(name: str, args: dict[str, Any], client: AgentApiClient, config: McpConfig) -> dict[str, Any]:
    args = _validate_tool_args(name, args)
    if name == "list_assigned_tasks":
        return _json_result(client.list_assigned_tasks(int(args.get("limit", 50)), args.get("cursor")), config.agent_token)
    if name == "connection_test":
        page = client.list_assigned_tasks(1)
        return _json_result({
            "connected": True,
            "project": (page.get("project") or {}).get("name"),
            "projectId": (page.get("project") or {}).get("id"),
            "assignedTasksVisible": len(page.get("items") or []) > 0,
            "sampleCount": len(page.get("items") or []),
            "hasMore": page.get("hasMore") is True,
        }, config.agent_token)
    if name == "get_assigned_task":
        return _json_result(client.get_assigned_task(str(_require(args, "taskId"))), config.agent_token)
    if name == "get_task_fulltext":
        result = client.get_task_fulltext(str(_require(args, "taskId")))
        return _markdown_result(result["markdown"], config.agent_token) if result.get("kind") == "ready" else _json_result(result, config.agent_token)
    if name == "submit_review_result":
        task_id = str(_require(args, "taskId"))
        body = build_review_body(args.get("decision"), args.get("reasoning"), args.get("data"))
        digest = confirmation_digest(config, task_id, body)
        confirmation = args.get("confirmation")
        if not confirmation:
            return _json_result({"status": "CONFIRMATION_REQUIRED", "taskId": task_id, "digest": digest, "message": _confirmation_message(task_id, body, config, digest), "nextCall": {"confirmation": {"confirm": True, "digest": digest}}}, config.agent_token)
        if confirmation.get("confirm") is not True:
            return _json_result({"status": "CANCELLED", "message": "Submission cancelled; no review result was written."}, config.agent_token)
        if confirmation.get("digest") != digest:
            raise ApiError("Confirmation does not match the current review payload", 409, "CONFIRMATION_MISMATCH")
        return _json_result(client.submit_review_result(task_id, body), config.agent_token)
    if name == "get_extraction_context":
        return _json_result(client.get_extraction_context(str(_require(args, "taskId"))), config.agent_token)
    if name == "get_extraction_fulltext":
        return _json_result(client.get_extraction_fulltext(str(_require(args, "taskId"))), config.agent_token)
    if name == "save_extraction_draft":
        return _json_result(client.save_extraction_draft(args), config.agent_token)
    if name == "check_extraction_draft":
        return _json_result(client.check_extraction_draft(str(_require(args, "taskId"))), config.agent_token)
    if name == "submit_extraction_draft":
        task_id = str(_require(args, "taskId"))
        confirmation = args.get("confirmation")
        if not confirmation:
            challenge = client.create_extraction_submit_challenge(task_id)
            digest = str(challenge.get("payloadDigest"))
            EXTRACTION_CHALLENGES[_challenge_key(task_id, digest)] = challenge
            return _json_result({"status": "CONFIRMATION_REQUIRED", "taskId": task_id, "payloadDigest": digest, "expiresAt": challenge.get("expiresAt"), "draft": challenge.get("payload"), "message": "Review this exact field-value and evidence draft. Reply confirm or cancel once."}, config.agent_token)
        digest = str(confirmation.get("digest", ""))
        if confirmation.get("confirm") is not True:
            EXTRACTION_CHALLENGES.pop(_challenge_key(task_id, digest), None)
            return _json_result({"status": "CANCELLED", "message": "Extraction submission cancelled; no proposal was written."}, config.agent_token)
        challenge = EXTRACTION_CHALLENGES.get(_challenge_key(task_id, digest))
        if not challenge:
            raise ApiError("Extraction confirmation is missing or expired; prepare a new confirmation.", 409, "CONFIRMATION_NOT_FOUND")
        result = client.submit_extraction(task_id, str(challenge["challengeId"]), digest)
        EXTRACTION_CHALLENGES.pop(_challenge_key(task_id, digest), None)
        return _json_result(result, config.agent_token)
    if name == "finalize_extraction_consensus":
        task_id = str(_require(args, "taskId"))
        confirmation = args.get("confirmation")
        if not confirmation:
            challenge = client.create_consensus_challenge(args)
            digest = str(challenge.get("payloadDigest"))
            CONSENSUS_CHALLENGES[_challenge_key(task_id, digest)] = {"challenge": challenge, "input": dict(args)}
            return _json_result({"status": "CONFIRMATION_REQUIRED", "taskId": task_id, "payloadDigest": digest, "expiresAt": challenge.get("expiresAt"), "proposal": challenge.get("payload"), "message": "Review the exact consensus proposal. Reply confirm or cancel once."}, config.agent_token)
        digest = str(confirmation.get("digest", ""))
        if confirmation.get("confirm") is not True:
            CONSENSUS_CHALLENGES.pop(_challenge_key(task_id, digest), None)
            return _json_result({"status": "CANCELLED", "message": "Consensus proposal cancelled; no proposal was written."}, config.agent_token)
        pending = CONSENSUS_CHALLENGES.get(_challenge_key(task_id, digest))
        if not pending:
            raise ApiError("Consensus confirmation is missing or expired; prepare a new confirmation.", 409, "CONFIRMATION_NOT_FOUND")
        challenge = pending["challenge"]
        displayed = challenge.get("payload")
        if displayed is not None:
            original = pending["input"]
            expected = {
                "taskId": task_id,
                "expectedVersion": original.get("expectedVersion"),
                "templateId": displayed.get("templateId"),
                "templateVersion": displayed.get("templateVersion"),
                "sourceAssetId": displayed.get("sourceAssetId"),
                "sourceRevision": displayed.get("sourceRevision"),
                "sourceHash": displayed.get("sourceHash"),
                "values": original.get("values"),
                "findings": original.get("findings"),
            }
            if canonical_json(displayed) != canonical_json(expected):
                raise ApiError("Consensus confirmation does not match the displayed proposal", 409, "CONFIRMATION_MISMATCH")
        result = client.submit_consensus_proposal(task_id, str(challenge["challengeId"]), digest)
        CONSENSUS_CHALLENGES.pop(_challenge_key(task_id, digest), None)
        return _json_result(result, config.agent_token)
    raise ApiError(f"unknown tool {name}", -32601, "METHOD_NOT_FOUND")


def _handle(message: dict[str, Any], client: AgentApiClient, config: McpConfig) -> dict[str, Any] | None:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return {"jsonrpc": "2.0", "id": message.get("id") if isinstance(message, dict) else None, "error": {"code": -32600, "message": "Invalid Request"}}
    method = message.get("method")
    message_id = message.get("id")
    if message_id is None:
        return None
    if method == "initialize":
        requested = (message.get("params") or {}).get("protocolVersion")
        version = requested if requested in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0]
        return {"jsonrpc": "2.0", "id": message_id, "result": {"protocolVersion": version, "capabilities": {"tools": {"listChanged": False}}, "serverInfo": SERVER_INFO, "instructions": "Connector for the /slr skill. Read tasks and extraction data before drafting; writes require explicit confirmation."}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": message_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": message_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        params = message.get("params") or {}
        try:
            result = _call_tool(str(params.get("name")), params.get("arguments") or {}, client, config)
        except Exception as exc:
            result = _tool_error(exc, config.agent_token)
        return {"jsonrpc": "2.0", "id": message_id, "result": result}
    return {"jsonrpc": "2.0", "id": message_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


def main() -> None:
    try:
        config = load_mcp_config()
        client = AgentApiClient(config)
    except Exception as exc:
        print(f"SLR agent MCP server startup failed: {safe_display(exc)}", file=sys.stderr, flush=True)
        raise SystemExit(1)
    print("SLR agent MCP server is running over stdio", file=sys.stderr, flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            messages = message if isinstance(message, list) else [message]
            responses = [response for response in (_handle(item, client, config) for item in messages) if response is not None]
            if responses:
                output = responses if isinstance(message, list) else responses[0]
                sys.stdout.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
                sys.stdout.flush()
        except json.JSONDecodeError:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}) + "\n")
            sys.stdout.flush()
        except Exception:
            print(traceback.format_exc(), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()

