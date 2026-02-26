# START HERE (First 10 Minutes)

This is the fastest beginner path for NovaBlox on macOS.

## 1. Run Setup (double-click)

In Finder, open your NovaBlox folder and double-click:

- `NovaBlox-OneClick-Setup.command`

If macOS blocks it, right-click the file and choose `Open`, then `Open` again.

This setup script:

- configures your local bridge
- starts the bridge server
- syncs Roblox plugin settings
- runs health checks
- auto-fills your NovaBlox API key in the web Studio UI
- copies your NovaBlox API key to clipboard as backup

## 2. Install the Roblox plugin (one time)

1. Open Roblox Studio.
2. Open any place.
3. Open `plugin/RobloxStudioBridge.lua` from the NovaBlox repo.
4. Save it as a **Local Plugin**.
5. Restart Roblox Studio.

## 3. Enable NovaBlox in Studio

Before using the panel, enable Studio HTTP:

1. In Studio, go to `Home > Game Settings > Security`.
2. Turn on `Enable Studio Access to API Services`.
3. Save, then restart Studio.

If this is OFF, NovaBlox health/pull will fail.

1. Open `Plugins > NovaBlox > Panel`.
2. Click `Health` (should return `ok`).
3. Click `Enable`.
4. Use `Build Demo` or enter an AI prompt.

## 4. Open the web control panel (optional)

- Studio UI: `http://127.0.0.1:30010/bridge/studio`
- API docs: `http://127.0.0.1:30010/docs`

## 5. Stop NovaBlox later

Double-click:

- `NovaBlox-Stop-Bridge.command`

## Quick Fixes

- `Health request failed`:
  - rerun `NovaBlox-OneClick-Setup.command`
  - restart Roblox Studio
  - in panel settings, ensure host is `http://127.0.0.1:30010`
  - confirm `Home > Game Settings > Security > Enable Studio Access to API Services` is ON
- `EADDRINUSE ... 30010` in terminal:
  - run `NovaBlox-Stop-Bridge.command`
  - then rerun setup
- No NovaBlox panel in Studio:
  - confirm plugin was saved as **Local Plugin**
  - restart Studio
  - check `Plugins > Manage Plugins` and ensure NovaBlox is enabled

## Optional: AI Provider

NovaBlox can run deterministic templates without cloud AI.
For free-form AI planning, add one provider key to `.env` and rerun setup:

- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `ANTHROPIC_API_KEY`

Or use a local OpenAI-compatible endpoint (like Ollama/LM Studio).
