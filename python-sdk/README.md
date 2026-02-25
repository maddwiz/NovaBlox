# NovaBlox Python SDK

```python
from novablox import NovaBlox

bridge = NovaBlox(host="localhost", port=30010)
print(bridge.health())
print(bridge.spawn_part(name="SDKPart", position=[0, 8, 0], color="Bright red"))
print(bridge.test_spawn())
print(bridge.blender_import(asset_id=1234567890, scale_factor=3.571428))
print(bridge.planner_templates())
print(bridge.plan(prompt="build a 10 platform obby", use_llm=False))
print(bridge.introspect_scene(max_objects=250))
print(bridge.scene_introspection(include_objects=False))
```

## Env mapping

- Host/port/api key can be passed explicitly.
- Use this SDK for agent wrappers, scripts, and MCP integrations.
