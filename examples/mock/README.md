# Mock Studio Client

`mock_studio_client.js` simulates a Roblox Studio plugin worker against NovaBlox:

- polls `/bridge/commands`
- executes mock behaviors for common actions
- posts results to `/bridge/results`

## Run

```bash
cd /home/nova/NovaBlox
node examples/mock/mock_studio_client.js
```

Environment options:

- `ROBLOXBRIDGE_HOST` (default `localhost`)
- `ROBLOXBRIDGE_PORT` (default `30010`)
- `ROBLOXBRIDGE_API_KEY` (optional)
- `MOCK_CLIENT_ID` (default `mock-studio`)
- `MOCK_POLL_MS` (default `1000`)
- `MOCK_RUN_SECONDS` (default `0`, infinite)

## End-to-end demo

```bash
bash examples/mock/e2e_mock.sh
```
