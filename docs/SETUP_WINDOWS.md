# Windows Setup

## Prereqs

- Windows 10/11
- Roblox Studio
- Node.js 18+ (`node -v`)

## Server

```powershell
cd C:\path\to\NovaBlox
npm run setup:oneclick
scripts\start-server-windows.bat
```

## Plugin

Critical: enable `Home > Game Settings > Security > Enable Studio Access to API Services` in Roblox Studio.
If disabled, NovaBlox plugin health/pull fails.

1. Open Roblox Studio.
2. Open a place.
3. Load `plugin\RobloxStudioBridge.lua`.
4. Save as Local Plugin.
5. In a NovaBlox terminal, run `npm run studio:sync` (auto-writes host/API key).
6. Re-run `npm run studio:sync` after any `.env` host/API key change.
7. Restart Studio and click `Plugins > NovaBlox > Panel` to run the First-Run Wizard.

## Smoke test

```powershell
curl http://localhost:30010/bridge/health
curl -X POST http://localhost:30010/bridge/test-spawn `
  -H "Content-Type: application/json" `
  -d "{\"text\":\"NovaBlox Connected\",\"position\":[0,8,0]}"
```
