"use strict";

const http = require("http");
const { Type } = require("@sinclair/typebox");

const BRIDGE_PORT = parseInt(process.env.ROBLOXBRIDGE_PORT || "30010", 10);
const BRIDGE_HOST = process.env.ROBLOXBRIDGE_HOST || "localhost";
const BRIDGE_API_KEY = process.env.ROBLOXBRIDGE_API_KEY || "";

function request(method, route, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const headers = { "Content-Type": "application/json" };
    if (BRIDGE_API_KEY) {
      headers["X-API-Key"] = BRIDGE_API_KEY;
    }
    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = http.request(
      {
        hostname: BRIDGE_HOST,
        port: BRIDGE_PORT,
        path: route,
        method,
        headers,
        timeout: 30000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (!data) {
            resolve({ status: "ok" });
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (_err) {
            resolve({ status: "ok", raw: data });
          }
        });
      },
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("request timed out"));
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function wrapped(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

async function run(method, route, payload) {
  try {
    const response = await request(method, route, payload);
    return wrapped(response);
  } catch (err) {
    return wrapped({ status: "error", error: err.message });
  }
}

const POST_ROUTE_TOOLS = [
  [
    "roblox_scene_spawn_object",
    "Scene Spawn Object",
    "/bridge/scene/spawn-object",
    "Queue a scene spawn-object command.",
  ],
  [
    "roblox_scene_set_property",
    "Scene Set Property",
    "/bridge/scene/set-property",
    "Queue a scene set-property command.",
  ],
  [
    "roblox_scene_set_transform",
    "Scene Set Transform",
    "/bridge/scene/set-transform",
    "Queue a scene set-transform command.",
  ],
  [
    "roblox_scene_set_color",
    "Scene Set Color",
    "/bridge/scene/set-color",
    "Queue a scene set-color command.",
  ],
  [
    "roblox_scene_set_material",
    "Scene Set Material",
    "/bridge/scene/set-material",
    "Queue a scene set-material command.",
  ],
  [
    "roblox_scene_set_size",
    "Scene Set Size",
    "/bridge/scene/set-size",
    "Queue a scene set-size command.",
  ],
  [
    "roblox_scene_set_anchored",
    "Scene Set Anchored",
    "/bridge/scene/set-anchored",
    "Queue a scene set-anchored command.",
  ],
  [
    "roblox_scene_set_collidable",
    "Scene Set Collidable",
    "/bridge/scene/set-collidable",
    "Queue a scene set-collidable command.",
  ],
  [
    "roblox_scene_group_objects",
    "Scene Group Objects",
    "/bridge/scene/group-objects",
    "Queue a scene group-objects command.",
  ],
  [
    "roblox_scene_duplicate_object",
    "Scene Duplicate Object",
    "/bridge/scene/duplicate-object",
    "Queue a scene duplicate-object command.",
  ],
  [
    "roblox_scene_delete_object",
    "Scene Delete Object",
    "/bridge/scene/delete-object",
    "Queue a scene delete-object command.",
  ],
  [
    "roblox_scene_select_object",
    "Scene Select Object",
    "/bridge/scene/select-object",
    "Queue a scene select-object command.",
  ],
  [
    "roblox_scene_clear_selection",
    "Scene Clear Selection",
    "/bridge/scene/clear-selection",
    "Queue a scene clear-selection command.",
  ],
  [
    "roblox_scene_rename_object",
    "Scene Rename Object",
    "/bridge/scene/rename-object",
    "Queue a scene rename-object command.",
  ],
  [
    "roblox_scene_create_folder",
    "Scene Create Folder",
    "/bridge/scene/create-folder",
    "Queue a scene create-folder command.",
  ],
  [
    "roblox_scene_parent_object",
    "Scene Parent Object",
    "/bridge/scene/parent-object",
    "Queue a scene parent-object command.",
  ],
  [
    "roblox_asset_import_model",
    "Asset Import Model",
    "/bridge/asset/import-model",
    "Queue an asset import-model command.",
  ],
  [
    "roblox_asset_import_blender",
    "Asset Import Blender",
    "/bridge/asset/import-blender",
    "Queue an asset import-blender command with optional scale fix.",
  ],
  [
    "roblox_asset_import_from_url",
    "Asset Import URL",
    "/bridge/asset/import-from-url",
    "Queue an asset import-from-url command.",
  ],
  [
    "roblox_asset_insert_toolbox_asset",
    "Asset Insert Toolbox",
    "/bridge/asset/insert-toolbox-asset",
    "Queue an asset insert-toolbox-asset command.",
  ],
  [
    "roblox_asset_insert_asset_id",
    "Asset Insert ID",
    "/bridge/asset/insert-asset-id",
    "Queue an asset insert-asset-id command.",
  ],
  [
    "roblox_asset_create_script",
    "Asset Create Script",
    "/bridge/asset/create-script",
    "Queue an asset create-script command.",
  ],
  [
    "roblox_asset_create_local_script",
    "Asset Create Local Script",
    "/bridge/asset/create-local-script",
    "Queue an asset create-local-script command.",
  ],
  [
    "roblox_asset_create_module_script",
    "Asset Create Module Script",
    "/bridge/asset/create-module-script",
    "Queue an asset create-module-script command.",
  ],
  [
    "roblox_asset_save_place",
    "Asset Save Place",
    "/bridge/asset/save-place",
    "Queue an asset save-place command.",
  ],
  [
    "roblox_asset_export_place",
    "Asset Export Place",
    "/bridge/asset/export-place",
    "Queue an asset export-place command.",
  ],
  [
    "roblox_asset_publish_place",
    "Asset Publish Place",
    "/bridge/asset/publish-place",
    "Queue an asset publish-place command.",
  ],
  [
    "roblox_terrain_generate",
    "Terrain Generate",
    "/bridge/terrain/generate-terrain",
    "Queue a terrain generate-terrain command.",
  ],
  [
    "roblox_terrain_fill_region",
    "Terrain Fill Region",
    "/bridge/terrain/fill-region",
    "Queue a terrain fill-region command.",
  ],
  [
    "roblox_terrain_replace_material",
    "Terrain Replace Material",
    "/bridge/terrain/replace-material",
    "Queue a terrain replace-material command.",
  ],
  [
    "roblox_terrain_clear_region",
    "Terrain Clear Region",
    "/bridge/terrain/clear-region",
    "Queue a terrain clear-region command.",
  ],
  [
    "roblox_environment_set_lighting",
    "Environment Set Lighting",
    "/bridge/environment/set-lighting",
    "Queue an environment set-lighting command.",
  ],
  [
    "roblox_environment_set_atmosphere",
    "Environment Set Atmosphere",
    "/bridge/environment/set-atmosphere",
    "Queue an environment set-atmosphere command.",
  ],
  [
    "roblox_environment_set_skybox",
    "Environment Set Skybox",
    "/bridge/environment/set-skybox",
    "Queue an environment set-skybox command.",
  ],
  [
    "roblox_environment_set_time",
    "Environment Set Time",
    "/bridge/environment/set-time",
    "Queue an environment set-time command.",
  ],
  [
    "roblox_environment_set_fog",
    "Environment Set Fog",
    "/bridge/environment/set-fog",
    "Queue an environment set-fog command.",
  ],
  [
    "roblox_script_insert_script",
    "Script Insert Script",
    "/bridge/script/insert-script",
    "Queue a script insert-script command.",
  ],
  [
    "roblox_script_insert_local_script",
    "Script Insert Local Script",
    "/bridge/script/insert-local-script",
    "Queue a script insert-local-script command.",
  ],
  [
    "roblox_script_insert_module_script",
    "Script Insert Module Script",
    "/bridge/script/insert-module-script",
    "Queue a script insert-module-script command.",
  ],
  [
    "roblox_script_run_command",
    "Script Run Command",
    "/bridge/script/run-command",
    "Queue a script run-command command.",
  ],
  [
    "roblox_simulation_playtest_start",
    "Playtest Start",
    "/bridge/simulation/playtest/start",
    "Queue simulation playtest-start command.",
  ],
  [
    "roblox_simulation_playtest_stop",
    "Playtest Stop",
    "/bridge/simulation/playtest/stop",
    "Queue simulation playtest-stop command.",
  ],
  [
    "roblox_viewport_set_camera",
    "Viewport Set Camera",
    "/bridge/viewport/set-camera",
    "Queue viewport set-camera command.",
  ],
  [
    "roblox_viewport_focus_selection",
    "Viewport Focus Selection",
    "/bridge/viewport/focus-selection",
    "Queue viewport focus-selection command.",
  ],
  [
    "roblox_viewport_screenshot",
    "Viewport Screenshot",
    "/bridge/viewport/screenshot",
    "Queue viewport screenshot command.",
  ],
  [
    "roblox_viewport_render_frame",
    "Viewport Render Frame",
    "/bridge/viewport/render-frame",
    "Queue viewport render-frame command.",
  ],
  [
    "roblox_workspace_autosave",
    "Workspace Autosave",
    "/bridge/workspace/autosave",
    "Queue workspace autosave command.",
  ],
  [
    "roblox_test_spawn",
    "Bridge Test Spawn",
    "/bridge/test-spawn",
    "Queue a test-spawn command to verify plugin connectivity in Studio.",
  ],
  [
    "roblox_blender_import",
    "Blender Import",
    "/bridge/blender/import",
    "Queue blender import by file_path.",
  ],
];

const QUEUE_PARAMS = Type.Object({
  priority: Type.Optional(
    Type.Number({ description: "Queue priority (-100 to 100)." }),
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
  payload: Type.Optional(Type.Record(Type.String(), Type.Any())),
  idempotency_key: Type.Optional(
    Type.String({ description: "Optional dedupe key for retried tool calls." }),
  ),
  expires_in_ms: Type.Optional(
    Type.Number({ description: "Optional relative expiry in milliseconds." }),
  ),
  expires_at: Type.Optional(
    Type.String({ description: "Optional absolute expiry ISO timestamp." }),
  ),
});

module.exports = {
  id: "novablox-roblox-bridge",
  name: "NovaBlox Roblox Bridge",
  description: "Queue Roblox Studio commands through NovaBlox bridge",

  register(api) {
    api.registerTool({
      name: "roblox_health",
      label: "Roblox Bridge Health",
      description: "Check NovaBlox server health and queue status.",
      parameters: Type.Object({}),
      async execute() {
        return run("GET", "/bridge/health");
      },
    });

    api.registerTool({
      name: "roblox_stats",
      label: "Roblox Bridge Stats",
      description: "Get queue stats and counters.",
      parameters: Type.Object({}),
      async execute() {
        return run("GET", "/bridge/stats");
      },
    });

    api.registerTool({
      name: "roblox_commands_recent",
      label: "Recent Commands",
      description: "Get recent commands from bridge history.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
      }),
      async execute(_id, params) {
        const limit = Math.max(1, Math.min(500, Number(params.limit || 50)));
        return run("GET", `/bridge/commands/recent?limit=${limit}`);
      },
    });

    api.registerTool({
      name: "roblox_command_status",
      label: "Command Status",
      description: "Get status of a command by command_id.",
      parameters: Type.Object({
        command_id: Type.String(),
      }),
      async execute(_id, params) {
        return run(
          "GET",
          `/bridge/commands/${encodeURIComponent(params.command_id)}`,
        );
      },
    });

    api.registerTool({
      name: "roblox_requeue_command",
      label: "Requeue Command",
      description: "Requeue a command by command_id.",
      parameters: Type.Object({
        command_id: Type.String(),
      }),
      async execute(_id, params) {
        return run(
          "POST",
          `/bridge/commands/${encodeURIComponent(params.command_id)}/requeue`,
          {},
        );
      },
    });

    api.registerTool({
      name: "roblox_cancel_command",
      label: "Cancel Command",
      description: "Cancel a queued/dispatched command by command_id.",
      parameters: Type.Object({
        command_id: Type.String(),
      }),
      async execute(_id, params) {
        return run(
          "POST",
          `/bridge/commands/${encodeURIComponent(params.command_id)}/cancel`,
          {},
        );
      },
    });

    api.registerTool({
      name: "roblox_queue_custom",
      label: "Queue Custom Command",
      description: "Queue a custom route/action command.",
      parameters: Type.Object({
        route: Type.String(),
        action: Type.String(),
        category: Type.Optional(Type.String()),
        priority: Type.Optional(Type.Number()),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
        payload: Type.Optional(Type.Record(Type.String(), Type.Any())),
      }),
      async execute(_id, params) {
        return run("POST", "/bridge/command", {
          route: params.route,
          action: params.action,
          category: params.category || "custom",
          priority: params.priority,
          metadata: params.metadata,
          payload: params.payload || {},
        });
      },
    });

    POST_ROUTE_TOOLS.forEach(([name, label, route, description]) => {
      api.registerTool({
        name,
        label,
        description,
        parameters: QUEUE_PARAMS,
        async execute(_id, params) {
          const body = Object.assign({}, params.payload || {});
          if (params.priority !== undefined) {
            body.priority = params.priority;
          }
          if (params.metadata !== undefined) {
            body.metadata = params.metadata;
          }
          if (params.idempotency_key !== undefined) {
            body.idempotency_key = params.idempotency_key;
          }
          if (params.expires_in_ms !== undefined) {
            body.expires_in_ms = params.expires_in_ms;
          }
          if (params.expires_at !== undefined) {
            body.expires_at = params.expires_at;
          }
          return run("POST", route, body);
        },
      });
    });
  },
};
