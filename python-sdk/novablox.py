"""NovaBlox Python SDK.

Zero-dependency client for the NovaBlox Roblox Studio bridge.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional


class NovaBloxError(RuntimeError):
    """Raised on bridge communication failures."""


@dataclass
class NovaBlox:
    host: str = "localhost"
    port: int = 30010
    timeout: int = 60
    api_key: Optional[str] = None

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}/bridge"

    def _request(self, method: str, route: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        body = None
        headers = {}
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(body))
        if self.api_key:
            headers["X-API-Key"] = self.api_key

        req = urllib.request.Request(
            f"{self.base_url}{route}",
            method=method,
            data=body,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = resp.read()
                if not payload:
                    return {"status": "ok"}
                return json.loads(payload)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise NovaBloxError(f"HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise NovaBloxError(f"Connection failed: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise NovaBloxError(f"Invalid JSON response: {exc}") from exc

    def _get(self, route: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        final_route = route
        if params:
            final_route = f"{route}?{urllib.parse.urlencode(params)}"
        return self._request("GET", final_route)

    def _post(self, route: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._request("POST", route, data or {})

    def health(self) -> Dict[str, Any]:
        return self._get("/health")

    def stats(self) -> Dict[str, Any]:
        return self._get("/stats")

    def planner_templates(self) -> Dict[str, Any]:
        return self._get("/planner/templates")

    def planner_catalog(self) -> Dict[str, Any]:
        return self._get("/planner/catalog")

    def plan(
        self,
        *,
        prompt: str,
        template: Optional[str] = None,
        use_llm: bool = False,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        include_scene_context: bool = True,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "prompt": prompt,
            "use_llm": bool(use_llm),
            "include_scene_context": bool(include_scene_context),
        }
        if template:
            payload["template"] = template
        if provider:
            payload["provider"] = provider
        if model:
            payload["model"] = model
        if temperature is not None:
            payload["temperature"] = float(temperature)
        return self._post("/assistant/plan", payload)

    def assistant_plan(
        self,
        *,
        prompt: str,
        template: Optional[str] = None,
        use_llm: bool = False,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        include_scene_context: bool = True,
    ) -> Dict[str, Any]:
        return self.plan(
            prompt=prompt,
            template=template,
            use_llm=use_llm,
            provider=provider,
            model=model,
            temperature=temperature,
            include_scene_context=include_scene_context,
        )

    def execute_plan(
        self,
        *,
        plan: Optional[Dict[str, Any]] = None,
        prompt: Optional[str] = None,
        template: Optional[str] = None,
        allow_dangerous: bool = False,
        use_llm: bool = False,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        include_scene_context: bool = True,
        expires_in_ms: Optional[int] = None,
        idempotency_prefix: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "allow_dangerous": bool(allow_dangerous),
            "use_llm": bool(use_llm),
            "include_scene_context": bool(include_scene_context),
        }
        if plan is not None:
            payload["plan"] = plan
        if prompt:
            payload["prompt"] = prompt
        if template:
            payload["template"] = template
        if provider:
            payload["provider"] = provider
        if model:
            payload["model"] = model
        if temperature is not None:
            payload["temperature"] = float(temperature)
        if expires_in_ms is not None:
            payload["expires_in_ms"] = int(expires_in_ms)
        if idempotency_prefix:
            payload["idempotency_prefix"] = idempotency_prefix
        return self._post("/assistant/execute", payload)

    def introspect_scene(
        self,
        *,
        max_objects: int = 500,
        include_selection: bool = True,
        include_non_workspace: bool = False,
    ) -> Dict[str, Any]:
        return self._post(
            "/introspection/scene",
            {
                "max_objects": int(max_objects),
                "include_selection": bool(include_selection),
                "include_non_workspace": bool(include_non_workspace),
            },
        )

    def scene_introspection(self, *, include_objects: bool = False) -> Dict[str, Any]:
        return self._get(
            "/introspection/scene",
            {"include_objects": "true" if include_objects else "false"},
        )

    def command_status(self, command_id: str) -> Dict[str, Any]:
        return self._get(f"/commands/{urllib.parse.quote(command_id)}")

    def queue_command(
        self,
        *,
        route: str,
        action: str,
        payload: Optional[Dict[str, Any]] = None,
        category: str = "custom",
        priority: int = 0,
        idempotency_key: Optional[str] = None,
        expires_in_ms: Optional[int] = None,
        expires_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "route": route,
            "action": action,
            "category": category,
            "priority": priority,
            "payload": payload or {},
        }
        if idempotency_key:
            body["idempotency_key"] = idempotency_key
        if expires_in_ms is not None:
            body["expires_in_ms"] = int(expires_in_ms)
        if expires_at:
            body["expires_at"] = expires_at
        return self._post(
            "/command",
            body,
        )

    def spawn_part(
        self,
        *,
        name: str = "Part",
        position: Optional[list[float]] = None,
        size: Optional[list[float]] = None,
        color: str = "Bright red",
        anchored: bool = True,
    ) -> Dict[str, Any]:
        return self._post(
            "/scene/spawn-object",
            {
                "class_name": "Part",
                "name": name,
                "position": position or [0, 5, 0],
                "size": size or [4, 1, 2],
                "color": color,
                "anchored": anchored,
            },
        )

    def set_property(
        self,
        *,
        property_name: str,
        value: Any,
        target_name: Optional[str] = None,
        target_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"property": property_name, "value": value}
        if target_name:
            payload["target_name"] = target_name
        if target_path:
            payload["target_path"] = target_path
        return self._post("/scene/set-property", payload)

    def set_transform(
        self,
        *,
        target_name: Optional[str] = None,
        target_path: Optional[str] = None,
        position: Optional[list[float]] = None,
        rotation: Optional[list[float]] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if target_name:
            payload["target_name"] = target_name
        if target_path:
            payload["target_path"] = target_path
        if position:
            payload["position"] = position
        if rotation:
            payload["rotation"] = rotation
        return self._post("/scene/set-transform", payload)

    def delete_object(self, *, target_name: Optional[str] = None, target_path: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if target_name:
            payload["target_name"] = target_name
        if target_path:
            payload["target_path"] = target_path
        return self._post("/scene/delete-object", payload)

    def set_lighting(
        self,
        *,
        brightness: Optional[float] = None,
        exposure_compensation: Optional[float] = None,
        ambient: Optional[list[float]] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if brightness is not None:
            payload["brightness"] = float(brightness)
        if exposure_compensation is not None:
            payload["exposure_compensation"] = float(exposure_compensation)
        if ambient:
            payload["ambient"] = ambient
        return self._post("/environment/set-lighting", payload)

    def generate_terrain(
        self,
        *,
        center: Optional[list[float]] = None,
        size: Optional[list[float]] = None,
        material: str = "Grass",
    ) -> Dict[str, Any]:
        return self._post(
            "/terrain/generate-terrain",
            {
                "center": center or [0, 0, 0],
                "size": size or [256, 64, 256],
                "material": material,
            },
        )

    def insert_script(
        self,
        *,
        source: str,
        name: str = "GeneratedScript",
        parent_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"source": source, "name": name}
        if parent_path:
            payload["parent_path"] = parent_path
        return self._post("/script/insert-script", payload)

    def publish_place(self) -> Dict[str, Any]:
        return self._post("/asset/publish-place", {})

    def blender_import(
        self,
        *,
        file_path: Optional[str] = None,
        asset_id: Optional[int] = None,
        scale_factor: Optional[float] = 3.571428,
        scale_fix: str = "blender_to_roblox",
        parent_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "scale_fix": scale_fix,
        }
        if file_path:
            payload["file_path"] = file_path
        if asset_id is not None:
            payload["asset_id"] = int(asset_id)
        if scale_factor is not None:
            payload["scale_factor"] = float(scale_factor)
        if parent_path:
            payload["parent_path"] = parent_path
        return self._post("/asset/import-blender", payload)

    def blender_import_legacy(self, *, file_path: str, scale_factor: Optional[float] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"file_path": file_path}
        if scale_factor is not None:
            payload["scale_factor"] = float(scale_factor)
        return self._post("/blender/import", payload)

    def test_spawn(
        self,
        *,
        text: str = "NovaBlox Connected",
        position: Optional[list[float]] = None,
        color: str = "Bright bluish green",
    ) -> Dict[str, Any]:
        return self._post(
            "/test-spawn",
            {
                "text": text,
                "position": position or [0, 8, 0],
                "color": color,
            },
        )

    def viewport_screenshot(
        self,
        *,
        output_name: str = "novablox-shot.png",
        external_capture_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"output_name": output_name}
        if external_capture_url:
            payload["external_capture_url"] = external_capture_url
        return self._post("/viewport/screenshot", payload)

    def pull_commands(self, client_id: str = "python-client", limit: int = 20) -> Dict[str, Any]:
        return self._get("/commands", {"client_id": client_id, "limit": max(1, min(100, int(limit)))})

    def report_result(
        self,
        *,
        command_id: str,
        ok: bool,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
        requeue: bool = False,
        dispatch_token: Optional[str] = None,
        execution_ms: Optional[float] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "command_id": command_id,
            "ok": bool(ok),
            "status": "ok" if ok else "error",
            "result": result,
            "error": error,
            "requeue": requeue,
        }
        if dispatch_token:
            payload["dispatch_token"] = dispatch_token
        if execution_ms is not None:
            payload["execution_ms"] = float(execution_ms)
        return self._post(
            "/results",
            payload,
        )
