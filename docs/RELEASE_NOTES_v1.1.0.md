# NovaBlox v1.1.0

Release date: February 25, 2026

## Highlights

- Added Studio-native NovaBlox Control Panel (`Plugins > NovaBlox > Panel`):
  - host / API key / polling / batch / client settings
  - health check and pull-once actions
  - live status + last-error display
- Fixed Roblox Studio HTTP compatibility issue for `GET`/`HEAD` requests:
  - plugin no longer sends request body for methods that require empty bodies
- Added secure local setup workflow:
  - `npm run secure:local`
  - generates `ROBLOXBRIDGE_API_KEY`
  - locks host to `127.0.0.1`
  - server now reads `.env` on startup
- Added one-command showcase world generator:
  - `npm run showcase:run`
  - builds a polished demo scene (terrain, lighting, structures, camera, status marker)
- Hardened release defaults:
  - server default bind host switched to `127.0.0.1`
- Added/expanded reliability layer (shipped in this line):
  - idempotency keys, command expiration, dispatch-token result safety
  - queue snapshot persistence and execution timing

## Artifact

- `NovaBlox-v1.1.0.zip`

## Upgrade notes

1. Restart Roblox Studio to load updated plugin script.
2. Run `npm run secure:local` and restart bridge server.
3. Open `Plugins > NovaBlox > Panel`, paste API key, and click `Enable`.
4. Validate with `POST /bridge/test-spawn` or `npm run showcase:run`.
