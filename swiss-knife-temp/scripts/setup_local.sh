#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PYTHON_BIN="${PYTHON:-python3}"
HOST="${MCP_HOST:-127.0.0.1}"
PORT="${MCP_PORT:-8080}"
BASE_URL="http://${HOST}:${PORT}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

"${PYTHON_BIN}" -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip
python -m pip install -e "${ROOT_DIR}"

ai-agents-swiss-knife-server >/tmp/ai-agents-swiss-knife.setup.log 2>&1 &
SERVER_PID=$!

for _ in {1..30}; do
  if curl --fail --silent "${BASE_URL}/health" >/tmp/ai-agents-swiss-knife.health.json; then
    cat /tmp/ai-agents-swiss-knife.health.json
    echo
    echo "setup complete"
    exit 0
  fi
  sleep 1
done

echo "failed to validate ${BASE_URL}/health" >&2
cat /tmp/ai-agents-swiss-knife.setup.log >&2 || true
exit 1
