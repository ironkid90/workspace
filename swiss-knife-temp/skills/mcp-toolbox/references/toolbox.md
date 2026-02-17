# Codex MCP Toolbox Reference

## Setup and run

- Install dependencies: `pip install -r server/requirements.txt`
- Run the server: `python server/mcp_server.py`
- Default base URL: `http://localhost:8000`

## Configuration

- `MCP_ALLOWED_BASE` sets the filesystem root for /fs and /excel paths.
- `MCP_MAX_READ_BYTES` controls default read size for /fs/read (default 200000).
- `MCP_HOST` and `MCP_PORT` control the server bind address and port.
- `MCP_EXCEL_LOCK_TIMEOUT_S` controls the lock timeout for Excel writes.

## MCP client config

This server exposes HTTP endpoints. For MCP clients that require a stdio server,
use the bundled bridge. Start the HTTP server first, then configure:

```json
{
  "mcpServers": {
    "ai-agents-swiss-knife": {
      "command": "python",
      "args": ["-m", "server.mcp_bridge"],
      "env": {
        "MCP_BASE_URL": "http://localhost:8000"
      }
    }
  }
}
```

## Windows service

This uses WinSW (a Windows service wrapper). The install script downloads WinSW if needed and generates the config from `scripts/winsw/ai-agents-swiss-knife.xml.template`.

Install (run PowerShell as Administrator):

```powershell
.\scripts\install_service.ps1
```

Uninstall:

```powershell
.\scripts\uninstall_service.ps1
```

Logs: `logs/server.out.log` and `logs/server.err.log`
## Endpoints

### /shell/exec (POST)

Request body:

```
{
  "cmd": "ls -la",
  "cwd": ".",
  "env": {"KEY": "VALUE"},
  "timeout_s": 60
}
```

Response includes `ok`, `exit_code`, `stdout`, `stderr`, `timestamp`. Output is truncated to 20000 characters.

### /health (GET)

Returns `{ "ok": true }` when the server is up.

### /tools/list (GET)

Returns tool metadata for auto-discovery (names, routes, request schema).

### /openapi.json (GET)

Returns the OpenAPI schema for all endpoints (FastAPI default).

### /fs/read (POST)

Request body:

```
{
  "path": "relative/or/absolute/path",
  "max_bytes": 200000
}
```

### /fs/write (POST)

Request body:

```
{
  "path": "relative/or/absolute/path",
  "content": "file contents",
  "mode": "overwrite" | "append"
}
```

### /fs/list (POST)

Request body:

```
{
  "path": "relative/or/absolute/path",
  "recursive": false,
  "max_entries": 2000
}
```

### /fs/stat (POST)

Request body:

```
{
  "path": "relative/or/absolute/path"
}
```

### /git/status (POST)

Request body:

```
{
  "cwd": "."
}
```

### /git/diff (POST)

Request body:

```
{
  "cwd": "."
}
```

### /git/commit (POST)

Request body:

```
{
  "message": "commit message",
  "cwd": "."
}
```

Note: /git/commit runs `git add -A` before committing.

### /search/rg (POST)

Request body:

```
{
  "pattern": "TODO",
  "path": ".",
  "glob": "*.py",
  "case_sensitive": null,
  "fixed_strings": false,
  "max_results": 200,
  "timeout_s": 30
}
```

### /process/start (POST)

Request body:

```
{
  "cmd": "python -m http.server",
  "cwd": ".",
  "capture_output": true
}
```

### /process/status (POST)

Request body:

```
{
  "pid": 12345
}
```

### /process/kill (POST)

Request body:

```
{
  "pid": 12345,
  "force": false,
  "timeout_s": 5
}
```

### /process/read (POST)

Request body:

```
{
  "pid": 12345,
  "stream": "stdout",
  "max_bytes": 20000,
  "tail": true
}
```

### /process/list (POST)

Request body: `{}`

### /json/patch (POST)

Request body:

```
{
  "path": "config.json",
  "patch": [{"op": "replace", "path": "/enabled", "value": true}],
  "create_if_missing": false
}
```

### /zip/pack (POST)

Request body:

```
{
  "paths": ["src", "README.md"],
  "dest_path": "archive.zip",
  "overwrite": false
}
```

### /zip/unpack (POST)

Request body:

```
{
  "zip_path": "archive.zip",
  "dest_dir": "unpacked",
  "overwrite": false
}
```

### /excel/inspect (POST)

Request body:

```
{
  "workbook_path": "workbook.xlsx"
}
```

### /excel/read_range (POST)

Request body:

```
{
  "workbook_path": "workbook.xlsx",
  "sheet": "Sheet1",
  "a1_range": "A1:C10",
  "top_n": 100
}
```

### /excel/preview_write (POST)

Request body:

```
{
  "workbook_path": "workbook.xlsx",
  "sheet": "Sheet1",
  "a1_range": "A1:B2",
  "values": [["A1", "B1"], ["A2", "B2"]]
}
```

### /excel/commit_write (POST)

Request body matches /excel/preview_write. Always preview before commit.

### /excel/find (POST)

Request body:

```
{
  "workbook_path": "workbook.xlsx",
  "query": "Total",
  "sheet": "Sheet1",
  "a1_range": "A1:Z100",
  "match_case": false,
  "exact": false,
  "limit": 100
}
```

Locking: a file-based lock with suffix `.mcp.lock` is used; lock timeout is 5 seconds.

## Server layout

- `server/mcp_server.py` defines FastAPI endpoints and request schemas.
- `server/mcp_bridge.py` provides an MCP stdio bridge to the HTTP server.
- `server/tools/` contains tool modules: shell, fs, git_tools, excel_mcp, search_mcp, process_mcp, json_tools, zip_tools.
- `server/config.py` defines ALLOWED_BASE_DIR and MAX_READ_BYTES.
- `server/requirements.txt` lists dependencies (FastAPI, uvicorn, pydantic, openpyxl).
- `README.md` documents setup and endpoints.
