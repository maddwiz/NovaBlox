# NovaBlox MCP Server

## Install

```bash
cd /path/to/NovaBlox/mcp-server
pip install -r requirements.txt
```

## Run

```bash
ROBLOXBRIDGE_HOST=localhost ROBLOXBRIDGE_PORT=30010 python novablox_mcp.py
```

## Exposed tools

- `roblox_health`
- `roblox_spawn_part`
- `roblox_set_property`
- `roblox_delete`
- `roblox_set_lighting`
- `roblox_generate_terrain`
- `roblox_insert_script`
- `roblox_publish_place`
- `roblox_command_status`
- `roblox_test_spawn`
- `roblox_import_blender`
- `roblox_planner_templates`
- `roblox_planner_catalog`
- `roblox_assistant_templates`
- `roblox_assistant_catalog`
- `roblox_assistant_plan`
- `roblox_assistant_execute`
- `roblox_scene_introspect`
- `roblox_scene_introspection`

`roblox_assistant_plan` and `roblox_assistant_execute` expose planner/assistant controls including `provider`, `model`, `temperature`, `timeout_ms`, and optional JSON scene context overrides.

`roblox_scene_introspect` supports hierarchy scope control via `traversal_scope` (`workspace|services|datamodel`) and optional `services_csv`.
