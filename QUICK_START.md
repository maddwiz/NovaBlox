# Quick Start

```bash
cd /home/nova/NovaBlox
npm install
npm start
```

Then:

1. Install `plugin/RobloxStudioBridge.lua` as a local plugin in Studio.
2. Enable the plugin button (`Plugins > NovaBlox > Bridge`).
3. Queue your first command:
   ```bash
   curl -X POST http://localhost:30010/bridge/scene/spawn-object \
     -H 'Content-Type: application/json' \
     -d '{"class_name":"Part","name":"QuickStartPart","position":[0,10,0],"color":"Bright red","anchored":true}'
   ```
