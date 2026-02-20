# NovaBlox Server

Run:

```bash
node index.js
```

The server queues bridge commands from `/bridge/*` endpoints and exposes:

- polling API: `GET /bridge/commands`
- result API: `POST /bridge/results`
- SSE notifications: `GET /bridge/stream`
- blender asset bridge: `POST /bridge/asset/import-blender`
- connectivity smoke test: `POST /bridge/test-spawn`

See `../docs/API.md` for full route list.
