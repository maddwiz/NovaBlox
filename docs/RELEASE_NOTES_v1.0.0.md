# NovaBlox v1.0.0

Release date: February 20, 2026

## Highlights

- First public NovaBlox release.
- Roblox Studio bridge server with queued command execution model.
- Local Roblox plugin worker with polling + SSE-triggered fetch flow.
- 40+ command endpoints across scene, asset, terrain, environment, script, simulation, viewport, and workspace.
- OpenClaw extension with broad route coverage and queue control tools.
- Python SDK and MCP server for agent/tool integrations.
- Packaging scripts, API docs, buyer guide, and release checklist included.
- Cross-platform startup scripts and setup docs for Windows/macOS/Linux.
- CI matrix added for Node static checks on Ubuntu, macOS, and Windows.

## Included in this release

- Release artifact: `NovaBlox-v1.0.0.zip`
- Core server:
  - `server/index.js`
  - `server/command_store.js`
- Studio plugin:
  - `plugin/RobloxStudioBridge.lua`
- Integrations:
  - `extensions/openclaw/roblox-bridge`
  - `python-sdk`
  - `mcp-server`
- Docs:
  - `docs/API.md`
  - `docs/ARCHITECTURE.md`
  - `docs/SETUP_WINDOWS.md`
  - `docs/SETUP_MACOS.md`
  - `docs/SETUP_LINUX.md`
  - `docs/RELEASE_CHECKLIST.md`

## Known limitations (v1.0.0)

- Some Studio operations depend on Roblox Studio API availability and permissions in the current environment.
- Direct plugin-driven local OBJ/FBX import and viewport screenshot capture can require manual steps depending on Studio build.
- Manual QA on real Windows/macOS Studio remains recommended before commercial rollout.
