@echo off
setlocal

for %%I in ("%~dp0..") do set "REPO_ROOT=%%~fI"
set "LOG_DIR=%REPO_ROOT%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set MCP_HOST=127.0.0.1
set MCP_PORT=8000
set MCP_ALLOWED_BASE=%REPO_ROOT%
set MCP_MAX_READ_BYTES=200000
set MCP_EXCEL_LOCK_TIMEOUT_S=5

cd /d "%REPO_ROOT%"
python -m server.mcp_server >> "%LOG_DIR%\server.log" 2>&1

endlocal
