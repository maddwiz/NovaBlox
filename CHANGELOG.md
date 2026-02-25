# Changelog

All notable changes to NovaBlox are documented in this file.

## [Unreleased]

### Added

- AI planner engine for Roblox workflows:
  - deterministic templates (`starter_scene`, `obstacle_course_builder`, `terrain_generator`, `lighting_mood_presets`)
  - risk-aware command planning and warnings
  - plan execution endpoint with dangerous-action guardrail
- New planner/catalog endpoints:
  - `GET /bridge/planner/templates`
  - `GET /bridge/planner/catalog`
  - `POST /bridge/assistant/plan`
  - `POST /bridge/assistant/execute`
- Scene introspection endpoints:
  - `POST /bridge/introspection/scene` (queue)
  - `GET /bridge/introspection/scene` (cached result)
- External LLM planner providers with deterministic fallback:
  - OpenAI
  - OpenRouter
  - Anthropic
- NovaBlox Studio web UI at `GET /bridge/studio` with:
  - text + voice input
  - plan preview and risk badges
  - one-click queue execution
- Studio UI refactor into static modules (`studio.html` + `studio.css` + `studio.js`).
- Browsable API explorer site at `GET /docs`.
- Endpoint metadata feed at `GET /bridge/docs/endpoints`.
- Package workflows:
  - `npm run lint`
  - `npm run format`
  - `npm run format:check`
  - `npm run showcase:ultimate`
  - `npm run setup:oneclick`
  - `npm run macos:oneclick`
  - `npm run macos:stop`
- macOS double-click launchers in repo root:
  - `NovaBlox-OneClick-Setup.command`
  - `NovaBlox-Stop-Bridge.command`

### Changed

- Buyer-facing docs now call out OBJ/FBX import and screenshot limitations more prominently.
- Setup docs now emphasize `npm run studio:sync` as the required host/API-key sync path.
- MCP server + Python SDK now expose planner and scene introspection endpoints.
- CI now runs lint/tests/format checks plus Python syntax verification.
- Added one-click BYOK setup (`scripts/setup_oneclick.js`) with automatic provider selection:
  - OpenAI / OpenRouter / Anthropic key detection
  - OpenAI-compatible local model auto-detect (Ollama / LM Studio)

## [1.1.0] - 2026-02-25

### Added

- Studio-native NovaBlox Control Panel (`Plugins > NovaBlox > Panel`) with settings, health check, pull-once, and live status.
- Secure local setup helper (`npm run secure:local`).
- One-command showcase scene generator (`npm run showcase:run`).
- Reliability upgrades:
  - idempotency keys
  - command expiration
  - dispatch-token validation
  - queue snapshot persistence

### Changed

- Default server bind host locked to `127.0.0.1`.
- Plugin HTTP behavior corrected for `GET`/`HEAD` compatibility.

## [1.0.1] - 2026-02-20

### Added

- Blender pipeline endpoint: `POST /bridge/asset/import-blender`.
- Connectivity probe endpoint: `POST /bridge/test-spawn`.
- Plugin support for blender scale-fix payload and optional `asset_id` insert path.
- Screenshot/render fallback path with optional `external_capture_url` trigger.
- Expanded OpenClaw, Python SDK, and MCP coverage for blender import + test spawn.
- Plugin metadata manifest: `plugin/NovaBlox.plugin.json`.

### Changed

- API docs upgraded into full copy/paste cookbook format.

## [1.0.0] - 2026-02-20

### Added

- Initial public NovaBlox release.
- Queue bridge server + local Roblox Studio plugin worker.
- 40+ endpoints across scene, asset, terrain, environment, script, simulation, viewport, and workspace.
- OpenClaw extension, Python SDK, and MCP server.
- Setup/architecture/API docs, buyer guide, and release checklist.
- Cross-platform startup scripts and CI static checks.

### Known Limitations

- Some Studio operations vary by Roblox Studio API availability/permissions.
- Direct plugin-driven local OBJ/FBX import and screenshot capture may require manual workflows.
