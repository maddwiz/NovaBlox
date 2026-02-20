# Launch Copy (v1.0.0)

## X/Twitter Post

OpenClaw now controls Roblox Studio end-to-end.  
NovaBlox v1.0.0 is live: queue-based AI bridge + Studio plugin + OpenClaw extension + Python/MCP SDK.  
Spawn, script, terrain, lighting, publish, and automate your build loop.

Repo: https://github.com/maddwiz/NovaBlox  
Release: https://github.com/maddwiz/NovaBlox/releases/tag/v1.0.0

#OpenClaw #RobloxDev #AIAgents #IndieDev

## X Thread Outline

1. Problem:
Roblox automation has been fragmented. Most tools stop at assets, not full Studio control.

2. What NovaBlox does:
- AI -> HTTP bridge -> queued commands -> Studio plugin executor
- Polling + SSE-triggered fetch
- Result acknowledgements and command state tracking

3. What you can automate:
- Scene creation and transforms
- Terrain/env lighting updates
- Script insertion
- Save/publish flows

4. Integrations:
- OpenClaw extension
- Python SDK
- MCP server

5. CTA:
Try `v1.0.0`, run the quick start, and share your first autonomous Roblox build.

## Reddit (r/robloxgamedev) Draft

Title:
Released NovaBlox v1.0.0: AI bridge for Roblox Studio (OpenClaw + MCP + Python SDK)

Body:
I just released NovaBlox, a Roblox Studio bridge for AI-driven workflows.

What it includes:
- Node bridge server with queued command model
- Roblox Studio plugin executor
- Scene/terrain/lighting/script/publish command routes
- OpenClaw extension
- Python SDK + MCP server

GitHub:
https://github.com/maddwiz/NovaBlox

If anyone wants to test and break it, I’d love feedback on Studio-specific edge cases and better command packs.

## Roblox DevForum Draft

Title:
NovaBlox v1.0.0 - AI bridge for Roblox Studio automation

Body:
Launching NovaBlox v1.0.0 for AI-assisted Studio workflows.

Core architecture:
AI agent -> HTTP bridge -> command queue -> Studio plugin executor -> result ack

Included:
- 40+ command endpoints
- OpenClaw extension
- Python SDK
- MCP server
- Cross-platform setup docs

Repo + release:
https://github.com/maddwiz/NovaBlox

Happy to iterate based on DevForum feedback and real Studio test cases.
