# macOS Setup

## Prereqs

- macOS 13+
- Roblox Studio
- Node.js 18+ (`node -v`)

## Server

```bash
cd /path/to/NovaBlox
chmod +x scripts/start-server-macos.command
./scripts/start-server-macos.command
```

## Plugin

1. Open Roblox Studio.
2. Open a place.
3. Open `plugin/RobloxStudioBridge.lua`.
4. Save as Local Plugin.
5. Restart Studio and click `Plugins > NovaBlox > Bridge`.

## Smoke test

```bash
curl -s http://localhost:30010/bridge/health | jq .
curl -s -X POST http://localhost:30010/bridge/test-spawn \
  -H 'Content-Type: application/json' \
  -d '{"text":"NovaBlox Connected","position":[0,8,0]}' | jq .
```
