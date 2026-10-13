#!/usr/bin/env python3
"""Python stdlib MCP stdio server for protected SLR profile configuration.

The server accepts a token only for the explicit ``slr_config_token`` tool.
Tokens stay in memory long enough to validate, bind the host credential, and
commit the profile; they are never returned in MCP content or written to the
profile store/connector JSON.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any

from slr import (
    DEFAULT_API_BASE_URL,
    AgentApiClient,
    ApiError,
    McpConfig,
    activate_profile,
    capture_profile_store,
    commit_profile_configuration,
    find_profiles_by_project_id,
    find_profiles_by_token,
    active_profile,
    get_profile,
    ensure_open_science_credential,
    open_science_report,
    normalize_api_base_url,
    normalize_profile_name,
    operation_expiry,
    redact_secret,
    register_config_connector,
    register_connector,
    restore_profile_store,
    safe_display,
    token_fingerprint,
    list_profiles,
)


SERVER_INFO = {"name": "slr-config-mcp-server", "version": "0.1.0"}
SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
CONFIG_OPERATION_TTL_SECONDS = 10 * 60
PENDING: dict[str, dict[str, Any]] = {}


def _schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        value["required"] = required
    return value


def _string(description: str, minimum: int = 1, maximum: int | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"type": "string", "description": description, "minLength": minimum}
    if maximum is not None:
        value["maxLength"] = maximum
    return value


TOOLS = [
    {
        "name": "slr_config_profiles",
        "title": "List SLR Profiles",
        "description": "List safe local SLR profile metadata. Tokens and secret files are never returned.",
        "inputSchema": _schema({}),
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "slr_config_validate",
        "title": "Validate SLR Project Credential",
        "description": "Validate the host-bound SLR_AGENT_TOKEN and stage one protected local configuration operation.",
        "inputSchema": _schema({
            "profileName": _string("Optional local profile to validate.", 1, 64),
            "apiBaseUrl": _string("Optional API base URL.", 1, 2048),
        }),
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "slr_config_token",
        "title": "Configure SLR Project Token",
        "description": "Validate and apply an explicit project token. The token is never returned or written to local profile metadata.",
        "inputSchema": _schema({
            "token": _string("Project token supplied by the user for this one configuration operation.", 1, 4096),
            "profileName": _string("Optional profile to update or activate.", 1, 64),
            "apiBaseUrl": _string("Optional API base URL.", 1, 2048),
        }, ["token"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "slr_config_commit",
        "title": "Commit SLR Profile Configuration",
        "description": "Commit the exact validated action, refresh both connector configs, and activate the selected profile.",
        "inputSchema": _schema({
            "operationId": _string("Operation ID returned by slr_config_validate.", 16, 80),
            "action": _string("Expected action: switch, update, or save.", 4, 8),
            "profileName": _string("Optional profile selected when multiple profiles match.", 1, 64),
        }, ["operationId", "action"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False},
    },
    {
        "name": "slr_config_cancel",
        "title": "Cancel SLR Profile Configuration",
        "description": "Cancel a pending SLR profile operation without changing the active profile.",
        "inputSchema": _schema({"operationId": _string("Pending operation ID.", 16, 80)}, ["operationId"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
]


def _env() -> dict[str, str]:
    return os.environ


def _json_result(value: Any, secret: str = "") -> dict[str, Any]:
    text = redact_secret(json.dumps(value, ensure_ascii=False), secret)
    return {"content": [{"type": "text", "text": text}], "isError": False}


def _error_result(code: str, message: str, details: dict[str, Any] | None = None, secret: str = "") -> dict[str, Any]:
    payload = {"error": {"code": code, "message": redact_secret(message, secret)}}
    if details:
        payload["error"].update(details)
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}], "isError": True}


def _tool_error(error: Exception, secret: str = "") -> dict[str, Any]:
    if isinstance(error, ApiError):
        details = error.as_dict()
        return _error_result(str(details.pop("code", "CONFIGURATION_ERROR")), str(details.pop("message", "Configuration failed.")), details, secret)
    print(traceback.format_exc(), file=sys.stderr, flush=True)
    return _error_result("CONFIGURATION_ERROR", safe_display(error, secret), secret=secret)


def _require(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if value is None or not str(value).strip():
        raise ApiError(f"{key} is required", code="VALIDATION")
    return str(value).strip()


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


def _optional_text(args: dict[str, Any], key: str, maximum: int) -> None:
    if key in args and (not isinstance(args[key], str) or not args[key].strip() or len(args[key].strip()) > maximum):
        raise ApiError(f"{key} must be a non-empty string within the allowed length", code="VALIDATION")


def _validate_tool_args(name: str, args: dict[str, Any]) -> dict[str, Any]:
    if name == "slr_config_profiles":
        return _strict_object(args, set())
    if name == "slr_config_validate":
        value = _strict_object(args, {"profileName", "apiBaseUrl"})
        _optional_text(value, "profileName", 64)
        _optional_text(value, "apiBaseUrl", 2048)
        return value
    if name == "slr_config_token":
        value = _strict_object(args, {"token", "profileName", "apiBaseUrl"}, {"token"})
        _optional_text(value, "profileName", 64)
        _optional_text(value, "apiBaseUrl", 2048)
        if not isinstance(value["token"], str) or not value["token"].strip() or len(value["token"].strip()) > 4096:
            raise ApiError("token must be a non-empty string", code="VALIDATION")
        return value
    if name == "slr_config_commit":
        value = _strict_object(args, {"operationId", "action", "profileName"}, {"operationId", "action"})
        _optional_text(value, "profileName", 64)
        if not isinstance(value["operationId"], str) or not isinstance(value["action"], str):
            raise ApiError("operationId and action must be strings", code="VALIDATION")
        return value
    if name == "slr_config_cancel":
        value = _strict_object(args, {"operationId"}, {"operationId"})
        if not isinstance(value["operationId"], str):
            raise ApiError("operationId must be a string", code="VALIDATION")
        return value
    return args


def _operation_id(value: Any) -> str:
    candidate = str(value or "").strip()
    try:
        uuid.UUID(candidate)
    except (ValueError, AttributeError):
        raise ApiError("invalid configuration operation id", code="VALIDATION")
    return candidate


def _prune() -> None:
    now = datetime.now(timezone.utc).timestamp()
    for operation_id, pending in list(PENDING.items()):
        expires_at = pending.get("metadata", {}).get("expiresAt")
        try:
            expired = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")).timestamp() <= now
        except (TypeError, ValueError):
            expired = True
        if expired:
            PENDING.pop(operation_id, None)


def _pending(operation_id: Any) -> tuple[str, dict[str, Any]]:
    _prune()
    normalized = _operation_id(operation_id)
    item = PENDING.get(normalized)
    if not item or not item.get("token"):
        raise ApiError("configuration operation not found or already completed", code="CONFIGURATION_NOT_FOUND")
    return normalized, item


def _public_match(kind: str, profiles: list[dict[str, Any]]) -> dict[str, Any]:
    safe_profiles = [
        {"name": item.get("name"), "projectId": item.get("projectId"), "projectName": item.get("projectName"), "active": item.get("active") is True}
        for item in profiles
    ]
    return {"type": kind or "none", "profile": safe_profiles[0] if safe_profiles else None, "profiles": safe_profiles, "requiresProfileChoice": len(safe_profiles) > 1}


def _connection(api_base_url: str, token: str, env: dict[str, str]) -> dict[str, Any]:
    profile = active_profile(env)
    config = McpConfig(
        api_base_url=api_base_url,
        agent_token=token,
        timeout_ms=30_000,
        profile_id=str((profile or {}).get("name") or "config-validation"),
        project_id=str((profile or {}).get("projectId") or "unknown-project"),
        project_name=str((profile or {}).get("projectName") or "SLR project"),
    )
    try:
        page = AgentApiClient(config, token=token).list_assigned_tasks(1)
        project = page.get("project") or {}
        items = page.get("items") if isinstance(page.get("items"), list) else []
        return {"connected": True, "status": 200, "projectId": redact_secret(project.get("id"), token), "projectName": redact_secret(project.get("name"), token), "assignedTasks": len(items), "hasMore": page.get("hasMore") is True}
    except ApiError as error:
        result: dict[str, Any] = {"connected": False, **error.as_dict()}
        result["message"] = redact_secret(result.get("message"), token)
        return result


def _begin(profile_name: str | None, api_base_url: str | None, token: str, env: dict[str, str]) -> dict[str, Any]:
    _prune()
    candidate_name = normalize_profile_name(profile_name or (active_profile(env) or {}).get("name") or "default")
    try:
        existing = get_profile(candidate_name, env)
    except ApiError as error:
        if error.code == "CONFIG" and "not found" in error.message.lower():
            existing = None
        else:
            raise
    candidate_url = normalize_api_base_url(api_base_url or (existing or {}).get("apiBaseUrl") or DEFAULT_API_BASE_URL)
    candidate_token = str(token or "").strip()
    if not candidate_token:
        raise ApiError("agent token must not be empty", code="VALIDATION")
    connection = _connection(candidate_url, candidate_token, env)
    if connection.get("connected") is not True:
        return {"ok": False, "profile": existing, "connection": connection, "match": _public_match("none", [])}
    exact = find_profiles_by_token(candidate_token, env, candidate_url)
    project = find_profiles_by_project_id(str(connection.get("projectId") or ""), env, candidate_url) if connection.get("projectId") else []
    match = _public_match("exact", exact) if exact else _public_match("project", project) if project else _public_match("none", [])
    operation_id = str(uuid.uuid4())
    metadata = {
        "operationId": operation_id,
        "profileName": candidate_name,
        "apiBaseUrl": candidate_url,
        "expiresAt": operation_expiry(),
        "connection": connection,
        "match": match,
        "tokenFingerprint": token_fingerprint(candidate_token),
    }
    PENDING[operation_id] = {"token": candidate_token, "metadata": metadata}
    return {"ok": True, **metadata, "profile": existing or {"name": candidate_name, "apiBaseUrl": candidate_url, "projectId": None, "projectName": None, "active": False}, "actions": ["switch"] if match["type"] == "exact" else ["update"] if match["type"] == "project" else ["save"]}


def _complete(operation_id: str, action: str, profile_name: str | None, token: str, env: dict[str, str]) -> dict[str, Any]:
    operation_id, pending = _pending(operation_id)
    metadata = pending["metadata"]
    if token_fingerprint(token) != metadata.get("tokenFingerprint"):
        raise ApiError("the bound SLR credential changed after validation; validate again before committing", code="CREDENTIAL_CHANGED")
    expected_action = "switch" if metadata.get("match", {}).get("type") == "exact" else "update" if metadata.get("match", {}).get("type") == "project" else "save"
    if str(action or "").strip().lower() != expected_action:
        raise ApiError(f"configuration action must be {expected_action} for this operation", code="ACTION_MISMATCH")
    candidates = metadata.get("match", {}).get("profiles") or []
    if len(candidates) > 1 and not profile_name:
        raise ApiError("configuration matches multiple profiles; choose one with profileName", code="PROFILE_SELECTION_REQUIRED")
    target_name = profile_name or (candidates[0].get("name") if candidates else None) or metadata["profileName"]
    if candidates and not any(item.get("name") == target_name for item in candidates):
        raise ApiError("selected profile is not one of the matched profiles", code="PROFILE_SELECTION_INVALID")
    snapshot = capture_profile_store(env)
    credential_state = "unchanged"
    try:
        report = open_science_report(env)
        credential = ensure_open_science_credential(token, report)
        if credential.get("configured") is not True or not credential.get("credentialId"):
            PENDING.pop(operation_id, None)
            return {"ok": False, "code": "CREDENTIAL_BINDING_FAILED", "message": f"Unable to bind SLR_AGENT_TOKEN ({credential.get('reason', 'unknown error')}).", "credentialState": "host-credential-may-have-changed", "reconnectRequired": True}
        credential_state = "updated"
        current = None
        try:
            current = get_profile(target_name, env)
        except ApiError as error:
            if error.code != "CONFIG" or "not found" not in error.message.lower() or candidates:
                raise
        profile = commit_profile_configuration(target_name, {"apiBaseUrl": (current or {}).get("apiBaseUrl") or metadata["apiBaseUrl"], "projectId": metadata["connection"].get("projectId"), "projectName": metadata["connection"].get("projectName"), "credentialId": credential["credentialId"], "credentialFingerprint": token_fingerprint(token)}, env)
        review = register_connector(profile, report)
        config = register_config_connector(str(credential["credentialId"]), report)
        if review.get("registered") is not True or review.get("enabled") is not True or config.get("registered") is not True or config.get("enabled") is not True:
            restore_profile_store(snapshot, env)
            PENDING.pop(operation_id, None)
            return {"ok": False, "code": "CONNECTOR_REGISTRATION_FAILED", "message": "Both SLR connectors must be enabled before profile activation.", "review": review, "config": config, "profileRestored": True, "credentialState": credential_state, "reconnectRequired": True}
        active = activate_profile(profile["name"], env)
        PENDING.pop(operation_id, None)
        return {"ok": True, "action": str(action).strip().lower(), "profile": active, "connection": metadata["connection"], "match": metadata["match"], "credentialBinding": {"configured": True, "credentialId": credential["credentialId"], "displayName": credential.get("displayName", "SLR_AGENT_TOKEN")}, "connectorState": "enabled", "verification": "reconnect_required"}
    except Exception:
        try:
            restore_profile_store(snapshot, env)
        finally:
            PENDING.pop(operation_id, None)
        raise


def _call_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    args = _validate_tool_args(name, args)
    env = _env()
    if name == "slr_config_profiles":
        return _json_result({"activeProfile": active_profile(env), "profiles": list_profiles(env)})
    if name == "slr_config_validate":
        token = str(env.get("SLR_AGENT_TOKEN") or "").strip()
        if not token:
            return _error_result("CREDENTIAL_MISSING", "Bind an Open-Science credential named SLR_AGENT_TOKEN to the SLR Config connector, then retry.")
        return _json_result(_begin(args.get("profileName"), args.get("apiBaseUrl"), token, env), token)
    if name == "slr_config_token":
        token = _require(args, "token")
        staged = _begin(args.get("profileName"), args.get("apiBaseUrl"), token, env)
        if staged.get("ok") is not True:
            return _json_result(staged, token)
        if staged.get("match", {}).get("requiresProfileChoice") and not args.get("profileName"):
            PENDING.pop(staged["operationId"], None)
            return _json_result({"ok": False, "code": "PROFILE_SELECTION_REQUIRED", "message": "The token matches multiple local profiles; choose one and retry with profileName.", "profile": staged.get("profile"), "connection": staged.get("connection"), "match": staged.get("match"), "actions": staged.get("actions")}, token)
        return _json_result(_complete(staged["operationId"], staged["actions"][0], args.get("profileName"), token, env), token)
    if name == "slr_config_commit":
        token = str(env.get("SLR_AGENT_TOKEN") or "").strip()
        if not token:
            return _error_result("CREDENTIAL_MISSING", "Bind an Open-Science credential named SLR_AGENT_TOKEN to the SLR Config connector, then retry.")
        return _json_result(_complete(_require(args, "operationId"), _require(args, "action"), args.get("profileName"), token, env), token)
    if name == "slr_config_cancel":
        operation_id, _ = _pending(_require(args, "operationId"))
        PENDING.pop(operation_id, None)
        return _json_result({"ok": True, "cancelled": operation_id})
    raise ApiError(f"unknown tool {name}", code="METHOD_NOT_FOUND")


def _handle(message: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return {"jsonrpc": "2.0", "id": message.get("id") if isinstance(message, dict) else None, "error": {"code": -32600, "message": "Invalid Request"}}
    message_id = message.get("id")
    if message_id is None:
        return None
    method = message.get("method")
    if method == "initialize":
        requested = (message.get("params") or {}).get("protocolVersion")
        version = requested if requested in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0]
        return {"jsonrpc": "2.0", "id": message_id, "result": {"protocolVersion": version, "capabilities": {"tools": {"listChanged": False}}, "serverInfo": SERVER_INFO, "instructions": "Connector for /slr config. Tokens are accepted only for explicit configuration and are never returned."}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": message_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": message_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        params = message.get("params") or {}
        try:
            return {"jsonrpc": "2.0", "id": message_id, "result": _call_tool(str(params.get("name")), params.get("arguments") or {})}
        except Exception as error:
            token = str(os.environ.get("SLR_AGENT_TOKEN") or "")
            return {"jsonrpc": "2.0", "id": message_id, "result": _tool_error(error, token)}
    return {"jsonrpc": "2.0", "id": message_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


def main() -> None:
    print("SLR config MCP server is running over stdio", file=sys.stderr, flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            messages = message if isinstance(message, list) else [message]
            responses = [response for response in (_handle(item) for item in messages) if response is not None]
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
