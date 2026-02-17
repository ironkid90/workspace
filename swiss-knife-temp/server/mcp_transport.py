import json
import time
from typing import Any, Dict, Optional


class MCPTransport:
    """Owns MCP JSON-RPC message handling and capability declarations."""

    def __init__(
        self,
        *,
        server_name: str,
        server_version: str,
        protocol_version: str,
        tools_provider,
        tools_caller,
        tools_cache_ttl_s: float = 5.0,
        enable_resources: bool = False,
        enable_prompts: bool = False,
    ) -> None:
        self.server_name = server_name
        self.server_version = server_version
        self.protocol_version = protocol_version
        self._tools_provider = tools_provider
        self._tools_caller = tools_caller
        self._tools_cache_ttl_s = max(0.0, float(tools_cache_ttl_s))
        self._enable_resources = enable_resources
        self._enable_prompts = enable_prompts
        self._tools_cache: Dict[str, Dict[str, Any]] = {}
        self._tools_cache_at: float = 0.0

    def _error(self, req_id: Any, code: int, message: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        err: Dict[str, Any] = {"code": code, "message": message}
        if data is not None:
            err["data"] = data
        return {"jsonrpc": "2.0", "id": req_id, "error": err}

    def _capabilities(self) -> Dict[str, Any]:
        return {
            "tools": {},
            "experimental": {
                "resources": {"enabled": self._enable_resources},
                "prompts": {"enabled": self._enable_prompts},
            },
        }

    def _should_refresh_tools(self) -> bool:
        if not self._tools_cache:
            return True
        if self._tools_cache_ttl_s <= 0:
            return True
        return (time.time() - self._tools_cache_at) >= self._tools_cache_ttl_s

    def _refresh_tools(self, force: bool = False) -> Dict[str, Dict[str, Any]]:
        if force or self._should_refresh_tools():
            self._tools_cache = self._tools_provider()
            self._tools_cache_at = time.time()
        return self._tools_cache

    def _tools_list(self) -> Dict[str, Any]:
        tools_cache = self._refresh_tools(force=True)
        tools = []
        for tool in tools_cache.values():
            if tool.get("path") in ("/health", "/tools/list", "/openapi.json"):
                continue
            tools.append(
                {
                    "name": tool.get("name"),
                    "description": tool.get("description") or "",
                    "inputSchema": tool.get("request_schema") or {"type": "object"},
                }
            )
        return {"tools": tools}

    def _validate_tool_call_params(self, params: Dict[str, Any]) -> Optional[str]:
        name = params.get("name")
        if not isinstance(name, str) or not name:
            return "tools/call params must include a non-empty string `name`."
        arguments = params.get("arguments")
        if arguments is not None and not isinstance(arguments, dict):
            return "tools/call `arguments` must be an object when provided."
        return None

    def _tools_call(self, params: Dict[str, Any], req_id: Any) -> Dict[str, Any]:
        invalid_reason = self._validate_tool_call_params(params)
        if invalid_reason:
            return self._error(req_id, -32602, "Invalid params", {"reason": invalid_reason})

        tools_cache = self._refresh_tools()
        name = params["name"]
        arguments = params.get("arguments")
        tool = tools_cache.get(name)
        if not tool:
            return self._error(req_id, -32602, "Tool not found", {"name": name})

        result = self._tools_caller(tool, arguments or {})
        if not result.get("ok", True):
            return self._error(req_id, -32010, "Backend HTTP failure", {"tool": name, "backend": result})

        response = {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=True)}]}
        return {"jsonrpc": "2.0", "id": req_id, "result": response}

    def handle_request(self, req: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        method = req.get("method")
        req_id = req.get("id")
        params = req.get("params") or {}

        if method == "initialize":
            result = {
                "protocolVersion": self.protocol_version,
                "capabilities": self._capabilities(),
                "serverInfo": {"name": self.server_name, "version": self.server_version},
            }
            return {"jsonrpc": "2.0", "id": req_id, "result": result}

        if method == "notifications/initialized":
            return None

        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": req_id, "result": self._tools_list()}

        if method == "tools/call":
            return self._tools_call(params, req_id)

        if method == "ping":
            return {"jsonrpc": "2.0", "id": req_id, "result": {}}

        if method == "shutdown":
            return {"jsonrpc": "2.0", "id": req_id, "result": {}}

        if req_id is None:
            return None
        return self._error(req_id, -32601, "Method not found", {"method": method})
