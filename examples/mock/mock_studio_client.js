"use strict";

const http = require("http");

const BRIDGE_HOST = process.env.ROBLOXBRIDGE_HOST || "localhost";
const BRIDGE_PORT = parseInt(process.env.ROBLOXBRIDGE_PORT || "30010", 10);
const API_KEY = process.env.ROBLOXBRIDGE_API_KEY || "";
const CLIENT_ID = process.env.MOCK_CLIENT_ID || "mock-studio";
const POLL_MS = parseInt(process.env.MOCK_POLL_MS || "1000", 10);
const RUN_SECONDS = parseInt(process.env.MOCK_RUN_SECONDS || "0", 10);

const WORLD = {
  objects: new Map(),
  lighting: {
    brightness: 1,
    exposure_compensation: 0,
    ambient: [0, 0, 0],
    fog_start: 0,
    fog_end: 100000,
    fog_color: [1, 1, 1],
    clock_time: 14,
  },
  scripts: [],
  terrainOps: [],
};

function req(method, route, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const headers = { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID };
    if (API_KEY) {
      headers["X-API-Key"] = API_KEY;
    }
    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const request = http.request(
      {
        hostname: BRIDGE_HOST,
        port: BRIDGE_PORT,
        path: route,
        method,
        headers,
        timeout: 20000,
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          if (!data) {
            resolve({ status: "ok" });
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (_err) {
            resolve({ raw: data, statusCode: response.statusCode });
          }
        });
      }
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error("request timed out"));
    });
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function findByName(name) {
  if (!name) {
    return null;
  }
  return WORLD.objects.get(name) || null;
}

function upsertObject(name, patch) {
  const current = WORLD.objects.get(name) || {
    name,
    class_name: "Part",
    position: [0, 0, 0],
    size: [4, 1, 2],
    color: "Medium stone grey",
    anchored: false,
    can_collide: true,
    material: "Plastic",
    properties: {},
  };
  const next = Object.assign({}, current, patch);
  WORLD.objects.set(name, next);
  return next;
}

function execute(command) {
  const action = command.action;
  const payload = command.payload || {};
  if (action === "spawn-object") {
    const name = payload.name || `Object_${WORLD.objects.size + 1}`;
    const created = upsertObject(name, {
      class_name: payload.class_name || payload.object_type || "Part",
      position: payload.position || [0, 5, 0],
      size: payload.size || [4, 1, 2],
      color: payload.color || "Medium stone grey",
      anchored: payload.anchored === true,
      can_collide: payload.can_collide !== false,
      material: payload.material || "Plastic",
    });
    return { created };
  }

  if (action === "set-property") {
    const targetName = payload.target_name || payload.name;
    const target = findByName(targetName);
    if (!target) {
      throw new Error(`target not found: ${targetName}`);
    }
    const properties = Object.assign({}, target.properties, {
      [payload.property]: payload.value,
    });
    upsertObject(target.name, { properties });
    return { target: target.name, property: payload.property };
  }

  if (action === "set-transform") {
    const targetName = payload.target_name || payload.name;
    const target = findByName(targetName);
    if (!target) {
      throw new Error(`target not found: ${targetName}`);
    }
    const patch = {};
    if (Array.isArray(payload.position)) {
      patch.position = payload.position;
    }
    if (Array.isArray(payload.size)) {
      patch.size = payload.size;
    }
    if (Array.isArray(payload.rotation)) {
      patch.rotation = payload.rotation;
    }
    const updated = upsertObject(target.name, patch);
    return { updated };
  }

  if (action === "set-color") {
    const targetName = payload.target_name || payload.name;
    const target = findByName(targetName);
    if (!target) {
      throw new Error(`target not found: ${targetName}`);
    }
    const updated = upsertObject(target.name, { color: payload.color || target.color });
    return { updated };
  }

  if (action === "set-size") {
    const targetName = payload.target_name || payload.name;
    const target = findByName(targetName);
    if (!target) {
      throw new Error(`target not found: ${targetName}`);
    }
    const updated = upsertObject(target.name, { size: payload.size || target.size });
    return { updated };
  }

  if (action === "set-anchored") {
    const targetName = payload.target_name || payload.name;
    const target = findByName(targetName);
    if (!target) {
      throw new Error(`target not found: ${targetName}`);
    }
    const updated = upsertObject(target.name, { anchored: payload.anchored === true });
    return { updated };
  }

  if (action === "set-collidable") {
    const targetName = payload.target_name || payload.name;
    const target = findByName(targetName);
    if (!target) {
      throw new Error(`target not found: ${targetName}`);
    }
    const updated = upsertObject(target.name, { can_collide: payload.can_collide !== false });
    return { updated };
  }

  if (action === "duplicate-object") {
    const source = findByName(payload.target_name || payload.name);
    if (!source) {
      throw new Error("source target not found");
    }
    const cloneName = payload.new_name || `${source.name}_Copy`;
    const created = upsertObject(cloneName, Object.assign({}, source, { name: cloneName }));
    return { clone: created };
  }

  if (action === "delete-object") {
    const targetName = payload.target_name || payload.name;
    if (!WORLD.objects.delete(targetName)) {
      throw new Error(`target not found: ${targetName}`);
    }
    return { deleted: targetName };
  }

  if (action === "rename-object") {
    const source = findByName(payload.target_name || payload.name);
    if (!source) {
      throw new Error("target not found");
    }
    const newName = payload.new_name;
    if (!newName) {
      throw new Error("new_name is required");
    }
    WORLD.objects.delete(source.name);
    WORLD.objects.set(newName, Object.assign({}, source, { name: newName }));
    return { from: source.name, to: newName };
  }

  if (action === "generate-terrain" || action === "fill-region" || action === "replace-material" || action === "clear-region") {
    WORLD.terrainOps.push({
      action,
      at: new Date().toISOString(),
      payload,
    });
    return { terrain_ops: WORLD.terrainOps.length };
  }

  if (action === "set-lighting" || action === "set-atmosphere" || action === "set-skybox" || action === "set-time" || action === "set-fog") {
    Object.assign(WORLD.lighting, payload);
    return { lighting: WORLD.lighting };
  }

  if (action === "insert-script" || action === "insert-local-script" || action === "insert-module-script" || action === "create-script" || action === "create-local-script" || action === "create-module-script") {
    const scriptRecord = {
      action,
      name: payload.name || "Script",
      source_len: String(payload.source || "").length,
      at: new Date().toISOString(),
    };
    WORLD.scripts.push(scriptRecord);
    return { script: scriptRecord };
  }

  if (action === "playtest-start" || action === "playtest-stop" || action === "set-camera" || action === "focus-selection" || action === "screenshot" || action === "render-frame" || action === "publish-place" || action === "save-place" || action === "export-place" || action === "autosave" || action === "import-model" || action === "import-from-url" || action === "import") {
    return { accepted: true, action };
  }

  return { accepted: false, action, message: "No mock behavior implemented; acknowledged." };
}

async function report(commandId, ok, result, error) {
  await req("POST", "/bridge/results", {
    command_id: commandId,
    ok,
    status: ok ? "ok" : "error",
    result: result || null,
    error: error || null,
    client_id: CLIENT_ID,
    mock: true,
  });
}

async function pollOnce() {
  const data = await req("GET", `/bridge/commands?client_id=${encodeURIComponent(CLIENT_ID)}&limit=20`);
  const commands = Array.isArray(data.commands) ? data.commands : [];
  if (commands.length === 0) {
    return 0;
  }
  for (const command of commands) {
    try {
      const result = execute(command);
      await report(command.id, true, result, null);
      process.stdout.write(`[mock] ok ${command.id} ${command.action}\n`);
    } catch (err) {
      await report(command.id, false, null, err.message);
      process.stdout.write(`[mock] err ${command.id} ${command.action}: ${err.message}\n`);
    }
  }
  return commands.length;
}

async function main() {
  const startedAt = Date.now();
  process.stdout.write(`[mock] starting client=${CLIENT_ID} bridge=${BRIDGE_HOST}:${BRIDGE_PORT}\n`);
  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      process.stderr.write(`[mock] poll error: ${err.message}\n`);
    }
    if (RUN_SECONDS > 0 && Date.now() - startedAt >= RUN_SECONDS * 1000) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(100, POLL_MS)));
  }
  process.stdout.write(`[mock] exiting objects=${WORLD.objects.size} scripts=${WORLD.scripts.length} terrain_ops=${WORLD.terrainOps.length}\n`);
}

main().catch((err) => {
  process.stderr.write(`[mock] fatal: ${err.message}\n`);
  process.exit(1);
});
