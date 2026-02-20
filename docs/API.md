# NovaBlox API

Base URL: `http://localhost:30010`  
All routes are under `/bridge/*`.  
If `ROBLOXBRIDGE_API_KEY` is set, send `X-API-Key`.

## Core bridge routes

- `GET /bridge/health`
- `GET /bridge/stats`
- `GET /bridge/stream` (SSE notifications)
- `POST /bridge/command`
- `POST /bridge/commands/batch`
- `GET /bridge/commands?client_id=studio-1&limit=20`
- `GET /bridge/commands/recent?limit=50`
- `GET /bridge/commands/:id`
- `POST /bridge/results`
- `POST /bridge/commands/:id/requeue`
- `POST /bridge/commands/:id/cancel`

## Scene routes

- `POST /bridge/scene/spawn-object`
- `POST /bridge/scene/set-property`
- `POST /bridge/scene/set-transform`
- `POST /bridge/scene/set-color`
- `POST /bridge/scene/set-material`
- `POST /bridge/scene/set-size`
- `POST /bridge/scene/set-anchored`
- `POST /bridge/scene/set-collidable`
- `POST /bridge/scene/group-objects`
- `POST /bridge/scene/duplicate-object`
- `POST /bridge/scene/delete-object`
- `POST /bridge/scene/select-object`
- `POST /bridge/scene/clear-selection`
- `POST /bridge/scene/rename-object`
- `POST /bridge/scene/create-folder`
- `POST /bridge/scene/parent-object`

## Asset routes

- `POST /bridge/asset/import-model`
- `POST /bridge/asset/import-model/upload` (multipart file)
- `POST /bridge/asset/import-from-url`
- `POST /bridge/asset/insert-toolbox-asset`
- `POST /bridge/asset/insert-asset-id`
- `POST /bridge/asset/create-script`
- `POST /bridge/asset/create-local-script`
- `POST /bridge/asset/create-module-script`
- `POST /bridge/asset/save-place`
- `POST /bridge/asset/export-place`
- `POST /bridge/asset/publish-place`
- `POST /bridge/asset/upload-result` (multipart file from plugin/export flow)

## Terrain routes

- `POST /bridge/terrain/generate-terrain`
- `POST /bridge/terrain/fill-region`
- `POST /bridge/terrain/replace-material`
- `POST /bridge/terrain/clear-region`

## Environment routes

- `POST /bridge/environment/set-lighting`
- `POST /bridge/environment/set-atmosphere`
- `POST /bridge/environment/set-skybox`
- `POST /bridge/environment/set-time`
- `POST /bridge/environment/set-fog`

## Script/simulation routes

- `POST /bridge/script/insert-script`
- `POST /bridge/script/insert-local-script`
- `POST /bridge/script/insert-module-script`
- `POST /bridge/script/run-command`
- `POST /bridge/simulation/playtest/start`
- `POST /bridge/simulation/playtest/stop`

## Viewport/workspace routes

- `POST /bridge/viewport/set-camera`
- `POST /bridge/viewport/focus-selection`
- `POST /bridge/viewport/screenshot`
- `POST /bridge/viewport/render-frame`
- `POST /bridge/workspace/autosave`

## Blender route

- `POST /bridge/blender/import` (multipart or `file_path`)

## Common response format

### Queue response
```json
{
  "status": "queued",
  "command_id": "UUID",
  "category": "scene",
  "action": "spawn-object",
  "route": "/bridge/scene/spawn-object",
  "queued_at": "2026-02-20T00:00:00.000Z"
}
```

### Poll response
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
      "payload": {
        "class_name": "Part",
        "position": [0, 8, 0]
      }
    }
  ]
}
```

### Result acknowledgement
```json
{
  "command_id": "UUID",
  "ok": true,
  "status": "ok",
  "result": { "path": "Workspace.Part" },
  "error": null
}
```

## Example: spawn part

```bash
curl -X POST http://localhost:30010/bridge/scene/spawn-object \
  -H 'Content-Type: application/json' \
  -d '{
    "class_name": "Part",
    "name": "TowerBrick",
    "position": [0, 12, 0],
    "size": [6, 2, 6],
    "color": "Bright red",
    "anchored": true
  }'
```
