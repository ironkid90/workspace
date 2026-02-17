from __future__ import annotations

from collections import Counter, deque
from copy import deepcopy
from datetime import datetime
import re
import threading
from typing import Any, Deque, Dict

_HISTORY_MAX = 500
_POLICY_MAX = 200

_LOCK = threading.Lock()
_TOOL_HISTORY: Deque[Dict[str, Any]] = deque(maxlen=_HISTORY_MAX)
_POLICY_DENIALS: Deque[Dict[str, Any]] = deque(maxlen=_POLICY_MAX)
_ERROR_COUNTERS: Counter[str] = Counter()

_SECRET_PATTERNS = (
    re.compile(r"(token|password|secret|api[_-]?key)\s*[=:]\s*[^\s]+", re.IGNORECASE),
    re.compile(r"bearer\s+[a-z0-9._-]+", re.IGNORECASE),
)


def redact_text(value: str, max_chars: int = 4000) -> str:
    if not value:
        return value
    text = value
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    if len(text) > max_chars:
        return f"{text[:max_chars]}...[TRUNCATED]"
    return text


def _sanitize_value(value: Any, key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {k: _sanitize_value(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_value(v, key) for v in value]
    if isinstance(value, str):
        if key in {"cmd", "stdout", "stderr", "content", "error"}:
            return redact_text(value)
        return redact_text(value, max_chars=1500)
    return value


def record_tool_call(name: str, method: str, path: str, payload: Dict[str, Any] | None, response: Dict[str, Any]) -> None:
    now = datetime.utcnow().isoformat() + "Z"
    ok = bool(response.get("ok", True))
    error_value = response.get("error") or response.get("detail")
    error_key = "none" if ok else str(error_value or "unknown_error")

    entry = {
        "timestamp": now,
        "name": name,
        "method": method,
        "path": path,
        "ok": ok,
        "request": _sanitize_value(payload or {}),
        "response": _sanitize_value(response),
    }

    with _LOCK:
        _TOOL_HISTORY.appendleft(entry)
        if not ok:
            _ERROR_COUNTERS[error_key] += 1
            if "outside allowed base directory" in error_key.lower():
                _POLICY_DENIALS.appendleft(
                    {
                        "timestamp": now,
                        "name": name,
                        "path": path,
                        "error": redact_text(error_key),
                    }
                )


def get_tool_history(offset: int = 0, limit: int = 20) -> Dict[str, Any]:
    safe_offset = max(offset, 0)
    safe_limit = max(1, min(limit, 100))
    with _LOCK:
        items = list(_TOOL_HISTORY)
    total = len(items)
    sliced = items[safe_offset : safe_offset + safe_limit]
    return {"total": total, "offset": safe_offset, "limit": safe_limit, "items": deepcopy(sliced)}


def get_policy_denials(offset: int = 0, limit: int = 20) -> Dict[str, Any]:
    safe_offset = max(offset, 0)
    safe_limit = max(1, min(limit, 100))
    with _LOCK:
        items = list(_POLICY_DENIALS)
    total = len(items)
    sliced = items[safe_offset : safe_offset + safe_limit]
    return {"total": total, "offset": safe_offset, "limit": safe_limit, "items": deepcopy(sliced)}


def get_error_counters() -> Dict[str, int]:
    with _LOCK:
        return dict(_ERROR_COUNTERS)
