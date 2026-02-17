import sys
import json

msg = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1.0"}
    }
}
body = json.dumps(msg).encode('utf-8')
sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode('utf-8'))
sys.stdout.buffer.write(body)
sys.stdout.buffer.flush()

# Read response
header = sys.stdin.buffer.readline()
sys.stderr.write(f"DEBUG HEADER: {header}\n")
if header.startswith(b"Content-Length:"):
    sys.stdin.buffer.readline() # blank line
    length = int(header.split(b":")[1].strip())
    resp = sys.stdin.buffer.read(length)
    sys.stderr.write(f"DEBUG RESP: {resp}\n")
