# Architecture

```text
AI Agent / OpenClaw / MCP
  -> Planner Engine (deterministic templates + optional LLM providers + risk policy)
  -> NovaBlox HTTP Bridge (Node.js)
    -> Command Queue (in-memory + snapshot persistence, lease + retries)
      -> Roblox Studio Plugin (poll + SSE-triggered fetch)
        -> Roblox Studio DataModel APIs
```

## Execution model

1. Agent calls an endpoint like `/bridge/scene/spawn-object`.
2. Server enqueues a normalized command.
3. Plugin pulls commands (`/bridge/commands`) and executes.
4. Plugin reports result (`/bridge/results/batch` with fallback to `/bridge/results`).
5. Command status is queryable via `/bridge/commands/:id`.

## Reliability controls

- Lease timeout for dispatched commands (`ROBLOXBRIDGE_COMMAND_LEASE_MS`)
- Requeue endpoint (`/bridge/commands/:id/requeue`)
- Cancel endpoint (`/bridge/commands/:id/cancel`)
- Retention cap (`ROBLOXBRIDGE_MAX_RETENTION`)
- Snapshot persistence (`ROBLOXBRIDGE_QUEUE_SNAPSHOT_PATH`)

## Real-time

- Polling is default and always supported.
- SSE endpoint (`/bridge/stream`) pushes notifications so clients can fetch immediately.
- Browser Studio UI (`/bridge/studio`) provides text/voice planning and plan queue controls.
- Scene introspection (`POST/GET /bridge/introspection/scene`) provides cached Workspace context for planner prompts.

## Security controls

- API key auth (`ROBLOXBRIDGE_API_KEY`)
- Scoped API keys (`ROBLOXBRIDGE_API_KEYS` with `read`/`write`/`admin`)
- Fixed-window rate limiter (`ROBLOXBRIDGE_RATE_LIMIT_WINDOW_MS`, `ROBLOXBRIDGE_RATE_LIMIT_MAX`)
- Local-only guard when auth is disabled (`ROBLOXBRIDGE_ALLOW_UNAUTHENTICATED_REMOTE=false` by default)
- Optional proxy-header trust for IP/rate-limit decisions (`ROBLOXBRIDGE_TRUST_PROXY`)
- Planner execute guardrail: dangerous plans require explicit `allow_dangerous=true`.
