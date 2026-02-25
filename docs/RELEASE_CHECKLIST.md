# Release Checklist

## Functional

- [ ] `GET /bridge/health` returns `status=ok`
- [ ] Plugin button appears in Studio (`Plugins > NovaBlox`)
- [ ] Panel first-run wizard progresses (Save -> Health -> Enable -> Doctor/Showcase hint)
- [ ] `POST /bridge/test-spawn` creates glowing marker + "NovaBlox Connected" BillboardGui
- [ ] Poll flow works (`/bridge/commands` -> plugin executes -> `/bridge/results`)
- [ ] Batch results flow works (`/bridge/results/batch` with fallback to `/bridge/results`)
- [ ] SSE stream connects and plugin still polls on message
- [ ] Scene command smoke test (`spawn-object`, `set-property`, `delete-object`)
- [ ] Terrain command smoke test (`generate-terrain`)
- [ ] Environment command smoke test (`set-lighting`)
- [ ] Script insert smoke test
- [ ] Save/publish commands tested on Windows + macOS Studio
- [ ] Blender import queue route tested with OBJ and FBX upload
- [ ] `POST /bridge/asset/import-blender` tested with both upload and `asset_id` flows
- [ ] Blender scale fix (`scale_fix=blender_to_roblox`, `scale_factor=3.571428`) validated on imported model

## Cross-platform QA

- [ ] Windows: `scripts/start-server-windows.bat` works from fresh clone
- [ ] macOS: `scripts/start-server-macos.command` works from fresh clone
- [ ] Linux: `scripts/start-server-linux.sh` + `examples/mock/e2e_mock.sh` pass
- [ ] GitHub Actions `Node Check` passes on ubuntu/macOS/windows matrix
- [ ] `docs/SETUP_WINDOWS.md` validated
- [ ] `docs/SETUP_MACOS.md` validated
- [ ] `docs/SETUP_LINUX.md` validated

## Security

- [ ] API key enabled and validated
- [ ] Scoped keys validated (`ROBLOXBRIDGE_API_KEYS` read/write/admin)
- [ ] Rate limiting validated (`ROBLOXBRIDGE_RATE_LIMIT_*`)
- [ ] Bridge not publicly exposed without proxy/auth
- [ ] Upload file size limits verified
- [ ] `npm run secure:local` verified (`ROBLOXBRIDGE_API_KEY` + host lock)

## Packaging

- [ ] `scripts/package_release.sh v1.1.0`
- [ ] Zip contains plugin, server, docs, extension, python SDK, MCP server
- [ ] BuyerGuide and API docs updated to exact release behavior

## Launch assets

- [ ] Demo prompt script finalized
- [ ] Hero screenshot or gif exported
- [ ] Changelog/release notes published
