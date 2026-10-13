#!/usr/bin/env python3
"""Python stdlib runtime for the Open-Science SLR MCP servers.

The Node package is only the npx installer.  This module owns the API client,
bounded response handling, safe profile metadata, and shared configuration
helpers used by both Python MCP stdio servers.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


DEFAULT_API_BASE_URL = "https://slr-api.hyperdatalab.org/api"
DEFAULT_TIMEOUT_MS = 30_000
DEFAULT_JSON_RESPONSE_BYTES = 24 * 1024 * 1024
DEFAULT_MARKDOWN_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_RESULT_BODY_BYTES = 30 * 1024
MAX_REASONING = 16_000
MAX_DECISION = 100
RETRYABLE_STATUSES = {500, 502}
APPROVED_API_HOSTS = {"slr-api.hyperdatalab.org", "localhost", "127.0.0.1", "::1"}
PROFILE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
OPERATION_ID_RE = re.compile(r"^[a-f0-9-]{16,80}$", re.I)


class ApiError(Exception):
    """Safe error returned by the API/config boundary."""

    def __init__(self, message: str, status: int | None = None, code: str = "ERROR", retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.retry_after = retry_after

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.status is not None:
            result["status"] = self.status
        if self.retry_after is not None:
            result["retryAfterSeconds"] = self.retry_after
        return result


def redact_secret(value: Any, secret: str | None) -> Any:
    if not secret or not isinstance(value, str):
        return value
    return value.replace(secret, "[REDACTED]")


def safe_display(value: Any, secret: str | None = None, limit: int = 500) -> str:
    text = str(redact_secret(value if value is not None else "", secret))
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def canonical_json(value: Any) -> str:
    """Match the target JS canonicalizer for confirmation digests."""
    if value is None or isinstance(value, (bool, int, str)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ApiError("confirmation payload contains a non-finite number", code="VALIDATION")
        if value == 0:
            return "0"
        if value.is_integer() and abs(value) < 1e21:
            return str(int(value))
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(str(key), ensure_ascii=False, separators=(",", ":"))
            + ":"
            + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    return json.dumps(str(value), ensure_ascii=False, separators=(",", ":"))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def token_fingerprint(token: str) -> str:
    return sha256_hex(str(token or ""))


def mask_token(token: str | None) -> str:
    value = str(token or "")
    return f"set (…{value[-4:]}, {len(value)} chars)" if len(value) >= 12 else "set"


def normalize_profile_name(value: str | None) -> str:
    name = str(value or "").strip().lower()
    if not PROFILE_NAME_RE.fullmatch(name):
        raise ApiError("profile name must use 1-64 lowercase letters, numbers, hyphens, or underscores", code="VALIDATION")
    return name


def normalize_api_base_url(raw: str | None, allowed_hosts: Iterable[str] | None = None) -> str:
    text = str(raw or "").strip()
    try:
        parsed = urllib.parse.urlparse(text)
    except ValueError as exc:
        raise ApiError("api base URL must be a valid http(s) URL", code="VALIDATION") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ApiError("api base URL must be a valid http(s) URL", code="VALIDATION")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ApiError("api base URL must not contain credentials, query parameters, or fragments", code="VALIDATION")
    host = (parsed.hostname or "").lower()
    allowed = {h.lower() for h in (allowed_hosts or APPROVED_API_HOSTS)}
    if host not in allowed:
        raise ApiError(f"api base URL host is not allowed: {parsed.hostname}", code="VALIDATION")
    if parsed.scheme == "http" and host not in {"localhost", "127.0.0.1", "::1"}:
        raise ApiError("api base URL must use HTTPS unless it targets local loopback development", code="VALIDATION")
    return text.rstrip("/")


def _parse_int_env(name: str, raw: str | None, default: int, minimum: int, maximum: int) -> int:
    if not str(raw or "").strip():
        return default
    try:
        value = int(str(raw).strip())
    except ValueError as exc:
        raise ApiError(f"{name} must be an integer from {minimum} to {maximum}", code="CONFIG") from exc
    if value < minimum or value > maximum:
        raise ApiError(f"{name} must be an integer from {minimum} to {maximum}", code="CONFIG")
    return value


def config_root(environment: dict[str, str] | None = None) -> Path:
    env = environment or os.environ
    return Path(env.get("SLR_CONFIG_DIR", "~/.slr")).expanduser().resolve()


def _store_path(root: Path) -> Path:
    return root / "profiles.json"


def _empty_store() -> dict[str, Any]:
    return {"version": 1, "activeProfile": None, "profiles": {}}


def _assert_no_secrets(value: Any, parent_key: str = "") -> None:
    if not isinstance(value, dict):
        if isinstance(value, list):
            for item in value:
                _assert_no_secrets(item, parent_key)
        return
    allowed = {"tokenSource", "hasCredentialBinding", "hasLocalToken", "credentialFingerprint"}
    profile_fields = {
        "name", "apiBaseUrl", "projectId", "projectName", "credentialId", "connectorId",
        "connectorName", "tokenSource", "hasLocalToken", "credentialFingerprint", "workspaceId",
        "workspaceRoot", "createdAt", "updatedAt",
    }
    for key, child in value.items():
        if parent_key == "profile-record" and key not in profile_fields:
            raise ApiError("profile store contains an unsupported profile field", code="CONFIG")
        if key == "credentialFingerprint" and child not in (None, "") and not re.fullmatch(r"[0-9a-f]{64}", str(child), re.I):
            raise ApiError("profile store contains an invalid credential fingerprint", code="CONFIG")
        if parent_key != "profiles" and key not in allowed and re.search(r"token|secret|password|authorization|api.?key", key, re.I):
            raise ApiError("profile store contains a forbidden secret field", code="CONFIG")
        _assert_no_secrets(child, "profile-record" if parent_key == "profiles" else key)


def _remove_legacy_token_files(root: Path, store: dict[str, Any]) -> None:
    token_root = root / "tokens"
    profiles = store.get("profiles")
    if not isinstance(profiles, dict):
        return
    for name in profiles:
        if not isinstance(name, str) or not PROFILE_NAME_RE.fullmatch(name):
            continue
        legacy_path = token_root / name
        if not legacy_path.exists() and not legacy_path.is_symlink():
            continue
        try:
            legacy_path.unlink()
        except OSError as exc:
            raise ApiError("unable to remove a legacy plaintext token file", code="CONFIG") from exc


def read_store(environment: dict[str, str] | None = None) -> dict[str, Any]:
    path = _store_path(config_root(environment))
    if not path.exists():
        return _empty_store()
    try:
        store = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ApiError("profile store is invalid JSON; repair or remove it before continuing", code="CONFIG") from exc
    if not isinstance(store, dict) or store.get("version") != 1 or not isinstance(store.get("profiles"), dict):
        raise ApiError("unsupported profile store version; expected 1", code="CONFIG")
    _assert_no_secrets(store)
    _remove_legacy_token_files(config_root(environment), store)
    return store


def _write_store(store: dict[str, Any], environment: dict[str, str] | None = None) -> None:
    root = config_root(environment)
    root.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(root, 0o700)
    except OSError:
        pass
    fd, temporary = tempfile.mkstemp(prefix="profiles.", suffix=".tmp", dir=str(root))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(store, ensure_ascii=False, indent=2) + "\n")
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        destination = _store_path(root)
        for attempt in range(8):
            try:
                os.replace(temporary, destination)
                break
            except OSError:
                if attempt == 7:
                    raise
                time.sleep(0.025 * (attempt + 1))
    finally:
        try:
            Path(temporary).unlink(missing_ok=True)
        except OSError:
            pass


def _workspace_root(root: Path, name: str, workspace_id: str) -> str:
    return str(root / "profiles" / name / workspace_id / "paper-review")


def _public_profile(profile: dict[str, Any], active: bool = False) -> dict[str, Any]:
    return {
        "name": profile.get("name"),
        "apiBaseUrl": profile.get("apiBaseUrl"),
        "projectId": profile.get("projectId") or None,
        "projectName": profile.get("projectName") or None,
        "credentialId": profile.get("credentialId") or None,
        "connectorId": profile.get("connectorId") or None,
        "connectorName": profile.get("connectorName") or None,
        "tokenSource": profile.get("tokenSource", "unconfigured"),
        "hasLocalToken": False,
        "hasCredentialBinding": bool(profile.get("credentialId")),
        "workspaceRoot": profile.get("workspaceRoot"),
        "active": active,
        "createdAt": profile.get("createdAt"),
        "updatedAt": profile.get("updatedAt"),
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def list_profiles(environment: dict[str, str] | None = None) -> list[dict[str, Any]]:
    store = read_store(environment)
    return [_public_profile(profile, store.get("activeProfile") == name) for name, profile in store["profiles"].items()]


def get_profile(name: str, environment: dict[str, str] | None = None) -> dict[str, Any]:
    normalized = normalize_profile_name(name)
    store = read_store(environment)
    profile = store["profiles"].get(normalized)
    if not profile:
        raise ApiError(f"profile not found: {normalized}", code="CONFIG")
    return _public_profile(profile, store.get("activeProfile") == normalized)


def active_profile(environment: dict[str, str] | None = None) -> dict[str, Any] | None:
    store = read_store(environment)
    name = store.get("activeProfile")
    return get_profile(name, environment) if name else None


def profile_from_environment(environment: dict[str, str] | None = None) -> dict[str, Any] | None:
    env = environment or os.environ
    name = env.get("SLR_PROFILE_NAME") or env.get("REVIEW_PROFILE")
    if name:
        return get_profile(name, env)
    return active_profile(env)


def create_or_update_profile(name: str, api_base_url: str, environment: dict[str, str] | None = None) -> dict[str, Any]:
    env = environment or os.environ
    normalized = normalize_profile_name(name)
    normalized_url = normalize_api_base_url(api_base_url)
    store = read_store(env)
    timestamp = _now()
    current = store["profiles"].get(normalized)
    if current:
        current["apiBaseUrl"] = normalized_url
        current["updatedAt"] = timestamp
        _write_store(store, env)
        return _public_profile(current, store.get("activeProfile") == normalized)
    root = config_root(env)
    workspace_id = str(uuid.uuid4())
    profile = {
        "name": normalized,
        "apiBaseUrl": normalized_url,
        "projectId": None,
        "projectName": None,
        "credentialId": None,
        "connectorId": None,
        "connectorName": f"slr-{normalized}",
        "tokenSource": "unconfigured",
        "hasLocalToken": False,
        "credentialFingerprint": None,
        "workspaceId": workspace_id,
        "workspaceRoot": _workspace_root(root, normalized, workspace_id),
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    store["profiles"][normalized] = profile
    if not store.get("activeProfile"):
        store["activeProfile"] = normalized
    _write_store(store, env)
    return _public_profile(profile, store.get("activeProfile") == normalized)


def commit_profile_configuration(name: str, changes: dict[str, Any], environment: dict[str, str] | None = None) -> dict[str, Any]:
    env = environment or os.environ
    normalized = normalize_profile_name(name)
    store = read_store(env)
    original = json.loads(json.dumps(store))
    timestamp = _now()
    root = config_root(env)
    profile = store["profiles"].get(normalized)
    if not profile:
        workspace_id = str(uuid.uuid4())
        profile = {
            "name": normalized,
            "apiBaseUrl": normalize_api_base_url(changes.get("apiBaseUrl")),
            "projectId": None,
            "projectName": None,
            "credentialId": None,
            "connectorId": None,
            "connectorName": f"slr-{normalized}",
            "tokenSource": "unconfigured",
            "hasLocalToken": False,
            "credentialFingerprint": None,
            "workspaceId": workspace_id,
            "workspaceRoot": _workspace_root(root, normalized, workspace_id),
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
    try:
        if "apiBaseUrl" in changes:
            profile["apiBaseUrl"] = normalize_api_base_url(changes["apiBaseUrl"])
        for key in ("projectId", "projectName", "credentialId", "connectorId", "connectorName"):
            if key in changes:
                profile[key] = str(changes.get(key) or "").strip() or None
        if "credentialId" in changes:
            profile["tokenSource"] = "open-science-credential" if profile.get("credentialId") else "unconfigured"
        if "credentialFingerprint" in changes:
            fingerprint = str(changes.get("credentialFingerprint") or "").strip() or None
            if fingerprint and not re.fullmatch(r"[0-9a-f]{64}", fingerprint, re.I):
                raise ApiError("credential fingerprint must be a SHA-256 hex digest", code="CONFIG")
            profile["credentialFingerprint"] = fingerprint.lower() if fingerprint else None
        profile["hasLocalToken"] = False
        profile["updatedAt"] = timestamp
        store["profiles"][normalized] = profile
        _write_store(store, env)
    except Exception:
        try:
            _write_store(original, env)
        except Exception:
            pass
        raise
    return _public_profile(profile, store.get("activeProfile") == normalized)


def activate_profile(name: str, environment: dict[str, str] | None = None) -> dict[str, Any]:
    env = environment or os.environ
    normalized = normalize_profile_name(name)
    store = read_store(env)
    if normalized not in store["profiles"]:
        raise ApiError(f"profile not found: {normalized}", code="CONFIG")
    store["activeProfile"] = normalized
    _write_store(store, env)
    return _public_profile(store["profiles"][normalized], True)


def capture_profile_store(environment: dict[str, str] | None = None) -> dict[str, Any]:
    return json.loads(json.dumps(read_store(environment)))


def restore_profile_store(snapshot: dict[str, Any], environment: dict[str, str] | None = None) -> dict[str, Any] | None:
    if not isinstance(snapshot, dict) or snapshot.get("version") != 1 or not isinstance(snapshot.get("profiles"), dict):
        raise ApiError("invalid profile store snapshot", code="CONFIG")
    _assert_no_secrets(snapshot)
    _write_store(json.loads(json.dumps(snapshot)), environment)
    return active_profile(environment)


def find_profiles_by_token(token: str, environment: dict[str, str] | None = None, api_base_url: str | None = None) -> list[dict[str, Any]]:
    fingerprint = token_fingerprint(token)
    normalized_url = normalize_api_base_url(api_base_url) if api_base_url else None
    store = read_store(environment)
    return [
        _public_profile(profile, store.get("activeProfile") == name)
        for name, profile in store["profiles"].items()
        if profile.get("credentialFingerprint") == fingerprint
        and (not normalized_url or profile.get("apiBaseUrl") == normalized_url)
    ]


def find_profiles_by_project_id(project_id: str, environment: dict[str, str] | None = None, api_base_url: str | None = None) -> list[dict[str, Any]]:
    normalized_url = normalize_api_base_url(api_base_url) if api_base_url else None
    return [
        profile for profile in list_profiles(environment)
        if profile.get("projectId") == str(project_id or "").strip()
        and (not normalized_url or profile.get("apiBaseUrl") == normalized_url)
    ]


@dataclass(frozen=True)
class McpConfig:
    api_base_url: str
    agent_token: str
    timeout_ms: int = DEFAULT_TIMEOUT_MS
    profile_id: str = "active-profile"
    project_id: str = "unknown-project"
    project_name: str = "SLR project"
    max_json_response_bytes: int = DEFAULT_JSON_RESPONSE_BYTES
    max_markdown_response_bytes: int = DEFAULT_MARKDOWN_RESPONSE_BYTES


def load_mcp_config(environment: dict[str, str] | None = None) -> McpConfig:
    env = environment or os.environ
    profile = profile_from_environment(env)
    raw_url = str(env.get("SLR_API_BASE_URL") or (profile or {}).get("apiBaseUrl") or "").strip()
    if not raw_url:
        raise ApiError("SLR_API_BASE_URL is required", code="CONFIG")
    token = str(env.get("SLR_AGENT_TOKEN") or "").strip()
    if not token:
        raise ApiError("SLR_AGENT_TOKEN is required", code="CONFIG")
    requested_hosts = [value.strip().lower() for value in str(env.get("SLR_API_ALLOWED_HOSTS") or "").split(",") if value.strip()]
    unsupported = [host for host in requested_hosts if host not in APPROVED_API_HOSTS]
    if unsupported:
        raise ApiError(f"SLR_API_ALLOWED_HOSTS contains an unapproved host: {unsupported[0]}", code="CONFIG")
    url = normalize_api_base_url(raw_url, requested_hosts or APPROVED_API_HOSTS)
    return McpConfig(
        api_base_url=url,
        agent_token=token,
        timeout_ms=_parse_int_env("SLR_REQUEST_TIMEOUT_MS", env.get("SLR_REQUEST_TIMEOUT_MS"), DEFAULT_TIMEOUT_MS, 1_000, 120_000),
        profile_id=str(env.get("SLR_PROFILE_ID") or (profile or {}).get("name") or "active-profile"),
        project_id=str(env.get("SLR_PROJECT_ID") or (profile or {}).get("projectId") or "unknown-project"),
        project_name=str(env.get("SLR_PROJECT_NAME") or (profile or {}).get("projectName") or "SLR project"),
        max_json_response_bytes=_parse_int_env("SLR_MAX_JSON_RESPONSE_BYTES", env.get("SLR_MAX_JSON_RESPONSE_BYTES"), DEFAULT_JSON_RESPONSE_BYTES, 16 * 1024, 32 * 1024 * 1024),
        max_markdown_response_bytes=_parse_int_env("SLR_MAX_MARKDOWN_RESPONSE_BYTES", env.get("SLR_MAX_MARKDOWN_RESPONSE_BYTES"), DEFAULT_MARKDOWN_RESPONSE_BYTES, 16 * 1024, 32 * 1024 * 1024),
    )


class AgentApiClient:
    """Bounded stdlib client for the current agent API contract."""

    def __init__(self, config: McpConfig, base_url: str | None = None, token: str | None = None):
        self.config = config
        self.base_url = normalize_api_base_url(base_url or config.api_base_url).rstrip("/") + "/agent/v1"
        self.token = token or config.agent_token
        self.timeout = max(1, config.timeout_ms / 1000)
        host = (urllib.parse.urlparse(self.base_url).hostname or "").lower()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if host in {"localhost", "127.0.0.1", "::1"} else urllib.request.build_opener()

    def _read_bounded(self, response: Any, max_bytes: int) -> str:
        content_length = response.headers.get("Content-Length")
        if content_length:
            try:
                too_large = int(content_length) > max_bytes
            except (TypeError, ValueError):
                too_large = False
            if too_large:
                raise ApiError("SLR API response exceeded the configured size limit", 502, "RESPONSE_TOO_LARGE")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = response.read(min(64 * 1024, max_bytes - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ApiError("SLR API response exceeded the configured size limit", 502, "RESPONSE_TOO_LARGE")
            chunks.append(chunk)
        return b"".join(chunks).decode("utf-8", "replace")

    def _request(self, path: str, method: str = "GET", body: Any = None, accept: str = "application/json", accepted: set[int] | None = None) -> tuple[int, dict[str, str], str]:
        url = self.base_url + path
        payload = _json_bytes(body) if body is not None else None
        headers = {"Authorization": f"Bearer {self.token}", "Accept": accept, "User-Agent": "slr-agent-python/1.0"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        for attempt in range(2):
            request = urllib.request.Request(url, data=payload, method=method, headers=headers)
            try:
                with self.opener.open(request, timeout=self.timeout) as response:
                    status = int(response.status)
                    raw = self._read_bounded(response, self.config.max_markdown_response_bytes if "text/markdown" in accept else self.config.max_json_response_bytes)
                    if status not in (accepted or set()) and not 200 <= status < 300:
                        raise self._api_error(status, response.headers, raw)
                    if method == "GET" and status in RETRYABLE_STATUSES and attempt == 0:
                        time.sleep(0.1)
                        continue
                    return status, {key.lower(): value for key, value in response.headers.items()}, raw
            except urllib.error.HTTPError as exc:
                raw = self._read_bounded(exc, self.config.max_json_response_bytes)
                if exc.code in RETRYABLE_STATUSES and attempt == 0 and method == "GET":
                    time.sleep(0.1)
                    continue
                raise self._api_error(exc.code, exc.headers, raw)
            except urllib.error.URLError as exc:
                if method == "GET" and attempt == 0:
                    time.sleep(0.1)
                    continue
                raise ApiError("Unable to connect to the SLR API", 502, "API_UNREACHABLE") from exc
            except TimeoutError as exc:
                raise ApiError("SLR API request timed out", 504, "REQUEST_TIMEOUT") from exc
        raise ApiError("SLR API request failed", 502, "API_UNREACHABLE")

    def _api_error(self, status: int, headers: Any, raw: str) -> ApiError:
        try:
            parsed = json.loads(raw or "{}")
        except json.JSONDecodeError:
            parsed = {}
        error = parsed.get("error") if isinstance(parsed, dict) else {}
        message = redact_secret(error.get("message") if isinstance(error, dict) else None, self.token) or f"SLR API request failed with HTTP {status}"
        code = error.get("code") if isinstance(error, dict) else None
        if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_:-]{1,64}", code) or self.token in code:
            code = f"HTTP_{status}"
        retry_after = None
        try:
            retry_after = int(float(headers.get("Retry-After", "")))
        except (TypeError, ValueError):
            pass
        return ApiError(str(message), status, code, retry_after)

    def _json(self, path: str, method: str = "GET", body: Any = None, accepted: set[int] | None = None) -> Any:
        _, _, raw = self._request(path, method, body, "application/json", accepted)
        try:
            parsed = json.loads(raw or "null")
        except json.JSONDecodeError as exc:
            raise ApiError("SLR API returned invalid JSON", 502, "INVALID_JSON") from exc
        if not isinstance(parsed, dict) or parsed.get("success") is not True or "data" not in parsed:
            raise ApiError("Backend returned an invalid success envelope", 502, "INVALID_RESPONSE")
        return parsed["data"]

    def list_assigned_tasks(self, limit: int = 50, cursor: str | None = None) -> dict[str, Any]:
        limit = max(1, min(100, int(limit)))
        query = urllib.parse.urlencode({"limit": limit, **({"cursor": cursor} if cursor else {})})
        return self._json(f"/tasks?{query}")

    def get_assigned_task(self, task_id: str) -> dict[str, Any]:
        return self._json(f"/tasks/{urllib.parse.quote(str(task_id), safe='')}")

    def get_task_fulltext(self, task_id: str) -> dict[str, Any]:
        status, headers, raw = self._request(f"/tasks/{urllib.parse.quote(str(task_id), safe='')}/markdown", accept="text/markdown, application/json", accepted={202})
        if status == 202:
            try:
                data = json.loads(raw or "{}").get("data", {})
            except json.JSONDecodeError:
                data = {}
            return {"kind": "pending", "status": data.get("status", "PROCESSING"), "retryAfterSeconds": _retry_after(headers)}
        return {"kind": "ready", "markdown": raw}

    def submit_review_result(self, task_id: str, input_data: dict[str, Any]) -> Any:
        if len(_json_bytes(input_data)) > MAX_RESULT_BODY_BYTES:
            raise ApiError("Review result body must not exceed 30 KB", 400, "REQUEST_TOO_LARGE")
        return self._json(f"/tasks/{urllib.parse.quote(str(task_id), safe='')}/result", "POST", input_data)

    def get_extraction_context(self, task_id: str) -> Any:
        return self._json(f"/extraction/tasks/{urllib.parse.quote(str(task_id), safe='')}/context")

    def get_extraction_fulltext(self, task_id: str) -> Any:
        status, headers, raw = self._request(f"/extraction/tasks/{urllib.parse.quote(str(task_id), safe='')}/fulltext", accept="application/json", accepted={202})
        try:
            parsed = json.loads(raw or "null")
        except json.JSONDecodeError as exc:
            raise ApiError("Backend returned invalid extraction full-text JSON", 502, "INVALID_RESPONSE") from exc
        if status == 202:
            data = parsed.get("data", {}) if isinstance(parsed, dict) else {}
            return {"kind": "pending", "status": data.get("status", "PROCESSING"), "retryAfterSeconds": _retry_after(headers)}
        if not isinstance(parsed, dict) or parsed.get("success") is not True or not isinstance(parsed.get("data"), dict):
            raise ApiError("Backend returned an invalid extraction full-text response", 502, "INVALID_RESPONSE")
        return parsed["data"]

    def save_extraction_draft(self, input_data: dict[str, Any]) -> Any:
        task_id = urllib.parse.quote(str(input_data["taskId"]), safe="")
        body = {key: input_data[key] for key in ("templateVersion", "values", "evidence", "expectedVersion") if key in input_data}
        return self._json(f"/extraction/tasks/{task_id}/draft", "PUT", body)

    def check_extraction_draft(self, task_id: str) -> Any:
        return self._json(f"/extraction/tasks/{urllib.parse.quote(str(task_id), safe='')}/check", "POST")

    def create_extraction_submit_challenge(self, task_id: str) -> Any:
        return self._json(f"/extraction/tasks/{urllib.parse.quote(str(task_id), safe='')}/submit-challenge", "POST")

    def submit_extraction(self, task_id: str, challenge_id: str, payload_digest: str) -> Any:
        body = {"challengeId": challenge_id, "payloadDigest": payload_digest, "idempotencyKey": f"mcp-extraction-{task_id}-{payload_digest}"}
        return self._json(f"/extraction/tasks/{urllib.parse.quote(str(task_id), safe='')}/submit", "POST", body)

    def create_consensus_challenge(self, input_data: dict[str, Any]) -> Any:
        task_id = urllib.parse.quote(str(input_data["taskId"]), safe="")
        body = {key: input_data[key] for key in ("expectedVersion", "values", "findings") if key in input_data}
        return self._json(f"/extraction/tasks/{task_id}/consensus-challenge", "POST", body)

    def submit_consensus_proposal(self, task_id: str, challenge_id: str, payload_digest: str) -> Any:
        body = {"challengeId": challenge_id, "payloadDigest": payload_digest, "idempotencyKey": f"mcp-consensus-{task_id}-{payload_digest}"}
        return self._json(f"/extraction/tasks/{urllib.parse.quote(str(task_id), safe='')}/consensus-proposal", "POST", body)


def _retry_after(headers: dict[str, str]) -> int:
    try:
        return max(0, int(float(headers.get("retry-after", "10"))))
    except (TypeError, ValueError):
        return 10


def build_review_body(decision: Any, reasoning: Any, data: Any = None) -> dict[str, Any]:
    if not isinstance(decision, str) or not isinstance(reasoning, str):
        raise ApiError("decision and reasoning must be strings", code="VALIDATION")
    normalized_decision = decision.strip()
    normalized_reasoning = reasoning.strip()
    if not normalized_decision or len(normalized_decision) > MAX_DECISION:
        raise ApiError("decision must be 1-100 characters", code="VALIDATION")
    if not normalized_reasoning or len(normalized_reasoning) > MAX_REASONING:
        raise ApiError("reasoning is required and must be at most 16,000 characters", code="VALIDATION")
    body: dict[str, Any] = {"decision": normalized_decision, "reasoning": normalized_reasoning}
    if data is not None:
        if not isinstance(data, dict):
            raise ApiError("data must be a JSON object", code="VALIDATION")
        body["data"] = data
    if len(_json_bytes(body)) > MAX_RESULT_BODY_BYTES:
        raise ApiError("Review result body must not exceed 30 KB", 400, "REQUEST_TOO_LARGE")
    return body


def build_confirmation_payload(config: McpConfig, task_id: str, body: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "profileId": config.profile_id,
        "projectId": config.project_id,
        "taskId": task_id,
        "decision": body["decision"],
        "reasoning": body["reasoning"],
    }
    if "data" in body:
        payload["data"] = body["data"]
    return payload


def confirmation_digest(config: McpConfig, task_id: str, body: dict[str, Any]) -> str:
    return sha256_hex(canonical_json(build_confirmation_payload(config, task_id, body)))


def _resolve_windows_cli_shim(executable: str, args: list[str], environment: dict[str, str] | None = None) -> tuple[list[str], dict[str, str]] | None:
    """Resolve an Open-Science managed .cmd shim to direct Electron execution."""
    if os.name != "nt" or not executable.lower().endswith((".cmd", ".bat")):
        return None
    try:
        shim = Path(executable)
        text = shim.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    app_match = re.search(r'^set\s+"OPEN_SCIENCE_APP_PATH=([^"\r\n]+)"', text, re.I | re.M)
    launch_match = re.search(r'^"([^"]+open-science\.exe)"\s+"([^"]+cli[\\/]index\.mjs)"\s+%\*', text, re.I | re.M)
    app_path = Path(app_match.group(1).strip()) if app_match else None
    launch_path = Path(launch_match.group(2).strip()) if launch_match else None
    if not app_path or not launch_path or not app_path.is_file() or not launch_path.is_file():
        return None
    child_environment = dict(environment or os.environ)
    child_environment["ELECTRON_RUN_AS_NODE"] = "1"
    return [str(app_path), str(launch_path), *args], child_environment


def run_json_command(executable: str, args: list[str], input_value: str | None = None, timeout: float = 15.0, environment: dict[str, str] | None = None) -> tuple[int | None, str, str, Exception | None]:
    try:
        command = _resolve_windows_cli_shim(executable, args, environment)
        child_environment = None
        if command:
            command, child_environment = command
        else:
            command = [executable, *args]
            child_environment = environment
        completed = subprocess.run(command, input=input_value, capture_output=True, text=True, timeout=timeout, shell=False, encoding="utf-8", errors="replace", env=child_environment, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return completed.returncode, completed.stdout, completed.stderr, None
    except Exception as exc:
        return None, "", "", exc


def parse_json_output(text: str) -> Any:
    try:
        return json.loads(text.strip())
    except (TypeError, json.JSONDecodeError):
        return None


def detect_open_science_cli(environment: dict[str, str] | None = None) -> dict[str, Any]:
    env = environment or os.environ
    candidates: list[str] = []
    if env.get("OPEN_SCIENCE_CLI"):
        candidates.append(env["OPEN_SCIENCE_CLI"])
    if os.name == "nt":
        code, stdout, _, _ = run_json_command("where.exe", ["open-science"], timeout=2)
        if code == 0 and stdout.strip():
            candidates.extend(line.strip() for line in stdout.splitlines() if line.strip())
        appdata = env.get("APPDATA")
        local = env.get("LOCALAPPDATA")
        for root in (appdata, local):
            if root:
                candidates.extend([str(Path(root) / "Open-Science" / "open-science.cmd"), str(Path(root) / "Open-Science" / "bin" / "open-science.cmd")])
        if appdata:
            candidates.append(str(Path(appdata) / "npm" / "open-science.cmd"))
    else:
        import shutil
        found = shutil.which("open-science")
        if found:
            candidates.append(found)
    for candidate in dict.fromkeys(candidates):
        if not candidate or not (Path(candidate).exists() or os.path.basename(candidate) == "open-science"):
            continue
        code, stdout, _, error = run_json_command(candidate, ["status", "--json"], timeout=2, environment=env)
        state = parse_json_output(stdout) if not error else None
        if isinstance(state, dict) and isinstance(state.get("running"), bool):
            return {"available": True, "executable": candidate, "source": "path"}
    return {"available": False}


def open_science_report(environment: dict[str, str] | None = None) -> dict[str, Any]:
    return {"openScienceCli": detect_open_science_cli(environment)}


def connector_script_path(name: str) -> Path:
    return Path(__file__).resolve().with_name(name)


def connector_config(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": profile.get("connectorName") or f"slr-{profile.get('name')}",
        "displayName": f"SLR ({profile.get('projectName') or profile.get('name')})",
        "transport": "stdio",
        "command": sys.executable,
        "args": [str(connector_script_path("slr_mcp.py"))],
        "env": {"SLR_PROFILE_NAME": profile.get("name")},
        **({"envCredentialIds": {"SLR_AGENT_TOKEN": profile["credentialId"]}} if profile.get("credentialId") else {}),
    }


def config_connector_config(credential_id: str | None = None) -> dict[str, Any]:
    return {
        "name": "slr-config",
        "displayName": "SLR Config",
        "transport": "stdio",
        "command": sys.executable,
        "args": [str(connector_script_path("slr_config_mcp.py"))],
        **({"envCredentialIds": {"SLR_AGENT_TOKEN": credential_id}} if credential_id else {}),
    }


def failure_code(stdout: str, stderr: str) -> str | None:
    value = parse_json_output(stderr) or parse_json_output(stdout) or {}
    return value.get("error", {}).get("code") if isinstance(value, dict) and isinstance(value.get("error"), dict) else value.get("code") if isinstance(value, dict) else None


def ensure_open_science_daemon(executable: str) -> dict[str, Any]:
    code, stdout, _, error = run_json_command(executable, ["status", "--json"], timeout=2)
    state = parse_json_output(stdout) if code == 0 and not error else None
    if isinstance(state, dict) and state.get("running") is True:
        return {"ready": True, "started": False}
    code, _, stderr, error = run_json_command(executable, ["start", "--no-open"], timeout=8)
    if error or code != 0:
        return {"ready": False, "started": False, "reason": "open-science-daemon-start-failed"}
    for _ in range(8):
        time.sleep(0.25)
        code, stdout, _, _ = run_json_command(executable, ["status", "--json"], timeout=2)
        state = parse_json_output(stdout) if code == 0 else None
        if isinstance(state, dict) and state.get("running") is True:
            return {"ready": True, "started": True}
    return {"ready": False, "started": True, "reason": "open-science-daemon-not-ready"}


def _credential_records(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        for key in ("credentials", "data"):
            child = value.get(key)
            if isinstance(child, list):
                return [item for item in child if isinstance(item, dict)]
            if isinstance(child, dict) and isinstance(child.get("credentials"), list):
                return [item for item in child["credentials"] if isinstance(item, dict)]
    return []


def ensure_open_science_credential(token: str, report: dict[str, Any]) -> dict[str, Any]:
    if not token:
        return {"configured": False, "reason": "token-missing"}
    info = report.get("openScienceCli") or {}
    executable = info.get("executable") if info.get("available") else None
    if not executable:
        return {"configured": False, "reason": "open-science-cli-not-detected"}
    daemon = ensure_open_science_daemon(executable)
    if not daemon.get("ready"):
        return {"configured": False, "reason": daemon.get("reason", "open-science-daemon-not-ready")}
    code, stdout, stderr, error = run_json_command(executable, ["credential", "list", "--json"])
    if error or code != 0:
        return {"configured": False, "reason": f"open-science-credential-list-failed:{failure_code(stdout, stderr) or 'unknown'}"}
    records = _credential_records(parse_json_output(stdout))
    existing = next((item for item in records if item.get("kind") == "token" and item.get("displayName") == "SLR_AGENT_TOKEN"), None)
    args = ["credential", "update", str(existing.get("id")), "--json"] if existing else ["credential", "add", "--json"]
    payload = {"displayName": "SLR_AGENT_TOKEN", **({"kind": "token"} if not existing else {}), "secret": token}
    code, stdout, stderr, error = run_json_command(executable, args, json.dumps(payload) + "\n")
    if error or code != 0:
        return {"configured": False, "reason": f"open-science-credential-write-failed:{failure_code(stdout, stderr) or 'unknown'}"}
    written = parse_json_output(stdout) or {}
    credential_id = (written.get("createdCredential") or {}).get("id") if isinstance(written, dict) else None
    credential_id = credential_id or (written.get("credential") or {}).get("id") if isinstance(written, dict) else None
    credential_id = credential_id or (written.get("data") or {}).get("credential", {}).get("id") if isinstance(written, dict) else None
    credential_id = credential_id or (written.get("id") if isinstance(written, dict) else None) or (existing or {}).get("id")
    if not credential_id:
        return {"configured": False, "reason": "open-science-credential-id-missing"}
    return {"configured": True, "credentialId": credential_id, "displayName": "SLR_AGENT_TOKEN", "created": not bool(existing), "updated": bool(existing)}


def register_connector_definition(connector: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    info = report.get("openScienceCli") or {}
    executable = info.get("executable") if info.get("available") else None
    if not executable:
        return {"registered": False, "reason": "open-science-cli-not-detected"}
    daemon = ensure_open_science_daemon(executable)
    if not daemon.get("ready"):
        return {"registered": False, "reason": daemon.get("reason", "open-science-daemon-not-ready")}
    code, stdout, stderr, error = run_json_command(executable, ["connector", "list", "--json"])
    if error or code != 0:
        return {"registered": False, "reason": f"open-science-connector-list-failed:{failure_code(stdout, stderr) or 'unknown'}"}
    records = parse_json_output(stdout)
    if isinstance(records, dict):
        records = records.get("connectors") or records.get("data", {}).get("connectors") or records.get("data") or []
    records = records if isinstance(records, list) else []
    existing = next((item for item in records if isinstance(item, dict) and (item.get("name") == connector.get("name") or item.get("id") == connector.get("name"))), None)
    if existing:
        args = ["connector", "update", str(existing.get("id")), "--json"]
        operation = "update"
    else:
        args = ["connector", "add", "--json"]
        operation = "add"
    code, stdout, stderr, error = run_json_command(executable, args, json.dumps(connector) + "\n")
    if error or code != 0:
        return {"registered": False, "reason": f"open-science-connector-{operation}-failed:{failure_code(stdout, stderr) or 'unknown'}"}
    result = parse_json_output(stdout) or {}
    connector_id = (existing or {}).get("id") or result.get("id") or result.get("connectorId") or (result.get("connector") or {}).get("id")
    if not connector_id:
        return {"registered": False, "reason": "open-science-connector-id-missing"}
    code, _, stderr, error = run_json_command(executable, ["connector", "enable", str(connector_id)])
    if error or code != 0:
        return {"registered": True, "enabled": False, "connector": connector_id, "reason": "open-science-connector-enable-failed"}
    return {"registered": True, "enabled": True, "connector": connector_id, "updated": operation == "update"}


def register_connector(profile: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    if not profile.get("credentialId"):
        return {"registered": False, "reason": "credential-binding-missing"}
    return register_connector_definition(connector_config(profile), report)


def register_config_connector(credential_id: str | None, report: dict[str, Any]) -> dict[str, Any]:
    if not credential_id:
        return {"registered": False, "reason": "credential-binding-missing"}
    return register_connector_definition(config_connector_config(credential_id), report)


def operation_expiry(minutes: int = 10) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat(timespec="milliseconds").replace("+00:00", "Z")

