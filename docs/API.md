# NovaBlox API (v1.1.0)

Base URL: `http://127.0.0.1:30010`  
Auth:

- Legacy single-key mode: set `ROBLOXBRIDGE_API_KEY`, then include `X-API-Key: <key>`.
- Scoped-key mode: set `ROBLOXBRIDGE_API_KEYS` as `key:role,key:role` with roles `read|write|admin`.
- Rate limit: controlled by `ROBLOXBRIDGE_RATE_LIMIT_WINDOW_MS` + `ROBLOXBRIDGE_RATE_LIMIT_MAX`.
- If auth is disabled, remote IPs are blocked by default unless `ROBLOXBRIDGE_ALLOW_UNAUTHENTICATED_REMOTE=true` (unsafe).
- `X-Forwarded-For` is ignored unless `ROBLOXBRIDGE_TRUST_PROXY=true`.

## Quick conventions

- Most `POST /bridge/...` command routes return a queued command object.
- Roblox Studio plugin pulls queued commands from `GET /bridge/commands`.
- Plugin reports completion to `POST /bridge/results/batch` (or `POST /bridge/results` fallback).
- `X-Idempotency-Key` (or `idempotency_key`) prevents duplicate queue entries on retries.
- `expires_in_ms` / `expires_at` can be included when queueing commands to drop stale work.
- Queue snapshots persist to `~/.novablox/queue-snapshot.json` by default (unless disabled).
- Browser docs explorer: `GET /docs`
- Browser planner UI: `GET /bridge/studio`
- Queue response shape is consistent across command endpoints:

```json
{
  "status": "queued",
  "command_id": "UUID",
  "category": "scene",
  "action": "spawn-object",
  "route": "/bridge/scene/spawn-object",
  "queued_at": "2026-02-20T00:00:00.000Z",
  "deduped": false,
  "idempotency_key": "agent-run-123-step-4",
  "expires_at": "2026-02-20T00:05:00.000Z"
}
```

## Core bridge endpoints

### `GET /bridge/health`

```bash
curl -s http://localhost:30010/bridge/health | jq .
```

```json
{
  "status": "ok",
  "product": "NovaBlox",
  "service": "RobloxStudioBridge",
  "version": "1.1.0",
  "queue": { "total_commands": 0, "pending_count": 0 },
  "security": {
    "bind_host": "127.0.0.1",
    "binds_local_only": true,
    "trust_proxy": false,
    "allow_unauthenticated_remote": false,
    "unauthenticated_remote_blocked": false
  }
}
```

### `GET /bridge/capabilities`

Returns runtime capability flags including persistence mode, auth/rate-limit state, import/capture constraints, and batch-result support.

```bash
curl -s http://127.0.0.1:30010/bridge/capabilities | jq .
```

### `GET /docs`

Browsable API explorer page.

```bash
open http://127.0.0.1:30010/docs
```

### `GET /bridge/studio`

Browser-based NovaBlox Studio UI (text + voice planning).

```bash
open http://127.0.0.1:30010/bridge/studio
```

### `GET /bridge/planner/templates`

List deterministic planner templates.

```bash
curl -s -H "X-API-Key: $API_KEY" http://127.0.0.1:30010/bridge/planner/templates | jq .
```

### `GET /bridge/planner/catalog`

List planner command catalog with risk levels.

```bash
curl -s -H "X-API-Key: $API_KEY" http://127.0.0.1:30010/bridge/planner/catalog | jq .
```

### `POST /bridge/assistant/plan`

Generate deterministic plan from prompt/template.

```bash
curl -s -X POST http://127.0.0.1:30010/bridge/assistant/plan \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"build a 10 platform obby","template":"obstacle_course_builder"}' | jq .
```

### `POST /bridge/assistant/execute`

Queue commands from a generated (or supplied) plan.

```bash
curl -s -X POST http://127.0.0.1:30010/bridge/assistant/execute \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"terrain generator with sunset mood","template":"terrain_generator"}' | jq .
```

If dangerous commands are present, set `allow_dangerous=true`.

### `GET /bridge/stats`

```bash
curl -s http://localhost:30010/bridge/stats | jq .
```

### `GET /bridge/stream` (SSE)

```bash
curl -N http://localhost:30010/bridge/stream
```

Example event:

```text
event: connected
data: {"client_id":"studio-abc","ts":"2026-02-20T02:00:00.000Z"}
```

### `POST /bridge/command`

```bash
curl -s -X POST http://localhost:30010/bridge/command \
  -H 'Content-Type: application/json' \
  -d '{
    "route": "/bridge/scene/spawn-object",
    "category": "scene",
    "action": "spawn-object",
    "payload": { "class_name": "Part", "name": "CmdPart" }
  }' | jq .
```

### `POST /bridge/commands/batch`

```bash
curl -s -X POST http://localhost:30010/bridge/commands/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "commands": [
      {"route":"/bridge/scene/spawn-object","category":"scene","action":"spawn-object","payload":{"name":"Batch1"}},
      {"route":"/bridge/environment/set-lighting","category":"environment","action":"set-lighting","payload":{"brightness":2.0}}
    ]
  }' | jq .
```

### `GET /bridge/commands`

```bash
curl -s 'http://localhost:30010/bridge/commands?client_id=studio-abc&limit=20' | jq .
```

```json
{
  "status": "ok",
  "client_id": "studio-abc",
  "count": 1,
  "commands": [
    {
      "id": "UUID",
      "category": "scene",
      "action": "spawn-object",
      "payload": { "name": "CmdPart" },
      "dispatch_token": "UUID",
      "expires_at": "2026-02-20T00:05:00.000Z"
    }
  ]
}
```

### `POST /bridge/results`

Use the `dispatch_token` returned by `GET /bridge/commands`; stale or missing tokens are rejected.

```bash
curl -s -X POST http://localhost:30010/bridge/results \
  -H 'Content-Type: application/json' \
  -d '{
    "command_id":"UUID",
    "dispatch_token":"UUID",
    "ok":true,
    "status":"ok",
    "execution_ms":14.2,
    "result":{"path":"Workspace.CmdPart"},
    "error":null
  }' | jq .
```

### `POST /bridge/results/batch`

Batch result report endpoint to reduce HTTP round trips.

```bash
curl -s -X POST http://127.0.0.1:30010/bridge/results/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "results":[
      {"command_id":"UUID-1","dispatch_token":"UUID-T1","ok":true,"status":"ok","execution_ms":7.2,"result":{"ok":true}},
      {"command_id":"UUID-2","dispatch_token":"UUID-T2","ok":false,"status":"error","error":"target not found"}
    ]
  }' | jq .
```

Example response:

```json
{
  "status": "partial",
  "total_count": 2,
  "success_count": 1,
  "error_count": 1,
  "duplicate_count": 0
}
```

### `GET /bridge/commands/recent`

```bash
curl -s 'http://localhost:30010/bridge/commands/recent?limit=10' | jq .
```

### `GET /bridge/commands/:id`

```bash
curl -s http://localhost:30010/bridge/commands/UUID | jq .
```

### `POST /bridge/commands/:id/requeue`

```bash
curl -s -X POST http://localhost:30010/bridge/commands/UUID/requeue | jq .
```

### `POST /bridge/commands/:id/cancel`

```bash
curl -s -X POST http://localhost:30010/bridge/commands/UUID/cancel | jq .
```

## Scene command endpoints

### `POST /bridge/scene/spawn-object`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/spawn-object \
  -H 'Content-Type: application/json' \
  -d '{"class_name":"Part","name":"TowerBrick","position":[0,12,0],"size":[6,2,6],"color":"Bright red","anchored":true}' | jq .
```

### `POST /bridge/scene/set-property`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/set-property \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","property":"Transparency","value":0.2}' | jq .
```

### `POST /bridge/scene/set-transform`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/set-transform \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","position":[0,16,0],"rotation":[0,45,0]}' | jq .
```

### `POST /bridge/scene/set-color`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/set-color \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","color":"Bright blue"}' | jq .
```

### `POST /bridge/scene/set-material`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/set-material \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","material":"Neon"}' | jq .
```

### `POST /bridge/scene/set-size`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/set-size \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","size":[8,2,8]}' | jq .
```

### `POST /bridge/scene/set-anchored`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/set-anchored \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","anchored":true}' | jq .
```

### `POST /bridge/scene/set-collidable`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/set-collidable \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","can_collide":false}' | jq .
```

### `POST /bridge/scene/group-objects`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/group-objects \
  -H 'Content-Type: application/json' \
  -d '{"group_name":"TowerGroup","target_paths":["Workspace/TowerBrick","Workspace/TowerBrick_Copy"]}' | jq .
```

### `POST /bridge/scene/duplicate-object`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/duplicate-object \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","new_name":"TowerBrick_Copy"}' | jq .
```

### `POST /bridge/scene/delete-object`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/delete-object \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick_Copy"}' | jq .
```

### `POST /bridge/scene/select-object`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/select-object \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick"}' | jq .
```

### `POST /bridge/scene/clear-selection`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/clear-selection \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

### `POST /bridge/scene/rename-object`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/rename-object \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBrick","new_name":"TowerBase"}' | jq .
```

### `POST /bridge/scene/create-folder`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/create-folder \
  -H 'Content-Type: application/json' \
  -d '{"name":"NovaBloxGenerated","parent_path":"Workspace"}' | jq .
```

### `POST /bridge/scene/parent-object`

```bash
curl -s -X POST http://localhost:30010/bridge/scene/parent-object \
  -H 'Content-Type: application/json' \
  -d '{"target_name":"TowerBase","parent_path":"Workspace/NovaBloxGenerated"}' | jq .
```

## Asset command endpoints

### `POST /bridge/asset/import-model`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/import-model \
  -H 'Content-Type: application/json' \
  -d '{"file_path":"/tmp/model.fbx"}' | jq .
```

### `POST /bridge/asset/import-model/upload`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/import-model/upload \
  -F file=@./model.fbx | jq .
```

### `POST /bridge/asset/import-blender` (new)

Upload file flow:

```bash
curl -s -X POST http://localhost:30010/bridge/asset/import-blender \
  -F file=@./character.fbx \
  -F scale_fix=blender_to_roblox \
  -F scale_factor=3.571428 | jq .
```

Asset ID flow (InsertService + scale fix):

```bash
curl -s -X POST http://localhost:30010/bridge/asset/import-blender \
  -H 'Content-Type: application/json' \
  -d '{
    "asset_id": 1234567890,
    "scale_fix": "blender_to_roblox",
    "scale_factor": 3.571428,
    "parent_path": "Workspace"
  }' | jq .
```

### `POST /bridge/blender/import` (legacy alias)

```bash
curl -s -X POST http://localhost:30010/bridge/blender/import \
  -F file=@./character.obj \
  -F scale_fix=blender_to_roblox | jq .
```

### `POST /bridge/asset/import-from-url`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/import-from-url \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/mesh.obj"}' | jq .
```

### `POST /bridge/asset/insert-toolbox-asset`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/insert-toolbox-asset \
  -H 'Content-Type: application/json' \
  -d '{"asset_id":1234567890}' | jq .
```

### `POST /bridge/asset/insert-asset-id`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/insert-asset-id \
  -H 'Content-Type: application/json' \
  -d '{"asset_id":1234567890}' | jq .
```

### `POST /bridge/asset/create-script`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/create-script \
  -H 'Content-Type: application/json' \
  -d '{"name":"ServerBoot","source":"print(\"hello\")","parent_path":"ServerScriptService"}' | jq .
```

### `POST /bridge/asset/create-local-script`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/create-local-script \
  -H 'Content-Type: application/json' \
  -d '{"name":"ClientBoot","source":"print(\"client\")","parent_path":"StarterPlayer/StarterPlayerScripts"}' | jq .
```

### `POST /bridge/asset/create-module-script`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/create-module-script \
  -H 'Content-Type: application/json' \
  -d '{"name":"SharedModule","source":"return {}","parent_path":"ReplicatedStorage"}' | jq .
```

### `POST /bridge/asset/save-place`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/save-place \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

### `POST /bridge/asset/export-place`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/export-place \
  -H 'Content-Type: application/json' \
  -d '{"file_path":"C:/temp/NovaBloxExport.rbxl"}' | jq .
```

### `POST /bridge/asset/publish-place`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/publish-place \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

### `POST /bridge/asset/upload-result`

```bash
curl -s -X POST http://localhost:30010/bridge/asset/upload-result \
  -F file=@./capture.png | jq .
```

## Terrain endpoints

### `POST /bridge/terrain/generate-terrain`

```bash
curl -s -X POST http://localhost:30010/bridge/terrain/generate-terrain \
  -H 'Content-Type: application/json' \
  -d '{"center":[0,0,0],"size":[512,64,512],"material":"Grass"}' | jq .
```

### `POST /bridge/terrain/fill-region`

```bash
curl -s -X POST http://localhost:30010/bridge/terrain/fill-region \
  -H 'Content-Type: application/json' \
  -d '{"center":[20,0,20],"size":[128,32,128],"material":"Ground"}' | jq .
```

### `POST /bridge/terrain/replace-material`

```bash
curl -s -X POST http://localhost:30010/bridge/terrain/replace-material \
  -H 'Content-Type: application/json' \
  -d '{"from_material":"Grass","to_material":"Sand"}' | jq .
```

### `POST /bridge/terrain/clear-region`

```bash
curl -s -X POST http://localhost:30010/bridge/terrain/clear-region \
  -H 'Content-Type: application/json' \
  -d '{"center":[0,0,0],"size":[64,32,64]}' | jq .
```

## Environment endpoints

### `POST /bridge/environment/set-lighting`

```bash
curl -s -X POST http://localhost:30010/bridge/environment/set-lighting \
  -H 'Content-Type: application/json' \
  -d '{"brightness":2.5,"exposure_compensation":0.2,"ambient":[0.15,0.15,0.2]}' | jq .
```

### `POST /bridge/environment/set-atmosphere`

```bash
curl -s -X POST http://localhost:30010/bridge/environment/set-atmosphere \
  -H 'Content-Type: application/json' \
  -d '{"density":0.35,"color":[0.7,0.8,1.0]}' | jq .
```

### `POST /bridge/environment/set-skybox`

```bash
curl -s -X POST http://localhost:30010/bridge/environment/set-skybox \
  -H 'Content-Type: application/json' \
  -d '{"skybox_asset_id":123456789}' | jq .
```

### `POST /bridge/environment/set-time`

```bash
curl -s -X POST http://localhost:30010/bridge/environment/set-time \
  -H 'Content-Type: application/json' \
  -d '{"clock_time":18.25}' | jq .
```

### `POST /bridge/environment/set-fog`

```bash
curl -s -X POST http://localhost:30010/bridge/environment/set-fog \
  -H 'Content-Type: application/json' \
  -d '{"fog_start":10,"fog_end":200,"fog_color":[0.6,0.7,0.8]}' | jq .
```

## Script + simulation endpoints

### `POST /bridge/script/insert-script`

```bash
curl -s -X POST http://localhost:30010/bridge/script/insert-script \
  -H 'Content-Type: application/json' \
  -d '{"name":"RoundManager","source":"print(\"round start\")","parent_path":"ServerScriptService"}' | jq .
```

### `POST /bridge/script/insert-local-script`

```bash
curl -s -X POST http://localhost:30010/bridge/script/insert-local-script \
  -H 'Content-Type: application/json' \
  -d '{"name":"HUDClient","source":"print(\"hud\")","parent_path":"StarterPlayer/StarterPlayerScripts"}' | jq .
```

### `POST /bridge/script/insert-module-script`

```bash
curl -s -X POST http://localhost:30010/bridge/script/insert-module-script \
  -H 'Content-Type: application/json' \
  -d '{"name":"UtilModule","source":"return { version = \"1\" }","parent_path":"ReplicatedStorage"}' | jq .
```

### `POST /bridge/script/run-command`

```bash
curl -s -X POST http://localhost:30010/bridge/script/run-command \
  -H 'Content-Type: application/json' \
  -d '{"command":"clear-selection"}' | jq .
```

### `POST /bridge/simulation/playtest/start`

```bash
curl -s -X POST http://localhost:30010/bridge/simulation/playtest/start \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

### `POST /bridge/simulation/playtest/stop`

```bash
curl -s -X POST http://localhost:30010/bridge/simulation/playtest/stop \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

## Viewport/workspace endpoints

### `POST /bridge/viewport/set-camera`

```bash
curl -s -X POST http://localhost:30010/bridge/viewport/set-camera \
  -H 'Content-Type: application/json' \
  -d '{"position":[20,20,20],"look_at":[0,0,0],"field_of_view":70}' | jq .
```

### `POST /bridge/viewport/focus-selection`

```bash
curl -s -X POST http://localhost:30010/bridge/viewport/focus-selection \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

### `POST /bridge/viewport/screenshot`

Simple fallback:

```bash
curl -s -X POST http://localhost:30010/bridge/viewport/screenshot \
  -H 'Content-Type: application/json' \
  -d '{"output_name":"shot_001.png"}' | jq .
```

Optional external capture trigger:

```bash
curl -s -X POST http://localhost:30010/bridge/viewport/screenshot \
  -H 'Content-Type: application/json' \
  -d '{
    "output_name":"shot_002.png",
    "external_capture_url":"http://127.0.0.1:39000/capture"
  }' | jq .
```

### `POST /bridge/viewport/render-frame`

```bash
curl -s -X POST http://localhost:30010/bridge/viewport/render-frame \
  -H 'Content-Type: application/json' \
  -d '{"output_name":"frame_001.png","external_capture_url":"http://127.0.0.1:39000/capture"}' | jq .
```

### `POST /bridge/workspace/autosave`

```bash
curl -s -X POST http://localhost:30010/bridge/workspace/autosave \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

## Test endpoint

### `POST /bridge/test-spawn`

Creates a neon glowing part + BillboardGui text `"NovaBlox Connected"` inside Studio plugin execution.

```bash
curl -s -X POST http://localhost:30010/bridge/test-spawn \
  -H 'Content-Type: application/json' \
  -d '{"position":[0,8,0],"text":"NovaBlox Connected"}' | jq .
```

## Typical plugin result payloads

Success:

```json
{
  "command_id": "UUID",
  "ok": true,
  "status": "ok",
  "result": {
    "spawned": "Workspace.NovaBloxConnected",
    "message": "NovaBlox test spawn complete"
  }
}
```

Fallback capture result:

```json
{
  "command_id": "UUID",
  "ok": true,
  "status": "ok",
  "result": {
    "accepted": true,
    "fallback_note": "Native screenshot APIs vary across Studio builds."
  }
}
```

## Notes

- For `import-blender`:
  - If `asset_id` is provided, plugin uses `InsertService` and applies scale fix automatically.
  - If only local file path/upload is provided, plugin returns guidance for manual Studio import where API support is limited.
- Recommended Blender scale fix: `3.571428` (`blender_to_roblox` mode).
