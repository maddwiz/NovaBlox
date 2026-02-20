#!/usr/bin/env bash
set -euo pipefail

curl -s -X POST http://localhost:30010/bridge/test-spawn \
  -H 'Content-Type: application/json' \
  -d '{"text":"NovaBlox Connected","position":[0,8,0]}' | jq .
