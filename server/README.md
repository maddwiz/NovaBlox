# NovaBlox Server

Run:

```bash
node index.js
```

By default, server listens on `127.0.0.1:30010` for local-only safety.
`server/index.js` loads `.env` automatically via `dotenv`.

The server queues bridge commands from `/bridge/*` endpoints and exposes:

- polling API: `GET /bridge/commands`
- result API: `POST /bridge/results`
- batch result API: `POST /bridge/results/batch`
- SSE notifications: `GET /bridge/stream`
- planner APIs: `GET /bridge/planner/templates`, `POST /bridge/assistant/plan`, `POST /bridge/assistant/execute`
- blender asset bridge: `POST /bridge/asset/import-blender`
- connectivity smoke test: `POST /bridge/test-spawn`
- idempotency support: `X-Idempotency-Key` / `idempotency_key`
- command expiry: `expires_in_ms` / `expires_at`
- queue snapshot persistence via `ROBLOXBRIDGE_QUEUE_SNAPSHOT_PATH` (default: `~/.novablox/queue-snapshot.json`)
- optional scoped keys: `ROBLOXBRIDGE_API_KEYS` (format: `key:role,key:role`)
- request rate limit: `ROBLOXBRIDGE_RATE_LIMIT_*`
- browser Studio UI: `GET /bridge/studio`
- browser API docs explorer: `GET /docs`

See `../docs/API.md` for full route list.
