# OpenClaw Extension: NovaBlox Roblox Bridge

This extension now exposes near 1:1 coverage of NovaBlox route groups:

- Scene (`/bridge/scene/*`)
- Asset (`/bridge/asset/*`)
- Terrain (`/bridge/terrain/*`)
- Environment (`/bridge/environment/*`)
- Script (`/bridge/script/*`)
- Simulation (`/bridge/simulation/*`)
- Viewport (`/bridge/viewport/*`)
- Workspace (`/bridge/workspace/*`)
- Blender (`/bridge/blender/import`)
- Blender asset route (`/bridge/asset/import-blender`)
- Connectivity test (`/bridge/test-spawn`)
- Queue control/status tools (`health`, `stats`, `recent`, `status`, `requeue`, `cancel`, `custom`)

Every POST command tool accepts:

- `payload` object (route-specific command body)
- optional `priority`
- optional `metadata`

Environment variables:

- `ROBLOXBRIDGE_HOST` (default `localhost`)
- `ROBLOXBRIDGE_PORT` (default `30010`)
- `ROBLOXBRIDGE_API_KEY` (optional)
