import subprocess
from datetime import datetime
from typing import Optional, Dict, Sequence

from ..policy import (
    build_audit_metadata,
    check_execution_policy,
    normalize_command,
    policy_denied_response,
    resolve_policy_cwd,
)


def _redact(text: str) -> str:
    """
    Very basic redaction to avoid leaking large outputs or secrets.
    Truncates long outputs and normalises newlines.
    """
    if not text:
        return text
    s = text.replace("\n", "\\n")
    return s[:20000]


def exec_cmd(
    cmd: str | Sequence[str],
    cwd: Optional[str] = None,
    env: Optional[dict] = None,
    timeout_s: int = 60,
    tool_name: str = "shell.exec",
) -> Dict[str, object]:
    """
    Execute a command and return structured output.
    Prefers argument-list execution to avoid shell interpolation.
    """
    argv, parse_error = normalize_command(cmd)
    fallback_argv = [str(cmd)] if isinstance(cmd, str) else [str(p) for p in cmd]
    audit = build_audit_metadata(argv or fallback_argv, tool_name)
    if parse_error:
        return policy_denied_response(parse_error, audit)

    allowed, denied_reason = check_execution_policy(
        tool_name=tool_name,
        argv=argv,
        cwd=cwd,
        env=env,
        timeout_s=timeout_s,
    )
    if not allowed:
        return policy_denied_response(denied_reason or "policy denied", audit)

    try:
        resolved_cwd = resolve_policy_cwd(cwd)
    except Exception as e:
        return {
            "ok": False,
            "error": "invalid_cwd",
            "stderr": f"Error: {str(e)}",
            "audit": audit,
        }

    try:
        result = subprocess.run(
            argv,
            shell=False,
            cwd=resolved_cwd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        return {
            "ok": result.returncode == 0,
            "exit_code": result.returncode,
            "stdout": _redact(result.stdout),
            "stderr": _redact(result.stderr),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "audit": audit,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Timeout: {str(e)}",
            "audit": audit,
        }
    except Exception as e:
        return {
            "ok": False,
            "exit_code": -2,
            "stdout": "",
            "stderr": f"Error: {str(e)}",
            "audit": audit,
        }
