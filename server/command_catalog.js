"use strict";

const RISK_RANK = Object.freeze({
  safe: 1,
  caution: 2,
  dangerous: 3,
});

const RISK_BY_ACTION = Object.freeze({
  "delete-object": "dangerous",
  "run-command": "dangerous",
  "publish-place": "dangerous",
  "clear-region": "dangerous",
  "replace-material": "caution",
  "set-property": "caution",
  "set-transform": "caution",
  "set-size": "caution",
  "set-collidable": "caution",
  "set-anchored": "caution",
  "import-from-url": "caution",
  "insert-toolbox-asset": "caution",
  "insert-asset-id": "caution",
  "create-script": "caution",
  "create-local-script": "caution",
  "create-module-script": "caution",
  "insert-script": "caution",
  "insert-local-script": "caution",
  "insert-module-script": "caution",
  "parent-object": "caution",
  "playtest-start": "caution",
  "save-place": "caution",
  "export-place": "caution",
  "import-blender": "caution",
});

const BASE_CATALOG = Object.freeze([
  {
    route: "/bridge/scene/spawn-object",
    category: "scene",
    action: "spawn-object",
    summary: "Spawn a Roblox Instance in Workspace",
  },
  {
    route: "/bridge/scene/set-property",
    category: "scene",
    action: "set-property",
    summary: "Set any writable property on a target instance",
  },
  {
    route: "/bridge/scene/set-transform",
    category: "scene",
    action: "set-transform",
    summary: "Move/rotate a target object",
  },
  {
    route: "/bridge/scene/set-color",
    category: "scene",
    action: "set-color",
    summary: "Change object color",
  },
  {
    route: "/bridge/scene/set-material",
    category: "scene",
    action: "set-material",
    summary: "Change object material",
  },
  {
    route: "/bridge/scene/set-size",
    category: "scene",
    action: "set-size",
    summary: "Resize object",
  },
  {
    route: "/bridge/scene/set-anchored",
    category: "scene",
    action: "set-anchored",
    summary: "Toggle anchored state",
  },
  {
    route: "/bridge/scene/set-collidable",
    category: "scene",
    action: "set-collidable",
    summary: "Toggle can-collide state",
  },
  {
    route: "/bridge/scene/group-objects",
    category: "scene",
    action: "group-objects",
    summary: "Group objects under a model/folder",
  },
  {
    route: "/bridge/scene/duplicate-object",
    category: "scene",
    action: "duplicate-object",
    summary: "Duplicate target object",
  },
  {
    route: "/bridge/scene/delete-object",
    category: "scene",
    action: "delete-object",
    summary: "Delete target object",
  },
  {
    route: "/bridge/scene/select-object",
    category: "scene",
    action: "select-object",
    summary: "Select an object in Studio",
  },
  {
    route: "/bridge/scene/clear-selection",
    category: "scene",
    action: "clear-selection",
    summary: "Clear Studio selection",
  },
  {
    route: "/bridge/scene/rename-object",
    category: "scene",
    action: "rename-object",
    summary: "Rename target object",
  },
  {
    route: "/bridge/scene/create-folder",
    category: "scene",
    action: "create-folder",
    summary: "Create folder/model container",
  },
  {
    route: "/bridge/scene/parent-object",
    category: "scene",
    action: "parent-object",
    summary: "Reparent object",
  },
  {
    route: "/bridge/asset/import-model",
    category: "asset",
    action: "import-model",
    summary: "Queue Studio model import flow",
  },
  {
    route: "/bridge/asset/import-from-url",
    category: "asset",
    action: "import-from-url",
    summary: "Import asset from URL",
  },
  {
    route: "/bridge/asset/insert-toolbox-asset",
    category: "asset",
    action: "insert-toolbox-asset",
    summary: "Insert toolbox asset by ID",
  },
  {
    route: "/bridge/asset/insert-asset-id",
    category: "asset",
    action: "insert-asset-id",
    summary: "Insert Roblox asset by ID",
  },
  {
    route: "/bridge/asset/create-script",
    category: "asset",
    action: "create-script",
    summary: "Create Script instance",
  },
  {
    route: "/bridge/asset/create-local-script",
    category: "asset",
    action: "create-local-script",
    summary: "Create LocalScript instance",
  },
  {
    route: "/bridge/asset/create-module-script",
    category: "asset",
    action: "create-module-script",
    summary: "Create ModuleScript instance",
  },
  {
    route: "/bridge/asset/save-place",
    category: "asset",
    action: "save-place",
    summary: "Save current place file",
  },
  {
    route: "/bridge/asset/export-place",
    category: "asset",
    action: "export-place",
    summary: "Export place snapshot",
  },
  {
    route: "/bridge/asset/publish-place",
    category: "asset",
    action: "publish-place",
    summary: "Publish current place to Roblox",
  },
  {
    route: "/bridge/terrain/generate-terrain",
    category: "terrain",
    action: "generate-terrain",
    summary: "Generate base terrain block",
  },
  {
    route: "/bridge/terrain/fill-region",
    category: "terrain",
    action: "fill-region",
    summary: "Fill terrain region with material",
  },
  {
    route: "/bridge/terrain/replace-material",
    category: "terrain",
    action: "replace-material",
    summary: "Replace terrain material in region",
  },
  {
    route: "/bridge/terrain/clear-region",
    category: "terrain",
    action: "clear-region",
    summary: "Clear terrain region",
  },
  {
    route: "/bridge/environment/set-lighting",
    category: "environment",
    action: "set-lighting",
    summary: "Adjust Lighting service properties",
  },
  {
    route: "/bridge/environment/set-atmosphere",
    category: "environment",
    action: "set-atmosphere",
    summary: "Adjust Atmosphere settings",
  },
  {
    route: "/bridge/environment/set-skybox",
    category: "environment",
    action: "set-skybox",
    summary: "Apply skybox textures",
  },
  {
    route: "/bridge/environment/set-time",
    category: "environment",
    action: "set-time",
    summary: "Set ClockTime",
  },
  {
    route: "/bridge/environment/set-fog",
    category: "environment",
    action: "set-fog",
    summary: "Configure fog",
  },
  {
    route: "/bridge/script/insert-script",
    category: "script",
    action: "insert-script",
    summary: "Insert script source into object",
  },
  {
    route: "/bridge/script/insert-local-script",
    category: "script",
    action: "insert-local-script",
    summary: "Insert local script source",
  },
  {
    route: "/bridge/script/insert-module-script",
    category: "script",
    action: "insert-module-script",
    summary: "Insert module script source",
  },
  {
    route: "/bridge/script/run-command",
    category: "script",
    action: "run-command",
    summary: "Run Studio command bar command",
  },
  {
    route: "/bridge/simulation/playtest/start",
    category: "simulation",
    action: "playtest-start",
    summary: "Start Studio playtest",
  },
  {
    route: "/bridge/simulation/playtest/stop",
    category: "simulation",
    action: "playtest-stop",
    summary: "Stop Studio playtest",
  },
  {
    route: "/bridge/viewport/set-camera",
    category: "viewport",
    action: "set-camera",
    summary: "Set Studio camera",
  },
  {
    route: "/bridge/viewport/focus-selection",
    category: "viewport",
    action: "focus-selection",
    summary: "Focus camera on selection",
  },
  {
    route: "/bridge/viewport/screenshot",
    category: "viewport",
    action: "screenshot",
    summary: "Request screenshot capture workflow",
  },
  {
    route: "/bridge/viewport/render-frame",
    category: "viewport",
    action: "render-frame",
    summary: "Request frame render workflow",
  },
  {
    route: "/bridge/workspace/autosave",
    category: "workspace",
    action: "autosave",
    summary: "Autosave workspace state",
  },
  {
    route: "/bridge/introspection/scene",
    category: "introspection",
    action: "introspect-scene",
    summary: "Capture current Studio scene hierarchy snapshot",
  },
  {
    route: "/bridge/test-spawn",
    category: "test",
    action: "test-spawn",
    summary: "Spawn connectivity marker",
  },
  {
    route: "/bridge/blender/import",
    category: "blender",
    action: "import-blender",
    summary: "Queue Blender import flow",
  },
  {
    route: "/bridge/asset/import-blender",
    category: "asset",
    action: "import-blender",
    summary: "Queue Roblox-side blender import workflow",
  },
  {
    route: "/bridge/asset/import-model/upload",
    category: "asset",
    action: "import-model",
    summary: "Upload model file to bridge staging",
  },
]);

function riskForAction(action) {
  return RISK_BY_ACTION[action] || "safe";
}

const COMMAND_CATALOG = Object.freeze(
  BASE_CATALOG.map((item) => ({
    route: item.route,
    category: item.category,
    action: item.action,
    summary: item.summary,
    risk: item.risk || riskForAction(item.action),
  })),
);

const COMMAND_BY_ROUTE = new Map(
  COMMAND_CATALOG.map((item) => [item.route, item]),
);

function listCommandCatalog() {
  return COMMAND_CATALOG.map((item) => ({ ...item }));
}

function commandForRoute(route) {
  if (!route) {
    return null;
  }
  return COMMAND_BY_ROUTE.get(String(route).trim()) || null;
}

function riskRank(risk) {
  return RISK_RANK[String(risk || "safe").toLowerCase()] || RISK_RANK.safe;
}

module.exports = {
  COMMAND_CATALOG,
  listCommandCatalog,
  commandForRoute,
  riskForAction,
  riskRank,
  RISK_RANK,
};
