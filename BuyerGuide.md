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
   curl -X POST http://localhost:30010/bridge/test-spawn \
     -H 'Content-Type: application/json' \
     -d '{"text":"NovaBlox Connected","position":[0,8,0]}'
   ```
3. In Studio, confirm glowing marker + "NovaBlox Connected" text appears.
4. Check command completion:
   ```bash
   curl http://localhost:30010/bridge/commands/recent?limit=5
   ```

## Blender flow

1. Export `.obj` or `.fbx` from Blender.
2. Upload into NovaBlox:
   ```bash
   curl -X POST http://localhost:30010/bridge/asset/import-blender \
     -F file=@./character.fbx \
     -F scale_fix=blender_to_roblox \
     -F scale_factor=3.571428
   ```
3. Plugin receives import command and reports status.
4. If your Studio build cannot import local file via plugin API, import manually in Studio and then queue with `asset_id`:
   ```bash
   curl -X POST http://localhost:30010/bridge/asset/import-blender \
     -H 'Content-Type: application/json' \
     -d '{"asset_id":1234567890,"scale_fix":"blender_to_roblox","scale_factor":3.571428}'
   ```

## OpenClaw

Use `extensions/openclaw/roblox-bridge`.

## Security

- Set `ROBLOXBRIDGE_API_KEY` in production.
- Run bridge on localhost or private network only.
- Do not expose bridge directly on public internet without a reverse proxy and auth controls.
