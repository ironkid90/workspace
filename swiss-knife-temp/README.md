# AI Agent's Swiss Knife

A local **MCP-oriented tool server** for coding agents.

It exposes safe-by-default HTTP endpoints for:

- Shell execution
- Filesystem read/write/list/stat
- Git status/diff/commit
- ripgrep search
- Process lifecycle management
- JSON patching
- Zip packing/unpacking
- Excel workbook inspection and edits (`.xlsx`)

It also includes:

- A small web dashboard (`/`) with logs/policy visibility
- A stdio MCP bridge module for clients that expect stdio transport

---

## Quickstart (recommended)

### 1) Install

From this repository root:

```bash
python -m pip install .
# or for development:
pip install -e .
```

### One-command local bootstrap

Use the setup script for your shell. It creates `.venv`, installs the package, starts
the server, and validates `GET /health`.

```bash
./scripts/setup_local.sh
```

```powershell
.\scripts\setup_local.ps1
```

This installs two CLI entry points:

- `ai-agents-swiss-knife-server`
- `ai-agents-swiss-knife-bridge`

> Alternative (no install): `python -m server.mcp_server` and `python -m server.mcp_bridge`.

### 2) Run the HTTP server

```bash
ai-agents-swiss-knife-server
```

Defaults:

- Host: `127.0.0.1`
- Port: `8000`
- UI: `http://127.0.0.1:8000/`
- OpenAPI docs: `http://127.0.0.1:8000/docs`

Open the GUI in your browser at `http://localhost:8000/` (redirects to Swagger UI at
`/docs`). You can also use `/redoc`.

By default, the server listens on `127.0.0.1:8000`. You can change the host/port with
the `MCP_HOST` and `MCP_PORT` environment variables.

### 3) Point Codex CLI to the bridge

Codex CLI MCP servers are configured in `~/.codex/config.toml`.
Add:

```toml
[mcp_servers.ai_agents_swiss_knife]
command = "ai-agents-swiss-knife-bridge"
env = { MCP_BASE_URL = "http://127.0.0.1:8000" }
startup_timeout_sec = 60
```

If you prefer module form (e.g., using a specific python venv):

```toml
[mcp_servers.ai_agents_swiss_knife]
cwd = 'C:\path\to\ai-agents-swiss-knife'
command = 'C:\path\to\venv\Scripts\python.exe'
args = ["-m", "server.mcp_bridge"]
env = { MCP_BASE_URL = "http://127.0.0.1:8000" }
startup_timeout_sec = 60
```

> **Note**: `startup_timeout_sec` is recommended (e.g. 60s) to allow sufficient time for the bridge handshake.

---

## Environment variables

- `MCP_ALLOWED_BASE`: sandbox root for path operations (default: process cwd)
- `MCP_HOST`: bind host (default: `127.0.0.1`)
- `MCP_PORT`: bind port (default: `8000`)
- `MCP_BASE_URL`: bridge connection target (default: `http://127.0.0.1:8000`)
- `MCP_MAX_READ_BYTES`: default `/fs/read` size cap
- `MCP_EXCEL_LOCK_TIMEOUT_S`: Excel write lock timeout
- `MCP_MINIMAL_MODE`: `1/true` to expose only core bundle in `/tools/list`
- `MCP_TOOLS_CACHE_TTL_S`: bridge-side `/tools/list` cache TTL

Example:

```bash
export MCP_ALLOWED_BASE=/path/to/workspace
export MCP_MINIMAL_MODE=1
ai-agents-swiss-knife-server
```

---

## Troubleshooting

### Connection Timeouts

If your agent (Codex, Gemini) times out connecting to the MCP server:

1.  Ensure the server is running on port 8000: `netstat -ano | findstr :8000`.
2.  Increase the client timeout (e.g. `startup_timeout_sec = 60` in `config.toml`).
3.  Check `MCP_BASE_URL` matches the running server (default `http://127.0.0.1:8000`).

### Windows Path Issues

- Use single quotes in TOML/Python strings for Windows paths to avoid escaping issues (e.g. `cwd = 'C:\Users\...'`).
- Ensure the bridge is executed with the correct python interpreter from your virtual environment.

---

## Recent Fixes (v0.2.0+)

- **MCP Bridge**: Fixed `base_url` propagation logic in `mcp_bridge.py`.
- **Protocol Compliance**: Added proper handling for `notifications/initialized` to fix client handshakes.
- **Port Standardization**: Unified default port to 8000 across documentation and code.
- **Shell Compatibility**: Improved PowerShell profile handling and recursion guards.

---

## Tool discovery bundles

`GET /tools/list` returns enriched tool metadata including:

- `category`
- `safety_level`
- `recommended_workflow_order`
- optional deprecation/replacement guidance

Modes:

- **Core bundle** (`MCP_MINIMAL_MODE=1`): safer/high-value tools
- **Advanced bundle** (default): full toolset

---
### MCP client config templates

Template configs are provided under `configs/clients/`:

- `codex-cli.mcp.json`
- `gemini-cli.mcp.json`
- `generic-mcp-jsonrpc-stdio.json`

Use `--print-config` to output validated, copy/paste-ready bridge settings:

```bash
ai-agents-swiss-knife-bridge --print-config
```

### Client matrix

| Client | Transport mode | Config file location (typical) | Known limitations |
|---|---|---|---|
| Codex CLI | MCP over stdio via `ai-agents-swiss-knife-bridge` | User MCP config (copy from `configs/clients/codex-cli.mcp.json`) | Requires HTTP server to be running first. |
| Gemini CLI | MCP over stdio via `ai-agents-swiss-knife-bridge` | User MCP config (copy from `configs/clients/gemini-cli.mcp.json`) | Depends on CLI MCP support version; tool output is returned as JSON text content. |
| Generic MCP JSON-RPC client | MCP JSON-RPC over stdio via bridge | Client-specific JSON config (use `configs/clients/generic-mcp-jsonrpc-stdio.json`) | This repo currently exposes MCP through stdio bridge only (not Streamable HTTP MCP). |

---

## Dashboard and telemetry

UI endpoint:

- `GET /` (serves dashboard)

Telemetry endpoints:

- `GET /gui/data`
- `GET /telemetry/history`
- `GET /telemetry/policy_denials`
- `GET /telemetry/error_counters`

---

## API surface (summary)

- Health: `/health`, `/tools/list`, `/openapi.json`
- Shell: `/shell/exec`
- Filesystem: `/fs/read`, `/fs/write`, `/fs/list`, `/fs/stat`
- Git: `/git/status`, `/git/diff`, `/git/commit`
- Search: `/search/rg`
- Process: `/process/start`, `/process/status`, `/process/kill`, `/process/read`, `/process/list`
- JSON: `/json/patch`
- Zip: `/zip/pack`, `/zip/unpack`
- Excel: `/excel/inspect`, `/excel/read_range`, `/excel/preview_write`, `/excel/commit_write`, `/excel/find`

---

## Standard response envelope

Success:

```json
{ "ok": true, "...": "tool_specific_fields" }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "not_found|invalid_path|permission_denied|timeout|internal_error",
    "message": "human-readable detail"
  }
}
```

---

## Windows service

PowerShell as Administrator:

```powershell
.\scripts\install_service.ps1
```

Uninstall:

```powershell
.\scripts\uninstall_service.ps1
```

---

## Development

Install editable:

```bash
python -m pip install -e .
curl -X POST http://localhost:8000/shell/exec \
  -H "Content-Type: application/json" \
  -d '{"cmd":"ls -la", "cwd":"."}'
```

Run:

```bash
python -m server.mcp_server
```
