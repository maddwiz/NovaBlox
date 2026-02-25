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

For Apple Silicon (`arm64`) full setup + verification:

```bash
npm run bootstrap:macos-arm64
```

Enable local security defaults:

```bash
npm run secure:local
```

## Plugin

1. Open Roblox Studio.
2. Open a place.
3. Open `plugin/RobloxStudioBridge.lua`.
4. Save as Local Plugin.
5. Restart Studio.
6. Open `Plugins > NovaBlox > Panel`.
7. In terminal, run `npm run studio:sync` (avoids long key copy/paste in Studio).
   Re-run this after any `.env` host/API key update.
8. Restart Studio, then use `Plugins > NovaBlox > Panel` and follow the First-Run Wizard (`Next Step`).

## Smoke test

```bash
API_KEY=$(awk -F= '/^ROBLOXBRIDGE_API_KEY=/{print $2}' .env)
curl -s -H "X-API-Key: $API_KEY" http://127.0.0.1:30010/bridge/health | jq .
curl -s -X POST http://127.0.0.1:30010/bridge/test-spawn \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"text":"NovaBlox Connected","position":[0,8,0]}' | jq .
```

## Showcase

```bash
npm run showcase:run
```
