# NovaBlox v1.0.1

Release date: February 20, 2026

## Highlights

- Added `POST /bridge/asset/import-blender` with Blender scale-fix support.
- Added `POST /bridge/test-spawn` for instant plugin connectivity validation.
- Expanded plugin behavior:
  - `import-blender` action with optional `asset_id` InsertService path
  - scale fix handling (`scale_fix`, `scale_factor`)
  - screenshot/render fallback with optional `external_capture_url` trigger
- Expanded OpenClaw extension tool coverage with:
  - `roblox_asset_import_blender`
  - `roblox_test_spawn`
- Expanded Python SDK + MCP for blender import and test spawn.
- Replaced API docs with a full copy-paste endpoint cookbook.
- Added plugin metadata manifest `plugin/NovaBlox.plugin.json`.

## Artifact

- `NovaBlox-v1.0.1.zip`

## Notes

- Native Studio APIs for direct local file import/screenshot can vary by Studio build.
- For consistent blender flow, use `asset_id` insert path when available, with `scale_fix=blender_to_roblox` and `scale_factor=3.571428`.
