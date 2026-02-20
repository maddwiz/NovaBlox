# NovaBlox Buyer Guide

## Install

1. Run the bridge server (`node server/index.js`).
2. Install the local plugin script from `plugin/RobloxStudioBridge.lua`.
3. Enable HTTP requests in Roblox Studio.
4. Click `Plugins > NovaBlox > Bridge`.

## Validate in 60 seconds

1. `curl http://localhost:30010/bridge/health`
2. Queue a command:
   ```bash
   curl -X POST http://localhost:30010/bridge/scene/spawn-object \
     -H 'Content-Type: application/json' \
     -d '{"class_name":"Part","name":"BuyerGuidePart","position":[0,10,0],"anchored":true}'
   ```
3. In Studio, confirm object appears.
4. Check command completion:
   ```bash
   curl http://localhost:30010/bridge/commands/recent?limit=5
   ```

## Blender flow

1. Export `.obj` or `.fbx` from Blender.
2. Upload into NovaBlox:
   ```bash
   curl -X POST http://localhost:30010/bridge/blender/import -F file=@./character.fbx
   ```
3. Plugin receives import command and reports status.

## OpenClaw

Use `extensions/openclaw/roblox-bridge`.

## Security

- Set `ROBLOXBRIDGE_API_KEY` in production.
- Run bridge on localhost or private network only.
- Do not expose bridge directly on public internet without a reverse proxy and auth controls.
