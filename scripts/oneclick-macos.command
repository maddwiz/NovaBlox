#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
LOG_FILE="/tmp/novablox-bridge.log"

read_env_value() {
  local key="$1"
  if [[ ! -f "${ENV_FILE}" ]]; then
    return 1
  fi
  awk -F= -v k="$key" '$1==k{print substr($0,index($0,"=")+1)}' "${ENV_FILE}" | tail -n1 | tr -d '\r'
}

print_step() {
  printf "\n[NovaBlox] %s\n" "$1"
}

pause_if_tty() {
  if [[ -t 0 ]]; then
    read -r -p "Press Enter to close..." _
  fi
}

urlencode() {
  local raw="${1:-}"
  local length="${#raw}"
  local encoded=""
  local char hex
  for ((i = 0; i < length; i++)); do
    char="${raw:i:1}"
    case "${char}" in
      [a-zA-Z0-9.~_-]) encoded+="${char}" ;;
      *)
        printf -v hex '%%%02X' "'${char}"
        encoded+="${hex}"
        ;;
    esac
  done
  printf "%s" "${encoded}"
}

print_step "One-click setup starting"
cd "${ROOT_DIR}"

if ! command -v npm >/dev/null 2>&1; then
  echo "[NovaBlox] npm is not installed. Install Node.js 18+ first."
  pause_if_tty
  exit 1
fi

if [[ ! -d node_modules ]]; then
  print_step "Installing dependencies"
  npm install
fi

print_step "Running one-click BYOK setup"
npm run setup:oneclick

HOST="$(read_env_value ROBLOXBRIDGE_HOST || true)"
PORT="$(read_env_value ROBLOXBRIDGE_PORT || true)"
API_KEY="$(read_env_value ROBLOXBRIDGE_API_KEY || true)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-30010}"

print_step "Ensuring bridge is running"
if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[NovaBlox] Bridge already listening on ${HOST}:${PORT}"
else
  nohup node server/index.js </dev/null >"${LOG_FILE}" 2>&1 &
  sleep 1
  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[NovaBlox] Bridge started in background on ${HOST}:${PORT}"
  else
    echo "[NovaBlox] Bridge did not start. Check ${LOG_FILE}"
    pause_if_tty
    exit 1
  fi
fi

print_step "Running doctor checks"
if ! npm run doctor; then
  echo "[NovaBlox] Doctor found issues. Continue with Studio restart and panel wizard."
fi

print_step "Preparing API key"
if [[ -n "${API_KEY}" ]] && command -v pbcopy >/dev/null 2>&1; then
  printf "%s" "${API_KEY}" | pbcopy
  echo "[NovaBlox] API key copied to clipboard for Studio/Web UI paste."
else
  echo "[NovaBlox] API key not copied automatically (missing key or pbcopy unavailable)."
fi

print_step "Opening NovaBlox Studio UI"
STUDIO_URL="http://${HOST}:${PORT}/bridge/studio"
if [[ -n "${API_KEY}" ]]; then
  ENCODED_API_KEY="$(urlencode "${API_KEY}")"
  STUDIO_URL="${STUDIO_URL}#api_key=${ENCODED_API_KEY}"
fi
open "${STUDIO_URL}" || true

if [[ -d "${HOME}/Documents/Roblox/Plugins" ]]; then
  open "${HOME}/Documents/Roblox/Plugins" || true
fi

echo
cat <<MSG
[NovaBlox] Done.
1) Restart Roblox Studio
2) Open Plugins > NovaBlox > Panel
3) Click Health, then Enable
4) Use Build Demo / AI prompts
5) Web UI API key should auto-fill (clipboard backup is ready)

To stop bridge later: double-click scripts/stop-bridge-macos.command
or use repo root launcher: NovaBlox-Stop-Bridge.command
API docs (optional): http://${HOST}:${PORT}/docs
MSG

pause_if_tty
