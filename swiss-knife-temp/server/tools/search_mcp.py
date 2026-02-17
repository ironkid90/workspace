import json
import shutil
import subprocess
from typing import Dict, Optional, List, Any

from .common.pathing import resolve_in_allowed_base
from .common.results import error, from_exception, success


def rg_search(
    pattern: str,
    path: str = ".",
    glob: Optional[List[str] | str] = None,
    case_sensitive: Optional[bool] = None,
    fixed_strings: bool = False,
    max_results: int = 200,
    timeout_s: int = 30,
) -> Dict[str, Any]:
    if not pattern:
        return error("invalid_path", "Search pattern cannot be empty.")

    rg_path = shutil.which("rg")
    if not rg_path:
        return error("internal_error", "ripgrep binary 'rg' was not found in PATH.")

    try:
        target = resolve_in_allowed_base(path)
        args = [rg_path, "--json"]
        if fixed_strings:
            args.append("-F")
        if case_sensitive is True:
            args.append("-s")
        elif case_sensitive is False:
            args.append("-i")
        if glob:
            if isinstance(glob, list):
                for g in glob:
                    args.extend(["--glob", g])
            else:
                args.extend(["--glob", glob])
        args.extend([pattern, str(target)])

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )

        if result.returncode not in (0, 1):
            return error(
                "internal_error",
                "ripgrep failed.",
                exit_code=result.returncode,
                stderr=result.stderr.strip(),
            )

        matches: List[Dict[str, Any]] = []
        truncated = False
        for line in result.stdout.splitlines():
            try:
                payload = json.loads(line)
            except Exception:
                continue
            if payload.get("type") != "match":
                continue
            data = payload.get("data", {})
            path_text = data.get("path", {}).get("text")
            line_number = data.get("line_number")
            line_text = data.get("lines", {}).get("text", "").rstrip("\n")
            submatches = [{"start": sm.get("start"), "end": sm.get("end")} for sm in data.get("submatches", [])]
            matches.append(
                {
                    "path": path_text,
                    "line_number": line_number,
                    "line": line_text,
                    "submatches": submatches,
                }
            )
            if len(matches) >= max_results:
                truncated = True
                break

        return success(matches=matches, truncated=truncated, exit_code=result.returncode)
    except Exception as exc:
        return from_exception(exc)
