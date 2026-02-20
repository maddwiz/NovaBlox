#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:30010}"

echo "Queue spawn"
curl -s -X POST "${BASE}/bridge/scene/spawn-object" \
  -H 'Content-Type: application/json' \
  -d '{"class_name":"Part","name":"GoldenPath","position":[0,7,0],"size":[4,2,4],"color":"Bright red","anchored":true}' | jq .

echo "Queue lighting"
curl -s -X POST "${BASE}/bridge/environment/set-lighting" \
  -H 'Content-Type: application/json' \
  -d '{"brightness":2.2,"ambient":[0.2,0.2,0.25]}' | jq .

echo "Recent commands"
curl -s "${BASE}/bridge/commands/recent?limit=5" | jq .
