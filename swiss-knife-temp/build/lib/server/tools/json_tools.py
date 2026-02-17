import copy
import json
from typing import Any, Dict, List

from .common.pathing import resolve_in_allowed_base
from .common.results import error, from_exception, success


def _decode_token(token: str) -> str:
    return token.replace("~1", "/").replace("~0", "~")


def _split_pointer(pointer: str) -> List[str]:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError("invalid_pointer")
    return [_decode_token(p) for p in pointer.lstrip("/").split("/")]


def _get_parent(doc: Any, tokens: List[str], create_missing: bool = False):
    if not tokens:
        return None, None
    parent = doc
    for token in tokens[:-1]:
        if isinstance(parent, list):
            idx = int(token)
            parent = parent[idx]
        elif isinstance(parent, dict):
            if token not in parent:
                if create_missing:
                    parent[token] = {}
                else:
                    raise KeyError("missing_path")
            parent = parent[token]
        else:
            raise KeyError("missing_path")
    return parent, tokens[-1]


def _get_value(doc: Any, tokens: List[str]) -> Any:
    cur = doc
    for token in tokens:
        if isinstance(cur, list):
            cur = cur[int(token)]
        elif isinstance(cur, dict):
            cur = cur[token]
        else:
            raise KeyError("missing_path")
    return cur


def _apply_op(doc: Any, op: Dict[str, Any]) -> Any:
    op_type = op.get("op")
    path = op.get("path")
    if op_type is None or path is None:
        raise ValueError("invalid_op")
    tokens = _split_pointer(path)

    if op_type == "add":
        if not tokens:
            return op.get("value")
        parent, key = _get_parent(doc, tokens, create_missing=True)
        value = op.get("value")
        if isinstance(parent, list):
            if key == "-":
                parent.append(value)
            else:
                parent.insert(int(key), value)
        elif isinstance(parent, dict):
            parent[key] = value
        else:
            raise ValueError("invalid_path")
        return doc

    if op_type == "remove":
        if not tokens:
            raise ValueError("remove_root")
        parent, key = _get_parent(doc, tokens)
        if isinstance(parent, list):
            parent.pop(int(key))
        elif isinstance(parent, dict):
            parent.pop(key)
        else:
            raise ValueError("invalid_path")
        return doc

    if op_type == "replace":
        if not tokens:
            return op.get("value")
        parent, key = _get_parent(doc, tokens)
        value = op.get("value")
        if isinstance(parent, list):
            parent[int(key)] = value
        elif isinstance(parent, dict):
            if key not in parent:
                raise KeyError("missing_path")
            parent[key] = value
        else:
            raise ValueError("invalid_path")
        return doc

    if op_type == "test":
        expected = op.get("value")
        actual = _get_value(doc, tokens)
        if actual != expected:
            raise ValueError("test_failed")
        return doc

    if op_type == "move":
        from_path = op.get("from")
        if from_path is None:
            raise ValueError("invalid_op")
        from_tokens = _split_pointer(from_path)
        value = _get_value(doc, from_tokens)
        doc = _apply_op(doc, {"op": "remove", "path": from_path})
        doc = _apply_op(doc, {"op": "add", "path": path, "value": value})
        return doc

    if op_type == "copy":
        from_path = op.get("from")
        if from_path is None:
            raise ValueError("invalid_op")
        from_tokens = _split_pointer(from_path)
        value = copy.deepcopy(_get_value(doc, from_tokens))
        doc = _apply_op(doc, {"op": "add", "path": path, "value": value})
        return doc

    raise ValueError("unsupported_op")


def patch_file(path: str, patch_ops: List[Dict[str, Any]], create_if_missing: bool = False) -> Dict[str, object]:
    if not isinstance(patch_ops, list):
        return error("invalid_path", "Patch body must be a list of RFC 6902 operations.")

    try:
        p = resolve_in_allowed_base(path)
        if not p.exists():
            if not create_if_missing:
                return error("not_found", f"JSON file not found: {path}")
            doc: Any = {}
        else:
            with p.open("r", encoding="utf-8") as f:
                doc = json.load(f)

        for op in patch_ops:
            doc = _apply_op(doc, op)

        p.write_text(json.dumps(doc, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
        return success(path=str(p))
    except Exception as exc:
        return from_exception(exc, default_code="invalid_path")
