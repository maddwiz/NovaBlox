# Windows Setup

## Prereqs

- Windows 10/11
- Roblox Studio
- Node.js 18+ (`node -v`)

## Server

```powershell
cd C:\path\to\NovaBlox
scripts\start-server-windows.bat
```

## Plugin

1. Open Roblox Studio.
2. Open a place.
3. Load `plugin\RobloxStudioBridge.lua`.
4. Save as Local Plugin.
5. Restart Studio and click `Plugins > NovaBlox > Bridge`.

## Smoke test

```powershell
curl http://localhost:30010/bridge/health
curl -X POST http://localhost:30010/bridge/scene/spawn-object `
  -H "Content-Type: application/json" `
  -d "{\"class_name\":\"Part\",\"name\":\"WinSmoke\",\"position\":[0,8,0],\"anchored\":true}"
```
