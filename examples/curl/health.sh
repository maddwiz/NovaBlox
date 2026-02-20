#!/usr/bin/env bash
set -euo pipefail
curl -s http://localhost:30010/bridge/health | jq .
