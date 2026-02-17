import os
import shlex
import uuid
from pathlib import Path
from typing import Any, Mapping, Sequence

from .config import ALLOWED_BASE_DIR

POLICY_PROFILE_NAME = "default-restricted-v1"
MAX_TIMEOUT_S = int(os.environ.get("MCP_POLICY_MAX_TIMEOUT_S", "300"))
DENY_COMMANDS = {
    "shutdown",
    "reboot",
    "poweroff",
    "halt",
    "mkfs",
}
DENY_ENV_EXACT = {
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
}
DENY_ENV_PREFIXES = (
    "BASH_FUNC_",
)


def normalize_command(cmd: str | Sequence[str]) -> tuple[list[str] | None, str | None]:
    if isinstance(cmd, str):
        try:
            argv = shlex.split(cmd)
        except ValueError as exc:
            return None, f"invalid_command: {exc}"
    else:
        argv = [str(part) for part in cmd]
    if not argv:
        return None, "empty_command"
    return argv, None


def resolve_policy_cwd(cwd: str | None) -> str | None:
    if cwd is None:
        return None
    p = Path(cwd)
    if not p.is_absolute():
        p = (ALLOWED_BASE_DIR / p).resolve()
    else:
        p = p.resolve()
    base = ALLOWED_BASE_DIR.resolve()
    if not str(p).startswith(str(base)):
        raise PermissionError("Path is outside allowed base directory")
    return str(p)


def _sanitize_arg(arg: str) -> str:
    lowered = arg.lower()
    if any(marker in lowered for marker in ("password", "secret", "token", "apikey", "api_key")):
        return "***"
    if "=" in arg:
        key, _ = arg.split("=", 1)
        if any(marker in key.lower() for marker in ("password", "secret", "token", "apikey", "api_key")):
            return f"{key}=***"
    return arg


def sanitize_command_preview(argv: Sequence[str], max_len: int = 240) -> str:
    preview = " ".join(shlex.quote(_sanitize_arg(part)) for part in argv)
    if len(preview) > max_len:
        return preview[: max_len - 3] + "..."
    return preview


def build_audit_metadata(argv: Sequence[str], tool_name: str) -> dict[str, Any]:
    return {
        "execution_id": uuid.uuid4().hex,
        "policy_profile": POLICY_PROFILE_NAME,
        "tool": tool_name,
        "command_preview": sanitize_command_preview(argv),
    }


def check_execution_policy(
    *,
    tool_name: str,
    argv: Sequence[str],
    cwd: str | None,
    env: Mapping[str, str] | None,
    timeout_s: int | None,
) -> tuple[bool, str | None]:
    binary = Path(argv[0]).name
    if binary in DENY_COMMANDS:
        return False, f"command '{binary}' is denied"

    if cwd is not None:
        try:
            resolve_policy_cwd(cwd)
        except Exception as exc:
            return False, str(exc)

    if timeout_s is not None and timeout_s > MAX_TIMEOUT_S:
        return False, f"timeout_s exceeds maximum policy limit ({MAX_TIMEOUT_S})"

    if env:
        for key in env:
            if key in DENY_ENV_EXACT or any(key.startswith(prefix) for prefix in DENY_ENV_PREFIXES):
                return False, f"env var '{key}' is denied"

    return True, None


def policy_denied_response(reason: str, audit: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "ok": False,
        "error": "policy_denied",
        "reason": reason,
        "audit": dict(audit),
    }
