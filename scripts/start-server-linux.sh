#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -d node_modules ]]; then
  echo "[NovaBlox] Installing npm dependencies..."
  npm install
fi

echo "[NovaBlox] Starting bridge server on http://localhost:30010"
npm start
