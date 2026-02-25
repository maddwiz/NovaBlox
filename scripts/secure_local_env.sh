#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

ensure_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${ROOT_DIR}/.env.example" "${ENV_FILE}"
    echo "[secure] Created .env from .env.example"
  fi
}

generate_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))'
}

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
    rm -f "${ENV_FILE}.bak"
  else
    printf "%s=%s\n" "${key}" "${value}" >>"${ENV_FILE}"
  fi
}

ensure_env_file

API_KEY="${1:-}"
if [[ -z "${API_KEY}" ]]; then
  API_KEY="$(generate_key)"
fi

upsert_env "ROBLOXBRIDGE_HOST" "127.0.0.1"
upsert_env "ROBLOXBRIDGE_API_KEY" "${API_KEY}"

printf "[secure] Updated %s\n" "${ENV_FILE}"
printf "[secure] ROBLOXBRIDGE_HOST=127.0.0.1\n"
printf "[secure] ROBLOXBRIDGE_API_KEY=%s\n" "${API_KEY}"
printf "[secure] Next: restart server and run 'npm run studio:sync'.\n"
