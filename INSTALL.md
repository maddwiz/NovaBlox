# Install

## 1. Bridge server

```bash
cd /path/to/NovaBlox
npm install
npm run setup:oneclick
npm start
```

One-click setup auto-configures secure local bridge values, detects BYOK provider or local model mode, and syncs Studio plugin settings.

macOS no-terminal launchers:

- Double-click `NovaBlox-OneClick-Setup.command` (full setup + bridge start + doctor)
- Double-click `NovaBlox-Stop-Bridge.command` (stop bridge)
- Terminal aliases (same behavior): `npm run macos:oneclick` and `npm run macos:stop`
- If macOS blocks launchers, right-click -> `Open` -> `Open`

macOS arm64 one-command bootstrap:

```bash
npm run bootstrap:macos-arm64
```

Secure local API key + host lock:

```bash
npm run secure:local
```

Shortcuts:

- Windows: `scripts/start-server-windows.bat`
- macOS: `scripts/start-server-macos.command`
- Linux: `scripts/start-server-linux.sh`

## 2. Roblox Studio plugin

1. Open Roblox Studio.
2. Create any place.
3. Open `plugin/RobloxStudioBridge.lua`.
4. Save script as a Local Plugin.
5. Restart Studio.
6. Run `npm run studio:sync` in the repo terminal (auto-writes host/API key settings).
   Re-run this command after any `.env` host/API key change.
7. Re-open Studio, click `Plugins > NovaBlox > Panel`, then follow the First-Run Wizard (`Next Step`).

## 3. Test

```bash
API_KEY=$(awk -F= '/^ROBLOXBRIDGE_API_KEY=/{print $2}' .env)
curl -s -H "X-API-Key: $API_KEY" http://127.0.0.1:30010/bridge/health | jq .
curl -s -X POST http://127.0.0.1:30010/bridge/test-spawn \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"text":"NovaBlox Connected","position":[0,8,0]}' | jq .
```

## 4. Showcase build

```bash
npm run showcase:run
```

## 5. Setup doctor (diagnose + auto-fix)

```bash
npm run doctor
```

## 6. Browser tools

- API explorer: `http://127.0.0.1:30010/docs`
- Studio planner UI (text + voice): `http://127.0.0.1:30010/bridge/studio`
