#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/file.fbx"
  exit 1
fi

curl -s -X POST http://localhost:30010/bridge/asset/import-blender \
  -F "file=@$1" \
  -F "scale_fix=blender_to_roblox" \
  -F "scale_factor=3.571428" | jq .
