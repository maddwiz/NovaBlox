# Release Checklist

## Functional

- [ ] `GET /bridge/health` returns `status=ok`
- [ ] Plugin button appears in Studio (`Plugins > NovaBlox`)
- [ ] Poll flow works (`/bridge/commands` -> plugin executes -> `/bridge/results`)
- [ ] SSE stream connects and plugin still polls on message
- [ ] Scene command smoke test (`spawn-object`, `set-property`, `delete-object`)
- [ ] Terrain command smoke test (`generate-terrain`)
- [ ] Environment command smoke test (`set-lighting`)
- [ ] Script insert smoke test
- [ ] Save/publish commands tested on Windows + macOS Studio
- [ ] Blender import queue route tested with OBJ and FBX upload

## Security

- [ ] API key enabled and validated
- [ ] Bridge not publicly exposed without proxy/auth
- [ ] Upload file size limits verified

## Packaging

- [ ] `scripts/package_release.sh v1.0.0`
- [ ] Zip contains plugin, server, docs, extension, python SDK, MCP server
- [ ] BuyerGuide and API docs updated to exact release behavior

## Launch assets

- [ ] Demo prompt script finalized
- [ ] Hero screenshot or gif exported
- [ ] Changelog/release notes published
