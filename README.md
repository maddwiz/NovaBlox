# NovaBlox

NovaBlox is a Roblox Studio bridge for AI agents (OpenClaw/MCP/custom LLM agents).  
It exposes HTTP endpoints that queue Studio commands, then a Roblox Studio plugin pulls and executes those commands in real time.
Version: `1.0.0`

## What you get

- Queue-based bridge server (`server/index.js`)
- Roblox Studio local plugin (`plugin/RobloxStudioBridge.lua`)
- Plugin metadata (`plugin/NovaBlox.plugin.json`)
- SSE notifications + polling fallback
- 40+ command endpoints (scene, assets, terrain, lighting, scripts, viewport, publish/save)
- Blender pipeline endpoint (`POST /bridge/asset/import-blender`) with scale-fix payload support
- Instant connectivity endpoint (`POST /bridge/test-spawn`)
- OpenClaw extension (`extensions/openclaw/roblox-bridge`)
- Python SDK (`python-sdk`)
- MCP server (`mcp-server`)
- Packaging script (`scripts/package_release.sh`)

## Quick start

1. Install server dependencies:
   ```bash
   cd /home/nova/NovaBlox
   npm install
   ```
2. Start bridge:
   ```bash
   npm start
   ```
3. In Roblox Studio, save `plugin/RobloxStudioBridge.lua` as a Local Plugin.
4. Enable Studio HTTP requests when prompted.
5. Click `Plugins > NovaBlox > Bridge`.
6. Test from terminal:
   ```bash
   curl -s http://localhost:30010/bridge/health | jq .
   curl -s -X POST http://localhost:30010/bridge/scene/spawn-object \
     -H 'Content-Type: application/json' \
     -d '{"class_name":"Part","name":"BridgeTest","position":[0,8,0],"color":"Bright red","anchored":true}' | jq .
   ```

## OS launchers

- Windows: `scripts/start-server-windows.bat`
- macOS: `scripts/start-server-macos.command`
- Linux: `scripts/start-server-linux.sh`

## Env vars

See `.env.example`.

- `ROBLOXBRIDGE_HOST`
- `ROBLOXBRIDGE_PORT`
- `ROBLOXBRIDGE_API_KEY`
- `ROBLOXBRIDGE_COMMAND_LEASE_MS`
- `ROBLOXBRIDGE_MAX_RETENTION`
- `ROBLOXBRIDGE_IMPORT_DIR`
- `ROBLOXBRIDGE_EXPORT_DIR`
- `ROBLOXBRIDGE_MAX_UPLOAD_MB`

## Docs

- `docs/API.md`
- `docs/SETUP_WINDOWS.md`
- `docs/SETUP_MACOS.md`
- `docs/SETUP_LINUX.md`
- `docs/RELEASE_NOTES_v1.0.0.md`
- `BuyerGuide.md`
- `docs/RELEASE_CHECKLIST.md`

## Notes

- Roblox plugin APIs for direct file import and screenshot capture are not consistently exposed across Studio versions.  
  NovaBlox keeps these commands in the API surface, supports optional `external_capture_url` trigger payloads, and returns fallback guidance when manual/alternate capture is required.
