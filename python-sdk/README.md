# NovaBlox Python SDK

```python
from novablox import NovaBlox

bridge = NovaBlox(host="localhost", port=30010)
print(bridge.health())
print(bridge.spawn_part(name="SDKPart", position=[0, 8, 0], color="Bright red"))
```

## Env mapping

- Host/port/api key can be passed explicitly.
- Use this SDK for agent wrappers, scripts, and MCP integrations.
