# NovaBlox

NovaBlox is a Roblox Studio bridge for AI agents (OpenClaw/MCP/custom LLM agents).  
It exposes HTTP endpoints that queue Studio commands, then a Roblox Studio plugin pulls and executes those commands in real time.
Version: `1.1.0`

## What you get

- Queue-based bridge server (`server/index.js`)
- Roblox Studio local plugin (`plugin/RobloxStudioBridge.lua`)
- Plugin metadata (`plugin/NovaBlox.plugin.json`)
- SSE notifications + polling fallback
- Idempotent command enqueue (`X-Idempotency-Key` / `idempotency_key`)
- Command expiration support (`expires_in_ms` / `expires_at`)
- Dispatch-token protected result reporting (rejects stale results)
- Batch result reporting (`POST /bridge/results/batch`) with single-result fallback
- Queue snapshot persistence across restarts
- Scoped API keys (`read`/`write`/`admin`) + built-in rate limiting
- Deterministic AI planner engine + risk guardrails (`/bridge/assistant/plan`, `/bridge/assistant/execute`)
- Optional LLM planning providers (OpenAI / OpenRouter / Anthropic) with deterministic fallback
- Planner metadata endpoints (`/bridge/planner/templates`, `/bridge/planner/catalog`)
- Scene introspection queue + cache endpoints (`POST/GET /bridge/introspection/scene`)
- Browser Studio UI (`/bridge/studio`) with text + voice planning
- Browsable API explorer (`/docs`)
- 40+ command endpoints (scene, assets, terrain, lighting, scripts, viewport, publish/save)
- Blender pipeline endpoint (`POST /bridge/asset/import-blender`) with scale-fix payload support
- Instant connectivity endpoint (`POST /bridge/test-spawn`)
- One-command showcase builder (`npm run showcase:run`)
- One-command ultimate LLM demo runner (`npm run showcase:ultimate`)
- OpenClaw extension (`extensions/openclaw/roblox-bridge`)
- Python SDK (`python-sdk`)
- MCP server (`mcp-server`)
- Packaging script (`scripts/package_release.sh`)

## Quick start

1. Install server dependencies:
   ```bash
   cd /path/to/NovaBlox
   npm install
   ```
2. Run one-click BYOK setup (auto-detects cloud key or local model endpoint, then syncs Studio plugin settings):
   ```bash
   npm run setup:oneclick
   ```
3. Start bridge:
   ```bash
   npm start
   ```
4. In Roblox Studio, save `plugin/RobloxStudioBridge.lua` as a Local Plugin.
5. Enable Studio HTTP requests when prompted.
6. (Optional if you skipped one-click setup) sync plugin settings from terminal:
   ```bash
   npm run studio:sync
   ```
   This sync step is required any time host/API key changes.
7. Restart Roblox Studio, then open `Plugins > NovaBlox > Panel` and follow the **First-Run Wizard** (`Next Step`).
8. Test from terminal:
   ```bash
   API_KEY=$(awk -F= '/^ROBLOXBRIDGE_API_KEY=/{print $2}' .env)
   curl -s -H "X-API-Key: $API_KEY" http://127.0.0.1:30010/bridge/health | jq .
   curl -s -X POST http://127.0.0.1:30010/bridge/scene/spawn-object \
     -H "X-API-Key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"class_name":"Part","name":"BridgeTest","position":[0,8,0],"color":"Bright red","anchored":true}' | jq .
   ```
9. Open browser tools:
   - Studio planner UI: `http://127.0.0.1:30010/bridge/studio`
   - API explorer: `http://127.0.0.1:30010/docs`

## OS launchers

- Windows: `scripts/start-server-windows.bat`
- macOS: `scripts/start-server-macos.command`
- Linux: `scripts/start-server-linux.sh`

### macOS arm64 fast bootstrap

```bash
npm run bootstrap:macos-arm64
```

### Secure local setup

```bash
npm run secure:local
```

This generates `ROBLOXBRIDGE_API_KEY`, locks host to `127.0.0.1`, and updates `.env`.

### Sync Studio plugin settings (no manual key paste)

```bash
npm run studio:sync
```

This writes `novablox_bridgeHost` and `novablox_apiKey` directly into Roblox plugin settings.

### One-click BYOK setup

```bash
npm run setup:oneclick
```

This command:

- ensures secure local bridge host/API key values
- auto-selects assistant mode from your environment:
  - `OPENROUTER_API_KEY` -> `openrouter`
  - `ANTHROPIC_API_KEY` -> `anthropic`
  - `OPENAI_API_KEY` -> `openai`
  - no cloud key + local endpoint found -> OpenAI-compatible local mode (Ollama or LM Studio)
  - none found -> deterministic fallback
- syncs host/API key into Roblox plugin settings

### One-command doctor (diagnose + auto-fix)

```bash
npm run doctor
```

This checks local plugin install, syncs Studio settings, validates server/auth, and runs a pull-path probe.

### One-command showcase scene

```bash
npm run showcase:run
```

Run this while Studio plugin is enabled to auto-build a polished demo map.

### One-command ultimate LLM demo

```bash
npm run showcase:ultimate
```

This runs a curated 3-step OpenAI/OpenRouter/Anthropic-powered scene build workflow and waits for command completion.
Set `ROBLOXBRIDGE_ASSISTANT_PROVIDER` and provider API key in `.env` first.

### Package beta release zip

```bash
bash scripts/package_release.sh v1.1.0-beta.1
```

Output: `dist/NovaBlox-v1.1.0-beta.1.zip`

## Env vars

See `.env.example`.
`npm start` loads `.env` automatically.

- `ROBLOXBRIDGE_HOST`
- `ROBLOXBRIDGE_PORT`
- `ROBLOXBRIDGE_API_KEY`
- `ROBLOXBRIDGE_API_KEYS` (optional, comma-separated `key:role`)
- `ROBLOXBRIDGE_COMMAND_LEASE_MS`
- `ROBLOXBRIDGE_MAX_RETENTION`
- `ROBLOXBRIDGE_IMPORT_DIR`
- `ROBLOXBRIDGE_EXPORT_DIR`
- `ROBLOXBRIDGE_MAX_UPLOAD_MB`
- `ROBLOXBRIDGE_QUEUE_SNAPSHOT_PATH` (unset = default `~/.novablox/queue-snapshot.json`; set empty to disable)
- `ROBLOXBRIDGE_MAX_EXPIRES_IN_MS`
- `ROBLOXBRIDGE_RATE_LIMIT_WINDOW_MS`
- `ROBLOXBRIDGE_RATE_LIMIT_MAX`
- `ROBLOXBRIDGE_RATE_LIMIT_EXEMPT_LOCAL`
- `ROBLOXBRIDGE_ALLOW_UNAUTHENTICATED_REMOTE` (default `false`; unsafe if `true`)
- `ROBLOXBRIDGE_TRUST_PROXY` (default `false`)
- `ROBLOXBRIDGE_INTROSPECTION_DEFAULT_MAX_OBJECTS`
- `ROBLOXBRIDGE_INTROSPECTION_MAX_OBJECTS`
- `ROBLOXBRIDGE_ASSISTANT_PROVIDER` (`deterministic|openai|openrouter|anthropic`)
- `ROBLOXBRIDGE_ASSISTANT_TIMEOUT_MS`
- `ROBLOXBRIDGE_ASSISTANT_TEMPERATURE`
- `ROBLOXBRIDGE_ASSISTANT_OPENAI_BASE_URL` (OpenAI-compatible local/custom endpoint)
- `ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL`
- `ROBLOXBRIDGE_ASSISTANT_OPENROUTER_MODEL`
- `ROBLOXBRIDGE_ASSISTANT_ANTHROPIC_MODEL`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`
- `ANTHROPIC_API_KEY`

## Docs

- `docs/API.md`
- `docs/SETUP_WINDOWS.md`
- `docs/SETUP_MACOS.md`
- `docs/SETUP_LINUX.md`
- `docs/RELEASE_NOTES_v1.0.0.md`
- `docs/RELEASE_NOTES_v1.0.1.md`
- `docs/RELEASE_NOTES_v1.1.0.md`
- `CHANGELOG.md`
- `BuyerGuide.md`
- `docs/RELEASE_CHECKLIST.md`

## Notes

- In unauthenticated mode (no API keys configured), NovaBlox allows local requests only by default.  
  Set `ROBLOXBRIDGE_ALLOW_UNAUTHENTICATED_REMOTE=true` only for trusted/private networks.
- Roblox plugin APIs for direct file import and screenshot capture are not consistently exposed across Studio versions.  
  NovaBlox keeps these commands in the API surface, supports optional `external_capture_url` trigger payloads, and returns fallback guidance when manual/alternate capture is required.
- Buyer-facing details for these limits live in `BuyerGuide.md` under **Important Platform Limits**.
- Use `GET /bridge/capabilities` to introspect persistence/auth/import/capture/batch-result support at runtime.
