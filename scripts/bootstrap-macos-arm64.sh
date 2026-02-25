#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[bootstrap] This script is for macOS only."
  exit 1
fi

ARCH="$(uname -m)"
if [[ "${ARCH}" != "arm64" ]]; then
  echo "[bootstrap] Warning: expected arm64, found ${ARCH}. Continuing anyway."
fi

cd "${ROOT_DIR}"

echo "[bootstrap] Repo: ${ROOT_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "[bootstrap] Node.js 18+ is required. Install Node and re-run."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[bootstrap] npm not found. Install Node.js and re-run."
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[bootstrap] python3 is required for MCP setup."
  exit 1
fi

NODE_VERSION="$(node -v)"
echo "[bootstrap] Node ${NODE_VERSION}"

echo "[bootstrap] Installing Node dependencies..."
npm install

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[bootstrap] Created .env from .env.example"
fi

echo "[bootstrap] Applying secure local defaults..."
npm run secure:local >/dev/null

echo "[bootstrap] Creating MCP virtual environment (.venv-mcp)..."
python3 -m venv .venv-mcp
# shellcheck disable=SC1091
source .venv-mcp/bin/activate
python -m pip install --upgrade pip >/dev/null
pip install -r mcp-server/requirements.txt

echo "[bootstrap] Running project checks..."
npm run check
npm test

echo
echo "[bootstrap] Done. Next steps:"
echo "  1) Start bridge server: npm start"
echo "  2) In Roblox Studio, load plugin/RobloxStudioBridge.lua as a Local Plugin"
echo "  3) Use Plugins > NovaBlox > Panel to configure host/key and enable bridge"
echo "  4) Optional: auto-build demo scene with npm run showcase:run"
