#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${ROBLOXBRIDGE_PORT:-30010}"
HOST="${ROBLOXBRIDGE_HOST:-127.0.0.1}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then kill "${SERVER_PID}" >/dev/null 2>&1 || true; fi
  if [[ -n "${MOCK_PID:-}" ]]; then kill "${MOCK_PID}" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

cd "${ROOT_DIR}"

node server/index.js >/tmp/novablox-e2e-server.log 2>&1 &
SERVER_PID=$!
sleep 1

MOCK_RUN_SECONDS=8 node examples/mock/mock_studio_client.js >/tmp/novablox-e2e-mock.log 2>&1 &
MOCK_PID=$!

curl -s -X POST "http://${HOST}:${PORT}/bridge/scene/spawn-object" \
  -H 'Content-Type: application/json' \
  -d '{"class_name":"Part","name":"E2E_Mock_Part","position":[1,2,3],"anchored":true}' >/tmp/novablox-e2e-cmd1.json

curl -s -X POST "http://${HOST}:${PORT}/bridge/environment/set-lighting" \
  -H 'Content-Type: application/json' \
  -d '{"brightness":2.5,"ambient":[0.1,0.1,0.2]}' >/tmp/novablox-e2e-cmd2.json

wait "${MOCK_PID}"
sleep 1

echo "---- Health ----"
curl -s "http://${HOST}:${PORT}/bridge/health"
echo
echo "---- Recent ----"
curl -s "http://${HOST}:${PORT}/bridge/commands/recent?limit=10"
echo
echo "---- Mock log ----"
cat /tmp/novablox-e2e-mock.log
