#!/usr/bin/env python3
"""NovaBlox MCP server."""

from __future__ import annotations

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


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
