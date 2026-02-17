import os
import zipfile
from pathlib import Path
from typing import Dict, List

from ..config import ALLOWED_BASE_DIR
from .common.pathing import resolve_in_allowed_base
from .common.results import error, from_exception, success


def pack(paths: List[str], dest_path: str, overwrite: bool = False) -> Dict[str, object]:
    if not paths:
        return error("invalid_path", "At least one source path is required.")

    try:
        dest = resolve_in_allowed_base(dest_path)
        if dest.exists() and not overwrite:
            return error("permission_denied", f"Destination already exists: {dest_path}")
        dest.parent.mkdir(parents=True, exist_ok=True)

        base = ALLOWED_BASE_DIR.resolve()
        count = 0
        with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for item in paths:
                p = resolve_in_allowed_base(item)
                if p.is_file():
                    arcname = str(p.resolve().relative_to(base))
                    zf.write(p, arcname)
                    count += 1
                elif p.is_dir():
                    for root, _, files in os.walk(p):
                        for name in files:
                            fp = Path(root) / name
                            arcname = str(fp.resolve().relative_to(base))
                            zf.write(fp, arcname)
                            count += 1
                else:
                    return error("not_found", f"Source path not found: {item}")
        return success(path=str(dest), count=count)
    except Exception as exc:
        return from_exception(exc)


def unpack(zip_path: str, dest_dir: str, overwrite: bool = False) -> Dict[str, object]:
    try:
        src = resolve_in_allowed_base(zip_path)
        dest = resolve_in_allowed_base(dest_dir)
        if not src.exists():
            return error("not_found", f"Archive not found: {zip_path}")

        dest.mkdir(parents=True, exist_ok=True)
        count = 0
        dest_resolved = dest.resolve()
        with zipfile.ZipFile(src, "r") as zf:
            for member in zf.infolist():
                target = (dest / member.filename).resolve()
                if not str(target).startswith(str(dest_resolved)):
                    return error("invalid_path", f"Archive member escapes destination: {member.filename}")
                if target.exists() and not overwrite:
                    return error("permission_denied", f"Destination file already exists: {target}")
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member, "r") as src_f, target.open("wb") as dst_f:
                    dst_f.write(src_f.read())
                count += 1

        return success(path=str(dest), count=count)
    except Exception as exc:
        return from_exception(exc)
