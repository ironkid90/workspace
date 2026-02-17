import os
from pathlib import Path
from typing import Dict, Optional, List

from ..config import ALLOWED_BASE_DIR, MAX_READ_BYTES
from .common.pathing import resolve_in_allowed_base
from .common.results import error, from_exception, success


def read(path: str, max_bytes: Optional[int] = None) -> Dict[str, object]:
    max_bytes = max_bytes or MAX_READ_BYTES
    try:
        p = resolve_in_allowed_base(path)
        if not p.exists():
            return error("not_found", f"File not found: {path}")
        if p.is_dir():
            return error("invalid_path", f"Expected a file but got directory: {path}")
        size = p.stat().st_size
        with p.open("rb") as f:
            content = f.read(max_bytes)
        try:
            text = content.decode("utf-8")
        except Exception:
            text = content.decode("latin-1", errors="ignore")
        return success(path=str(p), size=size, content=text, truncated=size > max_bytes)
    except Exception as exc:
        return from_exception(exc)


def write(path: str, content: str, mode: str = "overwrite") -> Dict[str, object]:
    try:
        p = resolve_in_allowed_base(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        if mode == "overwrite":
            p.write_text(content, encoding="utf-8")
        elif mode == "append":
            with p.open("a", encoding="utf-8") as f:
                f.write(content)
        else:
            return error("invalid_path", f"Unsupported mode: {mode}")
        return success(path=str(p))
    except Exception as exc:
        return from_exception(exc)


def list_dir(path: str, recursive: bool = False, max_entries: int = 2000) -> Dict[str, object]:
    try:
        p = resolve_in_allowed_base(path)
        if not p.exists():
            return error("not_found", f"Directory not found: {path}")
        if not p.is_dir():
            return error("invalid_path", f"Expected a directory but got file: {path}")

        base = ALLOWED_BASE_DIR.resolve()
        entries: List[Dict[str, object]] = []
        truncated = False

        def _entry_info(ep: Path) -> Dict[str, object]:
            try:
                rel_path = str(ep.resolve().relative_to(base))
            except Exception:
                rel_path = ep.name
            try:
                st = ep.stat()
            except Exception:
                st = None
            entry_type = "dir" if ep.is_dir() else "file" if ep.is_file() else "other"
            return {
                "path": str(ep),
                "rel_path": rel_path,
                "type": entry_type,
                "size": st.st_size if st else None,
                "mtime": st.st_mtime if st else None,
            }

        def _add_entry(ep: Path) -> bool:
            nonlocal truncated
            if len(entries) >= max_entries:
                truncated = True
                return False
            entries.append(_entry_info(ep))
            return True

        if recursive:
            for root, dirs, files in os.walk(p):
                for name in dirs:
                    if not _add_entry(Path(root) / name):
                        break
                if truncated:
                    break
                for name in files:
                    if not _add_entry(Path(root) / name):
                        break
                if truncated:
                    break
        else:
            for ep in p.iterdir():
                if not _add_entry(ep):
                    break

        return success(path=str(p), entries=entries, truncated=truncated)
    except Exception as exc:
        return from_exception(exc)


def stat(path: str) -> Dict[str, object]:
    try:
        p = resolve_in_allowed_base(path)
        if not p.exists():
            return error("not_found", f"Path not found: {path}")
        st = p.stat()
        entry_type = "dir" if p.is_dir() else "file" if p.is_file() else "other"
        return success(path=str(p), type=entry_type, size=st.st_size, mtime=st.st_mtime)
    except Exception as exc:
        return from_exception(exc)
