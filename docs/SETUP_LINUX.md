# Linux Setup (Server + Mock)

Roblox Studio is not officially supported on Linux in this workflow, but you can run the bridge server and mock client.

## Prereqs

- Linux
- Node.js 18+ (`node -v`)

## Server

```bash
cd /home/nova/NovaBlox
chmod +x scripts/start-server-linux.sh
./scripts/start-server-linux.sh
```

## Mock studio e2e

```bash
bash examples/mock/e2e_mock.sh
```
