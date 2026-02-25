# Quick Start

```bash
cd /path/to/NovaBlox
npm install
npm run setup:oneclick
npm start
```

macOS no-terminal path:

- Double-click `NovaBlox-OneClick-Setup.command` from Finder (does setup + starts bridge + runs doctor).

Then:

1. Install `plugin/RobloxStudioBridge.lua` as a local plugin in Studio.
2. Sync host/key into Studio settings from terminal (no manual paste):
   ```bash
   npm run studio:sync
   ```
   Re-run this after any `.env` host/API key update.
3. Restart Studio, then open `Plugins > NovaBlox > Panel` and follow the First-Run Wizard (`Next Step`).
4. Queue your first command:

   ```bash
   API_KEY=$(awk -F= '/^ROBLOXBRIDGE_API_KEY=/{print $2}' .env)
   curl -X POST http://127.0.0.1:30010/bridge/test-spawn \
     -H "X-API-Key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"text":"NovaBlox Connected","position":[0,8,0]}'
   ```

5. Build a full showcase scene:
   ```bash
   npm run showcase:run
   ```
6. Run the curated LLM “ultimate demo” flow (requires provider key in `.env`):
   ```bash
   npm run showcase:ultimate
   ```
7. Open browser tools:
   - API explorer: `http://127.0.0.1:30010/docs`
   - Studio planner UI (text + voice): `http://127.0.0.1:30010/bridge/studio`

If setup ever drifts, run:

```bash
npm run doctor
```
