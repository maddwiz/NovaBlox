#!/usr/bin/env python3
"""NovaBlox MCP server."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

SDK_DIR = Path(__file__).resolve().parents[1] / "python-sdk"
if str(SDK_DIR) not in sys.path:
    sys.path.insert(0, str(SDK_DIR))

from novablox import NovaBlox, NovaBloxError  # noqa: E402

try:
    from mcp.server.fastmcp import FastMCP
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "Missing dependency: mcp\n"
        "Install with: pip install mcp\n"
        f"Import error: {exc}"
    )

HOST = os.environ.get("ROBLOXBRIDGE_HOST", "localhost")
PORT = int(os.environ.get("ROBLOXBRIDGE_PORT", "30010"))
API_KEY = os.environ.get("ROBLOXBRIDGE_API_KEY")

mcp = FastMCP("novablox")
client = NovaBlox(host=HOST, port=PORT, api_key=API_KEY)


def _wrap(func):
    try:
        return func()
    except NovaBloxError as exc:
        return {"status": "error", "error": str(exc)}
    except Exception as exc:  # pragma: no cover
        return {"status": "error", "error": f"Unexpected error: {exc}"}


def _parse_json_object(raw: Optional[str], label: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise NovaBloxError(f"{label} must be valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise NovaBloxError(f"{label} must decode to a JSON object")
    return parsed


@mcp.tool()
def roblox_health() -> Dict[str, Any]:
    """Check NovaBlox server health."""
    return _wrap(client.health)


@mcp.tool()
def roblox_spawn_part(
    name: str = "MCPPart",
    x: float = 0.0,
    y: float = 5.0,
    z: float = 0.0,
    color: str = "Bright red",
    anchored: bool = True,
) -> Dict[str, Any]:
    """Spawn a part in Studio."""
    return _wrap(lambda: client.spawn_part(name=name, position=[x, y, z], color=color, anchored=anchored))


@mcp.tool()
def roblox_set_property(
    property_name: str,
    value: Any,
    target_name: Optional[str] = None,
    target_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Set any property on an object."""
    return _wrap(
        lambda: client.set_property(
            property_name=property_name,
            value=value,
            target_name=target_name,
            target_path=target_path,
        )
    )


@mcp.tool()
def roblox_delete(target_name: Optional[str] = None, target_path: Optional[str] = None) -> Dict[str, Any]:
    """Delete an object."""
    return _wrap(lambda: client.delete_object(target_name=target_name, target_path=target_path))


@mcp.tool()
def roblox_set_lighting(
    brightness: Optional[float] = None,
    exposure_compensation: Optional[float] = None,
) -> Dict[str, Any]:
    """Set Roblox Lighting properties."""
    return _wrap(
        lambda: client.set_lighting(
            brightness=brightness,
            exposure_compensation=exposure_compensation,
        )
    )


@mcp.tool()
def roblox_generate_terrain(
    center_x: float = 0.0,
    center_y: float = 0.0,
    center_z: float = 0.0,
    size_x: float = 256.0,
    size_y: float = 64.0,
    size_z: float = 256.0,
    material: str = "Grass",
) -> Dict[str, Any]:
    """Fill terrain in a block region."""
    return _wrap(
        lambda: client.generate_terrain(
            center=[center_x, center_y, center_z],
            size=[size_x, size_y, size_z],
            material=material,
        )
    )


@mcp.tool()
def roblox_insert_script(source: str, name: str = "MCPGeneratedScript", parent_path: Optional[str] = None) -> Dict[str, Any]:
    """Insert a Script into Studio."""
    return _wrap(lambda: client.insert_script(source=source, name=name, parent_path=parent_path))


@mcp.tool()
def roblox_publish_place() -> Dict[str, Any]:
    """Queue a publish operation."""
    return _wrap(client.publish_place)


@mcp.tool()
def roblox_command_status(command_id: str) -> Dict[str, Any]:
    """Get command status."""
    return _wrap(lambda: client.command_status(command_id))


@mcp.tool()
def roblox_test_spawn(
    text: str = "NovaBlox Connected",
    x: float = 0.0,
    y: float = 8.0,
    z: float = 0.0,
    color: str = "Bright bluish green",
) -> Dict[str, Any]:
    """Queue an instant connectivity marker in Studio."""
    return _wrap(lambda: client.test_spawn(text=text, position=[x, y, z], color=color))


@mcp.tool()
def roblox_import_blender(
    file_path: Optional[str] = None,
    asset_id: Optional[int] = None,
    scale_factor: float = 3.571428,
    parent_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Queue blender import with scale fix support."""
    return _wrap(
        lambda: client.blender_import(
            file_path=file_path,
            asset_id=asset_id,
            scale_factor=scale_factor,
            parent_path=parent_path,
        )
    )


@mcp.tool()
def roblox_planner_templates() -> Dict[str, Any]:
    """List deterministic assistant templates."""
    return _wrap(client.planner_templates)


@mcp.tool()
def roblox_planner_catalog() -> Dict[str, Any]:
    """List assistant command catalog with risk levels."""
    return _wrap(client.planner_catalog)


@mcp.tool()
def roblox_assistant_templates() -> Dict[str, Any]:
    """Alias: list assistant templates."""
    return _wrap(client.planner_templates)


@mcp.tool()
def roblox_assistant_catalog() -> Dict[str, Any]:
    """Alias: list assistant route catalog."""
    return _wrap(client.planner_catalog)


@mcp.tool()
def roblox_assistant_plan(
    prompt: str,
    template: Optional[str] = None,
    use_llm: bool = False,
    allow_dangerous: bool = False,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    timeout_ms: Optional[int] = None,
    include_scene_context: bool = True,
    scene_context_json: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate a command plan from natural language."""

    def _run() -> Dict[str, Any]:
        scene_context = _parse_json_object(scene_context_json, "scene_context_json")
        return client.plan(
            prompt=prompt,
            template=template,
            use_llm=use_llm,
            allow_dangerous=allow_dangerous,
            provider=provider,
            model=model,
            temperature=temperature,
            timeout_ms=timeout_ms,
            include_scene_context=include_scene_context,
            scene_context=scene_context,
        )

    return _wrap(_run)


@mcp.tool()
def roblox_assistant_execute(
    prompt: Optional[str] = None,
    template: Optional[str] = None,
    plan_json: Optional[str] = None,
    allow_dangerous: bool = False,
    use_llm: bool = False,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    timeout_ms: Optional[int] = None,
    include_scene_context: bool = True,
    scene_context_json: Optional[str] = None,
) -> Dict[str, Any]:
    """Queue commands from generated prompt or provided plan JSON."""

    def _run() -> Dict[str, Any]:
        plan = _parse_json_object(plan_json, "plan_json")
        scene_context = _parse_json_object(scene_context_json, "scene_context_json")
        return client.execute_plan(
            plan=plan,
            prompt=prompt,
            template=template,
            allow_dangerous=allow_dangerous,
            use_llm=use_llm,
            provider=provider,
            model=model,
            temperature=temperature,
            timeout_ms=timeout_ms,
            include_scene_context=include_scene_context,
            scene_context=scene_context,
        )

    return _wrap(_run)


@mcp.tool()
def roblox_scene_introspect(
    max_objects: int = 500,
    include_selection: bool = True,
    include_non_workspace: bool = False,
    traversal_scope: str = "workspace",
    services_csv: str = "",
) -> Dict[str, Any]:
    """Queue scene introspection with optional scope/service controls."""

    services = [
        item.strip()
        for item in str(services_csv or "").split(",")
        if item.strip()
    ]
    return _wrap(
        lambda: client.introspect_scene(
            max_objects=max_objects,
            include_selection=include_selection,
            include_non_workspace=include_non_workspace,
            traversal_scope=traversal_scope,
            services=services,
        )
    )


@mcp.tool()
def roblox_scene_introspection(include_objects: bool = False) -> Dict[str, Any]:
    """Get latest cached scene introspection snapshot."""
    return _wrap(lambda: client.scene_introspection(include_objects=include_objects))


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
