#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-v1.0.0}"
DIST_DIR="${ROOT_DIR}/dist"
PKG_NAME="NovaBlox-${VERSION}"
PKG_DIR="${DIST_DIR}/${PKG_NAME}"
ZIP_PATH="${DIST_DIR}/${PKG_NAME}.zip"

rm -rf "${PKG_DIR}" "${ZIP_PATH}"
mkdir -p "${PKG_DIR}" "${DIST_DIR}"

copy_tree() {
  local src="$1"
  local dst="$2"
  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude '*.log' \
    --exclude 'dist' \
    "${src}" "${dst}"
}

copy_tree "${ROOT_DIR}/server" "${PKG_DIR}/"
copy_tree "${ROOT_DIR}/plugin" "${PKG_DIR}/"
copy_tree "${ROOT_DIR}/extensions" "${PKG_DIR}/"
copy_tree "${ROOT_DIR}/python-sdk" "${PKG_DIR}/"
copy_tree "${ROOT_DIR}/mcp-server" "${PKG_DIR}/"
copy_tree "${ROOT_DIR}/scripts" "${PKG_DIR}/"
copy_tree "${ROOT_DIR}/examples" "${PKG_DIR}/"
copy_tree "${ROOT_DIR}/docs" "${PKG_DIR}/"

cp "${ROOT_DIR}/README.md" "${PKG_DIR}/README.md"
cp "${ROOT_DIR}/QUICK_START.md" "${PKG_DIR}/QUICK_START.md"
cp "${ROOT_DIR}/INSTALL.md" "${PKG_DIR}/INSTALL.md"
cp "${ROOT_DIR}/BuyerGuide.md" "${PKG_DIR}/BuyerGuide.md"
cp "${ROOT_DIR}/EULA.txt" "${PKG_DIR}/EULA.txt"
cp "${ROOT_DIR}/package.json" "${PKG_DIR}/package.json"
cp "${ROOT_DIR}/.env.example" "${PKG_DIR}/.env.example"

(
  cd "${DIST_DIR}"
  zip -r "${ZIP_PATH}" "${PKG_NAME}" >/dev/null
)

echo "Created package: ${ZIP_PATH}"
