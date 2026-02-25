#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

read_env_value() {
  local key="$1"
  if [[ ! -f "${ENV_FILE}" ]]; then
    return 1
  fi
  awk -F= -v k="$key" '$1==k{print substr($0,index($0,"=")+1)}' "${ENV_FILE}" | tail -n1 | tr -d '\r'
}

pause_if_tty() {
  if [[ -t 0 ]]; then
    read -r -p "Press Enter to close..." _
  fi
}

PORT="$(read_env_value ROBLOXBRIDGE_PORT || true)"
PORT="${PORT:-30010}"

PIDS="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)"
if [[ -z "${PIDS}" ]]; then
  echo "[NovaBlox] No bridge process found on port ${PORT}."
  pause_if_tty
  exit 0
fi

echo "[NovaBlox] Stopping bridge on port ${PORT} (pid: ${PIDS})"
kill ${PIDS} || true
sleep 1

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[NovaBlox] Bridge is still running. Trying force kill..."
  kill -9 ${PIDS} || true
fi

echo "[NovaBlox] Bridge stopped."
pause_if_tty
