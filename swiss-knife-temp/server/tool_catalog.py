from __future__ import annotations

from copy import deepcopy
from typing import Any

ToolDef = dict[str, Any]

TOOL_CATALOG: dict[str, dict[str, Any]] = {
    "health": {
        "category": "system",
        "tags": ["diagnostic", "safe"],
        "safety_level": "safe",
        "preferred_usage": "Call first to confirm server availability.",
        "workflow_order": 0,
        "minimal_mode": True,
    },
    "shell.exec": {
        "category": "execution",
        "tags": ["shell", "command", "legacy-behavior"],
        "safety_level": "high-risk",
        "preferred_usage": "Use for short-lived commands only; prefer process.start for long-running jobs.",
        "workflow_order": 80,
        "minimal_mode": False,
        "deprecation": {
            "status": "discouraged_for_long_running_tasks",
            "replacement": "process.start",
            "guidance": "shell.exec waits synchronously and may timeout on long tasks.",
        },
    },
    "fs.read": {
        "category": "filesystem",
        "tags": ["file", "read", "safe"],
        "safety_level": "safe",
        "preferred_usage": "Read targeted files after discovery with search.rg or fs.list.",
        "workflow_order": 20,
        "minimal_mode": True,
    },
    "fs.write": {
        "category": "filesystem",
        "tags": ["file", "write", "mutation"],
        "safety_level": "caution",
        "preferred_usage": "Use for direct edits; prefer json.patch for structured JSON updates.",
        "workflow_order": 60,
        "minimal_mode": False,
        "deprecation": {
            "status": "alternative_available",
            "replacement": "json.patch",
            "guidance": "Prefer json.patch when editing JSON to reduce accidental formatting drift.",
        },
    },
    "fs.list": {
        "category": "filesystem",
        "tags": ["file", "discovery", "safe"],
        "safety_level": "safe",
        "preferred_usage": "Enumerate candidate files before read/write operations.",
        "workflow_order": 10,
        "minimal_mode": True,
    },
    "fs.stat": {
        "category": "filesystem",
        "tags": ["metadata", "safe"],
        "safety_level": "safe",
        "preferred_usage": "Confirm path type and size before read/write operations.",
        "workflow_order": 15,
        "minimal_mode": True,
    },
    "git.status": {
        "category": "git",
        "tags": ["repo", "status"],
        "safety_level": "safe",
        "preferred_usage": "Check working tree state before and after changes.",
        "workflow_order": 70,
        "minimal_mode": False,
    },
    "git.diff": {
        "category": "git",
        "tags": ["repo", "review"],
        "safety_level": "safe",
        "preferred_usage": "Review staged/unstaged deltas before commit.",
        "workflow_order": 75,
        "minimal_mode": False,
    },
    "git.commit": {
        "category": "git",
        "tags": ["repo", "mutation"],
        "safety_level": "caution",
        "preferred_usage": "Commit only after reviewing diff and validating outcomes.",
        "workflow_order": 90,
        "minimal_mode": False,
    },
    "search.rg": {
        "category": "search",
        "tags": ["discovery", "text", "safe"],
        "safety_level": "safe",
        "preferred_usage": "Use as the primary code/content discovery tool before file reads.",
        "workflow_order": 12,
        "minimal_mode": True,
    },
    "process.start": {
        "category": "process",
        "tags": ["process", "long-running", "preferred"],
        "safety_level": "caution",
        "preferred_usage": "Preferred for long-running commands and services.",
        "workflow_order": 30,
        "minimal_mode": False,
    },
    "process.status": {
        "category": "process",
        "tags": ["process", "monitoring"],
        "safety_level": "safe",
        "preferred_usage": "Track process lifecycle after process.start.",
        "workflow_order": 40,
        "minimal_mode": False,
    },
    "process.kill": {
        "category": "process",
        "tags": ["process", "control", "mutation"],
        "safety_level": "caution",
        "preferred_usage": "Terminate server-started processes when work completes or hangs.",
        "workflow_order": 55,
        "minimal_mode": False,
    },
    "process.read": {
        "category": "process",
        "tags": ["process", "logs"],
        "safety_level": "safe",
        "preferred_usage": "Read captured stdout/stderr for started processes.",
        "workflow_order": 45,
        "minimal_mode": False,
    },
    "process.list": {
        "category": "process",
        "tags": ["process", "inventory"],
        "safety_level": "safe",
        "preferred_usage": "List active tracked processes for cleanup and diagnostics.",
        "workflow_order": 35,
        "minimal_mode": False,
    },
    "json.patch": {
        "category": "data",
        "tags": ["json", "structured-edit"],
        "safety_level": "caution",
        "preferred_usage": "Preferred for deterministic JSON file updates.",
        "workflow_order": 58,
        "minimal_mode": False,
    },
    "zip.pack": {
        "category": "archive",
        "tags": ["zip", "packaging"],
        "safety_level": "caution",
        "preferred_usage": "Bundle generated outputs or handoff artifacts.",
        "workflow_order": 85,
        "minimal_mode": False,
    },
    "zip.unpack": {
        "category": "archive",
        "tags": ["zip", "extraction"],
        "safety_level": "caution",
        "preferred_usage": "Extract archives into controlled destinations.",
        "workflow_order": 25,
        "minimal_mode": False,
    },
    "excel.inspect": {
        "category": "excel",
        "tags": ["spreadsheet", "discovery"],
        "safety_level": "safe",
        "preferred_usage": "Inspect workbook shape before reading or writing ranges.",
        "workflow_order": 22,
        "minimal_mode": True,
    },
    "excel.read_range": {
        "category": "excel",
        "tags": ["spreadsheet", "read"],
        "safety_level": "safe",
        "preferred_usage": "Read focused ranges before preparing updates.",
        "workflow_order": 24,
        "minimal_mode": True,
    },
    "excel.preview_write": {
        "category": "excel",
        "tags": ["spreadsheet", "preview", "safe-guard"],
        "safety_level": "safe",
        "preferred_usage": "Preview mutations before commit_write.",
        "workflow_order": 50,
        "minimal_mode": False,
    },
    "excel.commit_write": {
        "category": "excel",
        "tags": ["spreadsheet", "mutation"],
        "safety_level": "caution",
        "preferred_usage": "Persist workbook changes after preview_write validation.",
        "workflow_order": 65,
        "minimal_mode": False,
    },
    "excel.find": {
        "category": "excel",
        "tags": ["spreadsheet", "search", "safe"],
        "safety_level": "safe",
        "preferred_usage": "Find matches before selecting ranges for read/write.",
        "workflow_order": 23,
        "minimal_mode": True,
    },
}


def enrich_tool_definition(tool: ToolDef) -> ToolDef:
    """Attach catalog metadata to a base tool definition."""
    enriched = deepcopy(tool)
    catalog_entry = TOOL_CATALOG.get(tool["name"], {})
    enriched.update({
        "category": catalog_entry.get("category", "uncategorized"),
        "tags": catalog_entry.get("tags", []),
        "safety_level": catalog_entry.get("safety_level", "unknown"),
        "preferred_usage": catalog_entry.get("preferred_usage", ""),
        "recommended_workflow_order": catalog_entry.get("workflow_order", 999),
    })
    if catalog_entry.get("deprecation"):
        enriched["deprecation"] = catalog_entry["deprecation"]
    return enriched


def tool_in_minimal_mode(tool_name: str) -> bool:
    """Return True if a tool is part of the minimal-mode bundle."""
    return bool(TOOL_CATALOG.get(tool_name, {}).get("minimal_mode", False))
