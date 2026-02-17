from __future__ import annotations

from pathlib import Path

from ...config import ALLOWED_BASE_DIR
from .results import ToolError


def resolve_in_allowed_base(path: str) -> Path:
    if not isinstance(path, str) or not path.strip():
        raise ToolError("invalid_path", "Path must be a non-empty string.")

    p = Path(path)
    try:
        resolved = p.resolve() if p.is_absolute() else (ALLOWED_BASE_DIR / p).resolve()
    except Exception as exc:
        raise ToolError("invalid_path", f"Could not resolve path '{path}': {exc}") from exc

    base = ALLOWED_BASE_DIR.resolve()
    try:
        resolved.relative_to(base)
    except ValueError as exc:
        raise ToolError(
            "permission_denied",
            f"Path '{path}' resolves outside allowed base directory.",
        ) from exc

    return resolved
