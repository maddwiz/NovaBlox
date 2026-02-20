"use strict";

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");

const { CommandStore } = require("./command_store");

const VERSION = "1.0.0";
const HOST = process.env.ROBLOXBRIDGE_HOST || "0.0.0.0";
const PORT = parseInt(process.env.ROBLOXBRIDGE_PORT || "30010", 10);
const API_KEY = process.env.ROBLOXBRIDGE_API_KEY || "";
const COMMAND_LEASE_MS = parseInt(process.env.ROBLOXBRIDGE_COMMAND_LEASE_MS || "120000", 10);
const MAX_RETENTION = parseInt(process.env.ROBLOXBRIDGE_MAX_RETENTION || "10000", 10);
const IMPORT_DIR = process.env.ROBLOXBRIDGE_IMPORT_DIR || path.join(os.tmpdir(), "novablox-imports");
const EXPORT_DIR = process.env.ROBLOXBRIDGE_EXPORT_DIR || path.join(os.tmpdir(), "novablox-exports");
const MAX_UPLOAD_MB = parseInt(process.env.ROBLOXBRIDGE_MAX_UPLOAD_MB || "250", 10);
const BLENDER_TO_ROBLOX_SCALE = Number.parseFloat(process.env.ROBLOXBRIDGE_BLENDER_SCALE || "3.571428");

fs.mkdirSync(IMPORT_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

const store = new CommandStore({
  leaseMs: Number.isFinite(COMMAND_LEASE_MS) ? COMMAND_LEASE_MS : 120000,
  maxRetention: Number.isFinite(MAX_RETENTION) ? MAX_RETENTION : 10000,
});

const upload = multer({
  dest: IMPORT_DIR,
  limits: {
    fileSize: Math.max(1, MAX_UPLOAD_MB) * 1024 * 1024,
  },
});

const app = express();
app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  res.setHeader("X-NovaBlox-Version", VERSION);
  next();
});

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return next();
  }
  const supplied = req.get("X-API-Key") || req.query.api_key;
  if (!supplied || supplied !== API_KEY) {
    return res.status(401).json({ status: "error", error: "invalid API key" });
  }
  return next();
}

function parseInteger(value, fallback, min, max) {
  const parsed = parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function inferClientId(req) {
  return req.query.client_id || req.get("X-Client-Id") || "roblox-studio";
}

function parseFloatSafe(value, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function queueCommand(req, res, spec, extraPayload = {}) {
  const priority = parseInteger(req.body.priority, 0, -100, 100);
  const metadata = Object.assign({}, req.body.metadata || {}, {
    requested_by: req.get("X-Request-By") || "api",
    client_hint: req.body.client_hint || null,
  });
  const payload = Object.assign({}, req.body, extraPayload);
  const command = store.enqueue({
    route: spec.path,
    category: spec.category,
    action: spec.action,
    payload,
    priority,
    metadata,
  });
  res.json({
    status: "queued",
    command_id: command.id,
    category: command.category,
    action: command.action,
    route: command.route,
    queued_at: command.created_at,
  });
}

const commandRoutes = [
  { path: "/bridge/scene/spawn-object", category: "scene", action: "spawn-object" },
  { path: "/bridge/scene/set-property", category: "scene", action: "set-property" },
  { path: "/bridge/scene/set-transform", category: "scene", action: "set-transform" },
  { path: "/bridge/scene/set-color", category: "scene", action: "set-color" },
  { path: "/bridge/scene/set-material", category: "scene", action: "set-material" },
  { path: "/bridge/scene/set-size", category: "scene", action: "set-size" },
  { path: "/bridge/scene/set-anchored", category: "scene", action: "set-anchored" },
  { path: "/bridge/scene/set-collidable", category: "scene", action: "set-collidable" },
  { path: "/bridge/scene/group-objects", category: "scene", action: "group-objects" },
  { path: "/bridge/scene/duplicate-object", category: "scene", action: "duplicate-object" },
  { path: "/bridge/scene/delete-object", category: "scene", action: "delete-object" },
  { path: "/bridge/scene/select-object", category: "scene", action: "select-object" },
  { path: "/bridge/scene/clear-selection", category: "scene", action: "clear-selection" },
  { path: "/bridge/scene/rename-object", category: "scene", action: "rename-object" },
  { path: "/bridge/scene/create-folder", category: "scene", action: "create-folder" },
  { path: "/bridge/scene/parent-object", category: "scene", action: "parent-object" },
  { path: "/bridge/asset/import-model", category: "asset", action: "import-model" },
  { path: "/bridge/asset/import-from-url", category: "asset", action: "import-from-url" },
  { path: "/bridge/asset/insert-toolbox-asset", category: "asset", action: "insert-toolbox-asset" },
  { path: "/bridge/asset/insert-asset-id", category: "asset", action: "insert-asset-id" },
  { path: "/bridge/asset/create-script", category: "asset", action: "create-script" },
  { path: "/bridge/asset/create-local-script", category: "asset", action: "create-local-script" },
  { path: "/bridge/asset/create-module-script", category: "asset", action: "create-module-script" },
  { path: "/bridge/asset/save-place", category: "asset", action: "save-place" },
  { path: "/bridge/asset/export-place", category: "asset", action: "export-place" },
  { path: "/bridge/asset/publish-place", category: "asset", action: "publish-place" },
  { path: "/bridge/terrain/generate-terrain", category: "terrain", action: "generate-terrain" },
  { path: "/bridge/terrain/fill-region", category: "terrain", action: "fill-region" },
  { path: "/bridge/terrain/replace-material", category: "terrain", action: "replace-material" },
  { path: "/bridge/terrain/clear-region", category: "terrain", action: "clear-region" },
  { path: "/bridge/environment/set-lighting", category: "environment", action: "set-lighting" },
  { path: "/bridge/environment/set-atmosphere", category: "environment", action: "set-atmosphere" },
  { path: "/bridge/environment/set-skybox", category: "environment", action: "set-skybox" },
  { path: "/bridge/environment/set-time", category: "environment", action: "set-time" },
  { path: "/bridge/environment/set-fog", category: "environment", action: "set-fog" },
  { path: "/bridge/script/insert-script", category: "script", action: "insert-script" },
  { path: "/bridge/script/insert-local-script", category: "script", action: "insert-local-script" },
  { path: "/bridge/script/insert-module-script", category: "script", action: "insert-module-script" },
  { path: "/bridge/script/run-command", category: "script", action: "run-command" },
  { path: "/bridge/simulation/playtest/start", category: "simulation", action: "playtest-start" },
  { path: "/bridge/simulation/playtest/stop", category: "simulation", action: "playtest-stop" },
  { path: "/bridge/viewport/set-camera", category: "viewport", action: "set-camera" },
  { path: "/bridge/viewport/focus-selection", category: "viewport", action: "focus-selection" },
  { path: "/bridge/viewport/screenshot", category: "viewport", action: "screenshot" },
  { path: "/bridge/viewport/render-frame", category: "viewport", action: "render-frame" },
  { path: "/bridge/workspace/autosave", category: "workspace", action: "autosave" },
  { path: "/bridge/test-spawn", category: "test", action: "test-spawn" },
];

app.get("/bridge/health", (_req, res) => {
  res.json({
    status: "ok",
    product: "NovaBlox",
    service: "RobloxStudioBridge",
    version: VERSION,
    queue: store.summary(),
    import_dir: IMPORT_DIR,
    export_dir: EXPORT_DIR,
    api_key_enabled: Boolean(API_KEY),
  });
});

app.get("/bridge/stats", requireApiKey, (_req, res) => {
  res.json({ status: "ok", stats: store.summary() });
});

app.get("/bridge/commands/recent", requireApiKey, (req, res) => {
  const limit = parseInteger(req.query.limit, 50, 1, 500);
  res.json({ status: "ok", commands: store.listRecent(limit) });
});

app.get("/bridge/commands/:id", requireApiKey, (req, res) => {
  const command = store.get(req.params.id);
  if (!command) {
    return res.status(404).json({ status: "error", error: "not found" });
  }
  return res.json({ status: "ok", command });
});

app.post("/bridge/command", requireApiKey, (req, res) => {
  const { route, category, action, payload } = req.body || {};
  if (!route || !action) {
    return res.status(400).json({ status: "error", error: "route and action are required" });
  }
  const command = store.enqueue({
    route,
    category: category || "custom",
    action,
    payload: payload || req.body.payload || {},
    priority: parseInteger(req.body.priority, 0, -100, 100),
    metadata: req.body.metadata || {},
  });
  return res.json({ status: "queued", command_id: command.id, command });
});

app.post("/bridge/commands/batch", requireApiKey, (req, res) => {
  const commands = Array.isArray(req.body.commands) ? req.body.commands : [];
  if (commands.length === 0) {
    return res.status(400).json({ status: "error", error: "commands[] is required" });
  }
  const queued = store.enqueueBatch(
    commands.map((cmd) => ({
      route: cmd.route || "/bridge/custom",
      category: cmd.category || "custom",
      action: cmd.action || "command",
      payload: cmd.payload || {},
      priority: parseInteger(cmd.priority, 0, -100, 100),
      metadata: cmd.metadata || {},
    }))
  );
  return res.json({
    status: "queued",
    count: queued.length,
    command_ids: queued.map((cmd) => cmd.id),
  });
});

app.get("/bridge/commands", requireApiKey, (req, res) => {
  const clientId = inferClientId(req);
  const limit = parseInteger(req.query.limit, 20, 1, 100);
  const commands = store.dispatch(clientId, limit);
  res.json({
    status: "ok",
    client_id: clientId,
    count: commands.length,
    commands,
  });
});

app.post("/bridge/results", requireApiKey, (req, res) => {
  const result = store.result(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ status: "error", error: result.error });
  }
  return res.json({
    status: "ok",
    command_id: result.command.id,
    command_status: result.command.status,
    updated_at: result.command.updated_at,
  });
});

app.post("/bridge/commands/:id/requeue", requireApiKey, (req, res) => {
  const result = store.requeue(req.params.id);
  if (!result.ok) {
    return res.status(400).json({ status: "error", error: result.error });
  }
  return res.json({ status: "ok", command: result.command });
});

app.post("/bridge/commands/:id/cancel", requireApiKey, (req, res) => {
  const result = store.cancel(req.params.id);
  if (!result.ok) {
    return res.status(400).json({ status: "error", error: result.error });
  }
  return res.json({ status: "ok", command: result.command });
});

app.get("/bridge/stream", requireApiKey, (req, res) => {
  const clientId = inferClientId(req);
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write("event: connected\n");
  res.write(`data: ${JSON.stringify({ client_id: clientId, ts: new Date().toISOString() })}\n\n`);

  store.addSseClient(clientId, res);

  const keepAlive = setInterval(() => {
    try {
      res.write("event: heartbeat\n");
      res.write(`data: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
    } catch (_err) {
      clearInterval(keepAlive);
      store.removeSseClient(res);
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    store.removeSseClient(res);
  });
});

commandRoutes.forEach((spec) => {
  app.post(spec.path, requireApiKey, (req, res) => queueCommand(req, res, spec));
});

app.post("/bridge/blender/import", requireApiKey, upload.single("file"), (req, res) => {
  let localPath = req.body.file_path || null;
  if (req.file && req.file.path) {
    const extension = path.extname(req.file.originalname || "").toLowerCase();
    const safeName = `${req.file.filename}${extension}`;
    const finalPath = path.join(IMPORT_DIR, safeName);
    fs.renameSync(req.file.path, finalPath);
    localPath = finalPath;
  }

  if (!localPath) {
    return res.status(400).json({ status: "error", error: "Provide multipart file upload or file_path" });
  }

  const scaleFix = req.body.scale_fix || "blender_to_roblox";
  const rawScale = req.body.scale_factor !== undefined ? req.body.scale_factor : req.body.scale;
  const scaleFactor = parseFloatSafe(rawScale, scaleFix === "blender_to_roblox" ? BLENDER_TO_ROBLOX_SCALE : 1.0);

  return queueCommand(
    req,
    res,
    { path: "/bridge/blender/import", category: "blender", action: "import-blender" },
    {
      file_path: localPath,
      scale_fix: scaleFix,
      scale_factor: scaleFactor,
      recommended_blender_to_roblox_scale: BLENDER_TO_ROBLOX_SCALE,
    }
  );
});

app.post("/bridge/asset/import-blender", requireApiKey, upload.single("file"), (req, res) => {
  const scaleFix = req.body.scale_fix || "blender_to_roblox";
  const rawScale = req.body.scale_factor !== undefined ? req.body.scale_factor : req.body.scale;
  const scaleFactor = parseFloatSafe(rawScale, scaleFix === "blender_to_roblox" ? BLENDER_TO_ROBLOX_SCALE : 1.0);
  const assetId = req.body.asset_id !== undefined ? Number.parseInt(req.body.asset_id, 10) : null;

  let localPath = req.body.file_path || null;
  let originalName = null;
  if (req.file && req.file.path) {
    const extension = path.extname(req.file.originalname || "").toLowerCase();
    const safeName = `${req.file.filename}${extension}`;
    const finalPath = path.join(IMPORT_DIR, safeName);
    fs.renameSync(req.file.path, finalPath);
    localPath = finalPath;
    originalName = req.file.originalname || null;
  }

  if (!localPath && !Number.isFinite(assetId)) {
    return res.status(400).json({
      status: "error",
      error: "Provide multipart file upload, file_path, or asset_id",
    });
  }

  return queueCommand(
    req,
    res,
    { path: "/bridge/asset/import-blender", category: "asset", action: "import-blender" },
    {
      file_path: localPath,
      asset_id: Number.isFinite(assetId) ? assetId : undefined,
      original_name: originalName,
      scale_fix: scaleFix,
      scale_factor: scaleFactor,
      recommended_blender_to_roblox_scale: BLENDER_TO_ROBLOX_SCALE,
    }
  );
});

app.post("/bridge/asset/import-model/upload", requireApiKey, upload.single("file"), (req, res) => {
  if (!req.file || !req.file.path) {
    return res.status(400).json({ status: "error", error: "multipart file is required" });
  }
  const extension = path.extname(req.file.originalname || "").toLowerCase();
  const safeName = `${req.file.filename}${extension}`;
  const finalPath = path.join(IMPORT_DIR, safeName);
  fs.renameSync(req.file.path, finalPath);

  return queueCommand(
    req,
    res,
    { path: "/bridge/asset/import-model/upload", category: "asset", action: "import-model" },
    { file_path: finalPath, original_name: req.file.originalname }
  );
});

app.post("/bridge/asset/upload-result", requireApiKey, upload.single("file"), (req, res) => {
  if (!req.file || !req.file.path) {
    return res.status(400).json({ status: "error", error: "multipart file is required" });
  }
  const extension = path.extname(req.file.originalname || "").toLowerCase();
  const safeName = `${req.file.filename}${extension}`;
  const finalPath = path.join(EXPORT_DIR, safeName);
  fs.renameSync(req.file.path, finalPath);
  return res.json({
    status: "ok",
    path: finalPath,
    original_name: req.file.originalname,
    bytes: req.file.size,
  });
});

app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ status: "error", error: "upload too large" });
  }
  return res.status(500).json({ status: "error", error: err ? err.message : "unknown error" });
});

const heartbeatInterval = setInterval(() => {
  store.broadcastHeartbeat();
}, 30000);

process.on("SIGINT", () => {
  clearInterval(heartbeatInterval);
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearInterval(heartbeatInterval);
  process.exit(0);
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[NovaBlox] RobloxStudioBridge listening on http://${HOST}:${PORT}`);
});
