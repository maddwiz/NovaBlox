# Architecture

```text
AI Agent / OpenClaw / MCP
  -> NovaBlox HTTP Bridge (Node.js)
    -> Command Queue (in-memory with lease + retries)
      -> Roblox Studio Plugin (poll + SSE-triggered fetch)
        -> Roblox Studio DataModel APIs
```

## Execution model

1. Agent calls an endpoint like `/bridge/scene/spawn-object`.
2. Server enqueues a normalized command.
3. Plugin pulls commands (`/bridge/commands`) and executes.
4. Plugin reports result (`/bridge/results`).
5. Command status is queryable via `/bridge/commands/:id`.

## Reliability controls

- Lease timeout for dispatched commands (`ROBLOXBRIDGE_COMMAND_LEASE_MS`)
- Requeue endpoint (`/bridge/commands/:id/requeue`)
- Cancel endpoint (`/bridge/commands/:id/cancel`)
- Retention cap (`ROBLOXBRIDGE_MAX_RETENTION`)

## Real-time

- Polling is default and always supported.
- SSE endpoint (`/bridge/stream`) pushes notifications so clients can fetch immediately.
