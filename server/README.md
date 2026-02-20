# NovaBlox Server

Run:

```bash
node index.js
```

The server queues bridge commands from `/bridge/*` endpoints and exposes:

- polling API: `GET /bridge/commands`
- result API: `POST /bridge/results`
- SSE notifications: `GET /bridge/stream`

See `../docs/API.md` for full route list.
