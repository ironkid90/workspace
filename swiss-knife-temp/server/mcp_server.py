from pathlib import Path
from typing import Any
import sys

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))    

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from server.config import MCP_HOST, MCP_PORT, MCP_MINIMAL_MODE
from server.tools import shell, fs, git_tools, excel_mcp, search_mcp, process_mcp, json_tools, zip_tools
from server.tool_catalog import enrich_tool_definition, tool_in_minimal_mode
from server import telemetry

app = FastAPI(title="Local MCP Server for Codex")
_UI_DIR = Path(__file__).resolve().parent / "ui"
app.mount("/ui", StaticFiles(directory=str(_UI_DIR)), name="ui")       


def _execute_tool(name: str, method: str, path: str, payload: dict | None, fn):
    try:
        result = fn()
    except Exception as e:
        result = {"ok": False, "error": str(e)}
    telemetry.record_tool_call(name, method, path, payload, result)    
    return result


TOOLS_CATALOG_VERSION = "1"

@app.get("/", include_in_schema=False)
def root():
    return FileResponse(_UI_DIR / "index.html")


@app.get("/health")
def health():
    return _execute_tool("health", "GET", "/health", None, lambda: {"ok": True})


class ShellExecRequest(BaseModel):
    cmd: str | list[str]
    cwd: str | None = None
    env: dict | None = None
    timeout_s: int = 60


@app.post("/shell/exec")
def shell_exec(req: ShellExecRequest):
    payload = req.model_dump()
    return _execute_tool("shell.exec", "POST", "/shell/exec", payload, lambda: shell.exec_cmd(**payload))


class FSReadRequest(BaseModel):
    path: str
    max_bytes: int | None = None


@app.post("/fs/read")
def fs_read(req: FSReadRequest):
    payload = req.model_dump()
    return _execute_tool("fs.read", "POST", "/fs/read", payload, lambda: fs.read(**payload))


class FSWriteRequest(BaseModel):
    path: str
    content: str
    mode: str = "overwrite"


@app.post("/fs/write")
def fs_write(req: FSWriteRequest):
    payload = req.model_dump()
    return _execute_tool("fs.write", "POST", "/fs/write", payload, lambda: fs.write(**payload))


class FSListRequest(BaseModel):
    path: str
    recursive: bool = False
    max_entries: int | None = None


@app.post("/fs/list")
def fs_list(req: FSListRequest):
    payload = req.model_dump()
    max_entries = payload.pop("max_entries")
    payload["max_entries"] = max_entries if max_entries is not None else 2000
    return _execute_tool("fs.list", "POST", "/fs/list", payload, lambda: fs.list_dir(**payload))


class FSStatRequest(BaseModel):
    path: str


@app.post("/fs/stat")
def fs_stat(req: FSStatRequest):
    payload = req.model_dump()
    return _execute_tool("fs.stat", "POST", "/fs/stat", payload, lambda: fs.stat(**payload))


class GitRequest(BaseModel):
    cwd: str | None = None


@app.post("/git/status")
def git_status(req: GitRequest):
    payload = req.model_dump()
    return _execute_tool("git.status", "POST", "/git/status", payload, lambda: git_tools.git_status(**payload))


@app.post("/git/diff")
def git_diff(req: GitRequest):
    payload = req.model_dump()
    return _execute_tool("git.diff", "POST", "/git/diff", payload, lambda: git_tools.git_diff(**payload))


class GitCommitRequest(BaseModel):
    message: str
    cwd: str | None = None


@app.post("/git/commit")
def git_commit(req: GitCommitRequest):
    payload = req.model_dump()
    return _execute_tool("git.commit", "POST", "/git/commit", payload, lambda: git_tools.git_commit(payload["message"], cwd=payload.get("cwd")))


class SearchRequest(BaseModel):
    pattern: str
    path: str | None = None
    glob: list | str | None = None
    case_sensitive: bool | None = None
    fixed_strings: bool = False
    max_results: int = 200
    timeout_s: int = 30


@app.post("/search/rg")
def search_rg(req: SearchRequest):
    payload = req.model_dump()
    return _execute_tool(
        "search.rg",
        "POST",
        "/search/rg",
        payload,
        lambda: search_mcp.rg_search(
            payload["pattern"],
            path=payload["path"] or ".",
            glob=payload["glob"],
            case_sensitive=payload["case_sensitive"],
            fixed_strings=payload["fixed_strings"],
            max_results=payload["max_results"],
            timeout_s=payload["timeout_s"],
        ),
    )


class ProcessStartRequest(BaseModel):
    cmd: str | list[str]
    cwd: str | None = None
    env: dict | None = None
    capture_output: bool = True


@app.post("/process/start")
def process_start(req: ProcessStartRequest):
    payload = req.model_dump()
    return _execute_tool("process.start", "POST", "/process/start", payload, lambda: process_mcp.start(**payload))


class ProcessStatusRequest(BaseModel):
    pid: int


@app.post("/process/status")
def process_status(req: ProcessStatusRequest):
    payload = req.model_dump()
    return _execute_tool("process.status", "POST", "/process/status", payload, lambda: process_mcp.status(**payload))


class ProcessKillRequest(BaseModel):
    pid: int
    force: bool = False
    timeout_s: int = 5


@app.post("/process/kill")
def process_kill(req: ProcessKillRequest):
    payload = req.model_dump()
    return _execute_tool("process.kill", "POST", "/process/kill", payload, lambda: process_mcp.kill(**payload))


class ProcessReadRequest(BaseModel):
    pid: int
    stream: str = "stdout"
    max_bytes: int = 20000
    tail: bool = True


@app.post("/process/read")
def process_read(req: ProcessReadRequest):
    payload = req.model_dump()
    return _execute_tool("process.read", "POST", "/process/read", payload, lambda: process_mcp.read(**payload))


@app.post("/process/list")
def process_list():
    return _execute_tool("process.list", "POST", "/process/list", {}, process_mcp.list_processes)


class JsonPatchRequest(BaseModel):
    path: str
    patch: list
    create_if_missing: bool = False


@app.post("/json/patch")
def json_patch(req: JsonPatchRequest):
    payload = req.model_dump()
    return _execute_tool(
        "json.patch",
        "POST",
        "/json/patch",
        payload,
        lambda: json_tools.patch_file(payload["path"], payload["patch"], create_if_missing=payload["create_if_missing"]),
    )


class ZipPackRequest(BaseModel):
    paths: list
    dest_path: str
    overwrite: bool = False


@app.post("/zip/pack")
def zip_pack(req: ZipPackRequest):
    payload = req.model_dump()
    return _execute_tool("zip.pack", "POST", "/zip/pack", payload, lambda: zip_tools.pack(**payload))


class ZipUnpackRequest(BaseModel):
    zip_path: str
    dest_dir: str
    overwrite: bool = False


@app.post("/zip/unpack")
def zip_unpack(req: ZipUnpackRequest):
    payload = req.model_dump()
    return _execute_tool("zip.unpack", "POST", "/zip/unpack", payload, lambda: zip_tools.unpack(**payload))


class ExcelInspectRequest(BaseModel):
    workbook_path: str


@app.post("/excel/inspect")
def excel_inspect(req: ExcelInspectRequest):
    payload = req.model_dump()
    return _execute_tool("excel.inspect", "POST", "/excel/inspect", payload, lambda: excel_mcp.inspect(payload["workbook_path"]))


class ExcelReadRequest(BaseModel):
    workbook_path: str
    sheet: str
    a1_range: str
    top_n: int | None = None


@app.post("/excel/read_range")
def excel_read_range(req: ExcelReadRequest):
    payload = req.model_dump()
    return _execute_tool("excel.read_range", "POST", "/excel/read_range", payload, lambda: excel_mcp.read_range(**payload))


class ExcelPreviewRequest(BaseModel):
    workbook_path: str
    sheet: str
    a1_range: str
    values: list


@app.post("/excel/preview_write")
def excel_preview(req: ExcelPreviewRequest):
    payload = req.model_dump()
    return _execute_tool("excel.preview_write", "POST", "/excel/preview_write", payload, lambda: excel_mcp.preview_write(**payload))


@app.post("/excel/commit_write")
def excel_commit(req: ExcelPreviewRequest):
    payload = req.model_dump()
    return _execute_tool("excel.commit_write", "POST", "/excel/commit_write", payload, lambda: excel_mcp.commit_write(**payload))


class ExcelFindRequest(BaseModel):
    workbook_path: str
    query: Any
    sheet: str | None = None
    a1_range: str | None = None
    match_case: bool = False
    exact: bool = False
    limit: int = 100


@app.post("/excel/find")
def excel_find(req: ExcelFindRequest):
    payload = req.model_dump()
    return _execute_tool(
        "excel.find",
        "POST",
        "/excel/find",
        payload,
        lambda: excel_mcp.find(
            payload["workbook_path"],
            payload["query"],
            sheet=payload["sheet"],
            a1_range=payload["a1_range"],
            match_case=payload["match_case"],
            exact=payload["exact"],
            limit=payload["limit"],
        ),
    )


@app.get("/telemetry/history")
def telemetry_history(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    return {"ok": True, **telemetry.get_tool_history(offset=offset, limit=limit)}


@app.get("/telemetry/policy_denials")
def telemetry_policy_denials(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    return {"ok": True, **telemetry.get_policy_denials(offset=offset, limit=limit)}


@app.get("/telemetry/error_counters")
def telemetry_error_counters():
    return {"ok": True, "error_counters": telemetry.get_error_counters()}


@app.get("/gui/data")
def gui_data(
    history_offset: int = Query(0, ge=0),
    history_limit: int = Query(10, ge=1, le=100),
    policy_offset: int = Query(0, ge=0),
    policy_limit: int = Query(10, ge=1, le=100),
):
    process_snapshot = process_mcp.active_processes_snapshot()
    return {
        "ok": True,
        "health": {"ok": True},
        "history": telemetry.get_tool_history(offset=history_offset, limit=history_limit),
        "policy_denials": telemetry.get_policy_denials(offset=policy_offset, limit=policy_limit),
        "error_counters": telemetry.get_error_counters(),
        "processes": {"total": len(process_snapshot), "items": process_snapshot},
    }


def _model_schema(model: type[BaseModel]) -> dict:
    if hasattr(model, "model_json_schema"):
        return model.model_json_schema()
    return model.schema()


@app.get("/tools/list")
def tools_list():
    base_tools = [
        {"name": "health", "method": "GET", "path": "/health", "description": "Health check"},
        {"name": "shell.exec", "method": "POST", "path": "/shell/exec", "description": "Execute a shell command", "request_schema": _model_schema(ShellExecRequest)},
        {"name": "fs.read", "method": "POST", "path": "/fs/read", "description": "Read a file", "request_schema": _model_schema(FSReadRequest)},
        {"name": "fs.write", "method": "POST", "path": "/fs/write", "description": "Write a file", "request_schema": _model_schema(FSWriteRequest)},
        {"name": "fs.list", "method": "POST", "path": "/fs/list", "description": "List directory contents", "request_schema": _model_schema(FSListRequest)},
        {"name": "fs.stat", "method": "POST", "path": "/fs/stat", "description": "Stat a file or directory", "request_schema": _model_schema(FSStatRequest)},
        {"name": "git.status", "method": "POST", "path": "/git/status", "description": "Git status", "request_schema": _model_schema(GitRequest)},
        {"name": "git.diff", "method": "POST", "path": "/git/diff", "description": "Git diff", "request_schema": _model_schema(GitRequest)},  
        {"name": "git.commit", "method": "POST", "path": "/git/commit", "description": "Git commit", "request_schema": _model_schema(GitCommitRequest)},
        {"name": "search.rg", "method": "POST", "path": "/search/rg", "description": "Ripgrep search", "request_schema": _model_schema(SearchRequest)},
        {"name": "process.start", "method": "POST", "path": "/process/start", "description": "Start a process", "request_schema": _model_schema(ProcessStartRequest)},
        {"name": "process.status", "method": "POST", "path": "/process/status", "description": "Process status", "request_schema": _model_schema(ProcessStatusRequest)},
        {"name": "process.kill", "method": "POST", "path": "/process/kill", "description": "Kill a process started by the server", "request_schema": _model_schema(ProcessKillRequest)},
        {"name": "process.read", "method": "POST", "path": "/process/read", "description": "Read process output", "request_schema": _model_schema(ProcessReadRequest)},
        {"name": "process.list", "method": "POST", "path": "/process/list", "description": "List server-started processes"},
        {"name": "json.patch", "method": "POST", "path": "/json/patch", "description": "Apply JSON patch to file", "request_schema": _model_schema(JsonPatchRequest)},
        {"name": "zip.pack", "method": "POST", "path": "/zip/pack", "description": "Create zip archive", "request_schema": _model_schema(ZipPackRequest)},
        {"name": "zip.unpack", "method": "POST", "path": "/zip/unpack", "description": "Extract zip archive", "request_schema": _model_schema(ZipUnpackRequest)},
        {"name": "excel.inspect", "method": "POST", "path": "/excel/inspect", "description": "Inspect workbook", "request_schema": _model_schema(ExcelInspectRequest)},
        {"name": "excel.read_range", "method": "POST", "path": "/excel/read_range", "description": "Read range", "request_schema": _model_schema(ExcelReadRequest)},
        {"name": "excel.preview_write", "method": "POST", "path": "/excel/preview_write", "description": "Preview write", "request_schema": _model_schema(ExcelPreviewRequest)},
        {"name": "excel.commit_write", "method": "POST", "path": "/excel/commit_write", "description": "Commit write", "request_schema": _model_schema(ExcelPreviewRequest)},
        {"name": "excel.find", "method": "POST", "path": "/excel/find", "description": "Find values", "request_schema": _model_schema(ExcelFindRequest)},
    ]

    tools = [enrich_tool_definition(tool) for tool in base_tools]      
    if MCP_MINIMAL_MODE:
        tools = [tool for tool in tools if tool_in_minimal_mode(tool["name"])]

    tools.sort(key=lambda item: item.get("recommended_workflow_order", 999))
    return {"ok": True, "minimal_mode": MCP_MINIMAL_MODE, "tools": tools}


def main() -> None:
    import uvicorn
    uvicorn.run(app, host=MCP_HOST, port=MCP_PORT)


if __name__ == "__main__":
    main()
