# Install

## 1. Bridge server

```bash
cd /home/nova/NovaBlox
npm install
npm start
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
6. Click `Plugins > NovaBlox > Bridge`.

## 3. Test

```bash
curl -s http://localhost:30010/bridge/health | jq .
curl -s -X POST http://localhost:30010/bridge/scene/spawn-object \
  -H 'Content-Type: application/json' \
  -d '{"class_name":"Part","name":"InstallTest","position":[0,8,0],"anchored":true}' | jq .
```
