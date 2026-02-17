from __future__ import annotations

import subprocess
from typing import Any, Dict


ERROR_MESSAGES: Dict[str, str] = {
    "not_found": "Requested resource was not found.",
    "invalid_path": "Provided path or path-like input is invalid.",
    "permission_denied": "Operation is not permitted in the allowed base directory.",
    "timeout": "Operation timed out.",
    "internal_error": "Unexpected internal error.",
}


class ToolError(Exception):
    def __init__(self, code: str, message: str | None = None):
        self.code = code
        self.message = message or ERROR_MESSAGES.get(code, "Operation failed.")
        super().__init__(self.message)


def success(**data: Any) -> Dict[str, Any]:
    return {"ok": True, **data}


def error(code: str, message: str | None = None, **data: Any) -> Dict[str, Any]:
    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message or ERROR_MESSAGES.get(code, "Operation failed."),
        },
        **data,
    }


def from_exception(exc: Exception, default_code: str = "internal_error", **data: Any) -> Dict[str, Any]:
    if isinstance(exc, ToolError):
        return error(exc.code, exc.message, **data)
    if isinstance(exc, FileNotFoundError):
        return error("not_found", str(exc), **data)
    if isinstance(exc, PermissionError):
        return error("permission_denied", str(exc), **data)
    if isinstance(exc, (TimeoutError, subprocess.TimeoutExpired)):
        return error("timeout", str(exc), **data)
    return error(default_code, str(exc) or None, **data)
