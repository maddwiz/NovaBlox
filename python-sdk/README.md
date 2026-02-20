# NovaBlox Python SDK

```python
from novablox import NovaBlox

bridge = NovaBlox(host="localhost", port=30010)
print(bridge.health())
print(bridge.spawn_part(name="SDKPart", position=[0, 8, 0], color="Bright red"))
print(bridge.test_spawn())
print(bridge.blender_import(asset_id=1234567890, scale_factor=3.571428))
```

## Env mapping

- Host/port/api key can be passed explicitly.
- Use this SDK for agent wrappers, scripts, and MCP integrations.
