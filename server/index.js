"use strict";

require("dotenv").config();

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");

const { CommandStore } = require("./command_store");
const { FixedWindowRateLimiter } = require("./rate_limiter");
const {
  buildPlanWithAssistant,
  normalizeExternalPlan,
  queuePlan,
  listTemplates,
  listCommandCatalog,
} = require("./assistant_engine");

const VERSION = "1.1.0";
const HOST = process.env.ROBLOXBRIDGE_HOST || "127.0.0.1";
const PORT = parseInt(process.env.ROBLOXBRIDGE_PORT || "30010", 10);
const API_KEY = process.env.ROBLOXBRIDGE_API_KEY || "";
const API_KEYS_ENV = process.env.ROBLOXBRIDGE_API_KEYS || "";
const COMMAND_LEASE_MS = parseInt(
  process.env.ROBLOXBRIDGE_COMMAND_LEASE_MS || "120000",
  10,
);
const MAX_RETENTION = parseInt(
  process.env.ROBLOXBRIDGE_MAX_RETENTION || "10000",
  10,
);
const IMPORT_DIR =
  process.env.ROBLOXBRIDGE_IMPORT_DIR ||
  path.join(os.tmpdir(), "novablox-imports");
const EXPORT_DIR =
  process.env.ROBLOXBRIDGE_EXPORT_DIR ||
  path.join(os.tmpdir(), "novablox-exports");
const MAX_UPLOAD_MB = parseInt(
  process.env.ROBLOXBRIDGE_MAX_UPLOAD_MB || "250",
  10,
);
const RATE_LIMIT_WINDOW_MS_RAW = parseInt(
  process.env.ROBLOXBRIDGE_RATE_LIMIT_WINDOW_MS || "60000",
  10,
);
const RATE_LIMIT_MAX_RAW = parseInt(
  process.env.ROBLOXBRIDGE_RATE_LIMIT_MAX || "600",
  10,
);
const RATE_LIMIT_EXEMPT_LOCAL =
  String(process.env.ROBLOXBRIDGE_RATE_LIMIT_EXEMPT_LOCAL || "true")
    .trim()
    .toLowerCase() === "true";
const TRUST_PROXY =
  String(process.env.ROBLOXBRIDGE_TRUST_PROXY || "false")
    .trim()
    .toLowerCase() === "true";
const ALLOW_UNAUTHENTICATED_REMOTE =
  String(process.env.ROBLOXBRIDGE_ALLOW_UNAUTHENTICATED_REMOTE || "false")
    .trim()
    .toLowerCase() === "true";
const BLENDER_TO_ROBLOX_SCALE = Number.parseFloat(
  process.env.ROBLOXBRIDGE_BLENDER_SCALE || "3.571428",
);
const MAX_EXPIRES_IN_MS_RAW = parseInt(
  process.env.ROBLOXBRIDGE_MAX_EXPIRES_IN_MS || String(7 * 24 * 60 * 60 * 1000),
  10,
);
const MAX_EXPIRES_IN_MS =
  Number.isFinite(MAX_EXPIRES_IN_MS_RAW) && MAX_EXPIRES_IN_MS_RAW > 0
    ? MAX_EXPIRES_IN_MS_RAW
    : 7 * 24 * 60 * 60 * 1000;
const QUEUE_SNAPSHOT_PATH_ENV = process.env.ROBLOXBRIDGE_QUEUE_SNAPSHOT_PATH;
const DEFAULT_QUEUE_SNAPSHOT_PATH = path.join(
  os.homedir(),
  ".novablox",
  "queue-snapshot.json",
);
const QUEUE_SNAPSHOT_PATH =
  QUEUE_SNAPSHOT_PATH_ENV === undefined
    ? DEFAULT_QUEUE_SNAPSHOT_PATH
    : String(QUEUE_SNAPSHOT_PATH_ENV || "").trim();
const RATE_LIMIT_WINDOW_MS =
  Number.isFinite(RATE_LIMIT_WINDOW_MS_RAW) && RATE_LIMIT_WINDOW_MS_RAW > 0
    ? RATE_LIMIT_WINDOW_MS_RAW
    : 60_000;
const RATE_LIMIT_MAX =
  Number.isFinite(RATE_LIMIT_MAX_RAW) && RATE_LIMIT_MAX_RAW > 0
    ? RATE_LIMIT_MAX_RAW
    : 0;
const STATIC_DIR = path.join(__dirname, "static");
const INTROSPECTION_DEFAULT_MAX_OBJECTS = clampIntegerEnv(
  process.env.ROBLOXBRIDGE_INTROSPECTION_DEFAULT_MAX_OBJECTS,
  500,
  1,
  5000,
);
const INTROSPECTION_MAX_OBJECTS = clampIntegerEnv(
  process.env.ROBLOXBRIDGE_INTROSPECTION_MAX_OBJECTS,
  2000,
  1,
  10000,
);

function clampIntegerEnv(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeRole(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  if (role === "read" || role === "write" || role === "admin") {
    return role;
  }
  return "write";
}

function parseApiKeys() {
  const out = new Map();
  if (API_KEYS_ENV) {
    for (const rawEntry of API_KEYS_ENV.split(",")) {
      const entry = String(rawEntry || "").trim();
      if (!entry) {
        continue;
      }
      const colon = entry.indexOf(":");
      const key = (colon >= 0 ? entry.slice(0, colon) : entry).trim();
      const role = normalizeRole(colon >= 0 ? entry.slice(colon + 1) : "write");
      if (key) {
        out.set(key, role);
      }
    }
  }
  if (API_KEY && !out.has(API_KEY)) {
    out.set(API_KEY, "admin");
  }
  return out;
}

const API_KEYS = parseApiKeys();
const AUTH_ENABLED = API_KEYS.size > 0;

fs.mkdirSync(IMPORT_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

const store = new CommandStore({
  leaseMs: Number.isFinite(COMMAND_LEASE_MS) ? COMMAND_LEASE_MS : 120000,
  maxRetention: Number.isFinite(MAX_RETENTION) ? MAX_RETENTION : 10000,
  snapshotPath: QUEUE_SNAPSHOT_PATH || null,
});

const sceneIntrospectionState = {
  status: "empty",
  queued_command_id: null,
  last_command_id: null,
  queued_at: null,
  updated_at: null,
  error: null,
  scene: null,
};

function shallowCopyObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.assign({}, value);
}

function normalizeSceneSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const objects = Array.isArray(raw.objects)
    ? raw.objects.filter((item) => item && typeof item === "object")
    : [];
  const classCounts = shallowCopyObject(raw.class_counts);
  const materials = Array.isArray(raw.materials)
    ? raw.materials.map((item) => String(item))
    : [];
  const selection = Array.isArray(raw.selection)
    ? raw.selection.map((item) => String(item))
    : [];

  const objectCountRaw =
    raw.object_count !== undefined && raw.object_count !== null
      ? Number.parseInt(String(raw.object_count), 10)
      : objects.length;
  const objectCount = Number.isFinite(objectCountRaw)
    ? Math.max(0, objectCountRaw)
    : objects.length;

  return {
    root: String(raw.root || "Workspace"),
    object_count: objectCount,
    max_objects: clampIntegerEnv(
      raw.max_objects,
      INTROSPECTION_DEFAULT_MAX_OBJECTS,
      1,
      INTROSPECTION_MAX_OBJECTS,
    ),
    truncated: raw.truncated === true,
    collected_at: String(raw.collected_at || new Date().toISOString()),
    objects,
    class_counts: classCounts,
    materials,
    selection,
  };
}

function sceneContextSummary(sceneSnapshot) {
  if (!sceneSnapshot) {
    return {
      object_count: 0,
      truncated: false,
      class_counts: {},
      materials: [],
      selection: [],
      sample_objects: [],
    };
  }
  return {
    root: sceneSnapshot.root,
    object_count: sceneSnapshot.object_count,
    truncated: sceneSnapshot.truncated === true,
    class_counts: shallowCopyObject(sceneSnapshot.class_counts),
    materials: Array.isArray(sceneSnapshot.materials)
      ? sceneSnapshot.materials.slice(0, 80)
      : [],
    selection: Array.isArray(sceneSnapshot.selection)
      ? sceneSnapshot.selection.slice(0, 40)
      : [],
    sample_objects: Array.isArray(sceneSnapshot.objects)
      ? sceneSnapshot.objects.slice(0, 60)
      : [],
    collected_at: sceneSnapshot.collected_at,
  };
}

function updateSceneStateOnQueued(command) {
  if (!command) {
    return;
  }
  sceneIntrospectionState.status = "queued";
  sceneIntrospectionState.queued_command_id = command.id || null;
  sceneIntrospectionState.last_command_id = command.id || null;
  sceneIntrospectionState.queued_at =
    command.created_at || new Date().toISOString();
  sceneIntrospectionState.updated_at = sceneIntrospectionState.queued_at;
  sceneIntrospectionState.error = null;
}

function updateSceneStateFromCommand(command) {
  if (!command || command.action !== "introspect-scene") {
    return;
  }
  sceneIntrospectionState.last_command_id = command.id || null;
  sceneIntrospectionState.queued_command_id = null;
  sceneIntrospectionState.updated_at =
    command.updated_at || new Date().toISOString();

  if (command.status === "succeeded") {
    const scene = normalizeSceneSnapshot(command.result);
    if (scene) {
      sceneIntrospectionState.scene = scene;
      sceneIntrospectionState.status = "succeeded";
      sceneIntrospectionState.error = null;
      return;
    }
    sceneIntrospectionState.status = "failed";
    sceneIntrospectionState.error =
      "introspection result missing scene snapshot payload";
    return;
  }

  if (command.status === "failed") {
    sceneIntrospectionState.status = "failed";
    sceneIntrospectionState.error = String(command.error || "unknown error");
    return;
  }

  if (command.status === "queued" || command.status === "dispatched") {
    sceneIntrospectionState.status = command.status;
  }
}

function resolvePlannerSceneContext(body) {
  if (body && body.include_scene_context === false) {
    return null;
  }
  if (
    body &&
    body.scene_context &&
    typeof body.scene_context === "object" &&
    !Array.isArray(body.scene_context)
  ) {
    return body.scene_context;
  }
  if (sceneIntrospectionState.scene) {
    return sceneContextSummary(sceneIntrospectionState.scene);
  }
  return null;
}

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

app.use(blockUnauthenticatedRemote);
app.use("/bridge/static", express.static(STATIC_DIR));

const limiter = new FixedWindowRateLimiter({
  max: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
});

function roleRank(role) {
  if (role === "admin") {
    return 3;
  }
  if (role === "write") {
    return 2;
  }
  return 1;
}

function resolveSuppliedKey(req) {
  return req.get("X-API-Key") || req.query.api_key || null;
}

function resolveApiContext(req) {
  if (!AUTH_ENABLED) {
    return { ok: true, key: null, role: "admin" };
  }
  const supplied = resolveSuppliedKey(req);
  if (!supplied) {
    return { ok: false, error: "invalid API key" };
  }
  const role = API_KEYS.get(supplied);
  if (!role) {
    return { ok: false, error: "invalid API key" };
  }
  return {
    ok: true,
    key: supplied,
    role,
  };
}

function requireApiKey(req, res, next) {
  const auth = resolveApiContext(req);
  if (!auth.ok) {
    return res.status(401).json({ status: "error", error: auth.error });
  }
  req.auth = auth;
  return next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    const auth = req.auth || resolveApiContext(req);
    if (!auth.ok) {
      return res.status(401).json({ status: "error", error: auth.error });
    }
    req.auth = auth;
    if (roleRank(auth.role) < roleRank(minRole)) {
      return res.status(403).json({
        status: "error",
        error: `insufficient role; requires ${minRole}`,
      });
    }
    return next();
  };
}

function clientIp(req) {
  const direct =
    req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
  if (TRUST_PROXY) {
    const forwarded = req.get("X-Forwarded-For");
    if (forwarded && typeof forwarded === "string") {
      const first = forwarded.split(",")[0].trim();
      if (first) {
        return first;
      }
    }
  }
  return direct || req.ip || "unknown";
}

function isLocalIp(ip) {
  const normalized = String(ip || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("::ffff:127.0.0.1") ||
    normalized.startsWith("::ffff:localhost") ||
    normalized === "localhost"
  );
}

function isLoopbackHost(host) {
  const normalized = String(host || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost"
  );
}

const BIND_LOCAL_ONLY = isLoopbackHost(HOST);

function blockUnauthenticatedRemote(req, res, next) {
  if (AUTH_ENABLED || ALLOW_UNAUTHENTICATED_REMOTE) {
    return next();
  }
  const ip = clientIp(req);
  if (isLocalIp(ip)) {
    return next();
  }
  return res.status(403).json({
    status: "error",
    error: "remote access denied while API key auth is disabled",
    hint: "Set ROBLOXBRIDGE_API_KEY/ROBLOXBRIDGE_API_KEYS, or ROBLOXBRIDGE_ALLOW_UNAUTHENTICATED_REMOTE=true (unsafe)",
  });
}

function applyRateLimit(req, res, next) {
  if (!limiter.enabled()) {
    return next();
  }

  const ip = clientIp(req);
  if (RATE_LIMIT_EXEMPT_LOCAL && isLocalIp(ip)) {
    return next();
  }

  const authKey =
    req.auth && req.auth.key ? req.auth.key : resolveSuppliedKey(req) || "anon";
  const bucketKey = `${authKey}|${ip}`;
  const verdict = limiter.consume(bucketKey);

  const resetSeconds = Math.max(
    0,
    Math.ceil((verdict.reset_at_ms - Date.now()) / 1000),
  );
  res.setHeader("X-RateLimit-Limit", String(verdict.limit));
  res.setHeader("X-RateLimit-Remaining", String(verdict.remaining));
  res.setHeader("X-RateLimit-Reset", String(resetSeconds));

  if (!verdict.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(verdict.retry_after_ms / 1000),
    );
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      status: "error",
      error: "rate limit exceeded",
      retry_after_ms: verdict.retry_after_ms,
    });
  }
  return next();
}

const readAccess = [requireApiKey, requireRole("read"), applyRateLimit];
const writeAccess = [requireApiKey, requireRole("write"), applyRateLimit];

function parseInteger(value, fallback, min, max) {
  const raw =
    value !== undefined && value !== null && value !== "" ? value : fallback;
  const parsed = parseInt(String(raw), 10);
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

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const key = String(value).trim();
  if (!key) {
    return null;
  }
  return key.slice(0, 256);
}

function resolveIdempotencyKey(req, payload) {
  const fromHeader = req.get("X-Idempotency-Key");
  const fromBody = payload ? payload.idempotency_key : null;
  const fromMetadata =
    payload && payload.metadata ? payload.metadata.idempotency_key : null;
  return normalizeIdempotencyKey(fromHeader || fromBody || fromMetadata);
}

function parseExpiresAt(payload) {
  const now = Date.now();
  if (
    payload &&
    payload.expires_at !== undefined &&
    payload.expires_at !== null &&
    payload.expires_at !== ""
  ) {
    const parsed = Date.parse(payload.expires_at);
    if (!Number.isFinite(parsed)) {
      return { ok: false, error: "invalid expires_at; expected ISO datetime" };
    }
    return { ok: true, expiresAt: new Date(parsed).toISOString() };
  }

  if (
    payload &&
    payload.expires_in_ms !== undefined &&
    payload.expires_in_ms !== null &&
    payload.expires_in_ms !== ""
  ) {
    const parsed = Number.parseInt(String(payload.expires_in_ms), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        ok: false,
        error: "invalid expires_in_ms; expected positive integer milliseconds",
      };
    }
    const clamped = Math.min(
      Math.max(1, parsed),
      Math.max(1, MAX_EXPIRES_IN_MS),
    );
    return { ok: true, expiresAt: new Date(now + clamped).toISOString() };
  }

  return { ok: true, expiresAt: null };
}

function queueCommand(req, res, spec, extraPayload = {}, options = {}) {
  const expires = parseExpiresAt(req.body || {});
  if (!expires.ok) {
    return res.status(400).json({ status: "error", error: expires.error });
  }
  const priority = parseInteger(req.body.priority, 0, -100, 100);
  const metadata = Object.assign({}, req.body.metadata || {}, {
    requested_by: req.get("X-Request-By") || "api",
    client_hint: req.body.client_hint || null,
  });
  const payload = Object.assign({}, req.body, extraPayload);
  const { command, deduped } = store.enqueueWithMeta({
    route: spec.path,
    category: spec.category,
    action: spec.action,
    payload,
    priority,
    metadata,
    idempotencyKey: resolveIdempotencyKey(req, req.body || {}),
    expiresAt: expires.expiresAt,
  });
  if (options && typeof options.onQueued === "function") {
    options.onQueued(command, { deduped });
  }
  return res.json({
    status: "queued",
    command_id: command.id,
    category: command.category,
    action: command.action,
    route: command.route,
    queued_at: command.created_at,
    deduped,
    idempotency_key: command.idempotency_key,
    expires_at: command.expires_at,
  });
}

const commandRoutes = [
  {
    path: "/bridge/scene/spawn-object",
    category: "scene",
    action: "spawn-object",
  },
  {
    path: "/bridge/scene/set-property",
    category: "scene",
    action: "set-property",
  },
  {
    path: "/bridge/scene/set-transform",
    category: "scene",
    action: "set-transform",
  },
  { path: "/bridge/scene/set-color", category: "scene", action: "set-color" },
  {
    path: "/bridge/scene/set-material",
    category: "scene",
    action: "set-material",
  },
  { path: "/bridge/scene/set-size", category: "scene", action: "set-size" },
  {
    path: "/bridge/scene/set-anchored",
    category: "scene",
    action: "set-anchored",
  },
  {
    path: "/bridge/scene/set-collidable",
    category: "scene",
    action: "set-collidable",
  },
  {
    path: "/bridge/scene/group-objects",
    category: "scene",
    action: "group-objects",
  },
  {
    path: "/bridge/scene/duplicate-object",
    category: "scene",
    action: "duplicate-object",
  },
  {
    path: "/bridge/scene/delete-object",
    category: "scene",
    action: "delete-object",
  },
  {
    path: "/bridge/scene/select-object",
    category: "scene",
    action: "select-object",
  },
  {
    path: "/bridge/scene/clear-selection",
    category: "scene",
    action: "clear-selection",
  },
  {
    path: "/bridge/scene/rename-object",
    category: "scene",
    action: "rename-object",
  },
  {
    path: "/bridge/scene/create-folder",
    category: "scene",
    action: "create-folder",
  },
  {
    path: "/bridge/scene/parent-object",
    category: "scene",
    action: "parent-object",
  },
  {
    path: "/bridge/asset/import-model",
    category: "asset",
    action: "import-model",
  },
  {
    path: "/bridge/asset/import-from-url",
    category: "asset",
    action: "import-from-url",
  },
  {
    path: "/bridge/asset/insert-toolbox-asset",
    category: "asset",
    action: "insert-toolbox-asset",
  },
  {
    path: "/bridge/asset/insert-asset-id",
    category: "asset",
    action: "insert-asset-id",
  },
  {
    path: "/bridge/asset/create-script",
    category: "asset",
    action: "create-script",
  },
  {
    path: "/bridge/asset/create-local-script",
    category: "asset",
    action: "create-local-script",
  },
  {
    path: "/bridge/asset/create-module-script",
    category: "asset",
    action: "create-module-script",
  },
  { path: "/bridge/asset/save-place", category: "asset", action: "save-place" },
  {
    path: "/bridge/asset/export-place",
    category: "asset",
    action: "export-place",
  },
  {
    path: "/bridge/asset/publish-place",
    category: "asset",
    action: "publish-place",
  },
  {
    path: "/bridge/terrain/generate-terrain",
    category: "terrain",
    action: "generate-terrain",
  },
  {
    path: "/bridge/terrain/fill-region",
    category: "terrain",
    action: "fill-region",
  },
  {
    path: "/bridge/terrain/replace-material",
    category: "terrain",
    action: "replace-material",
  },
  {
    path: "/bridge/terrain/clear-region",
    category: "terrain",
    action: "clear-region",
  },
  {
    path: "/bridge/environment/set-lighting",
    category: "environment",
    action: "set-lighting",
  },
  {
    path: "/bridge/environment/set-atmosphere",
    category: "environment",
    action: "set-atmosphere",
  },
  {
    path: "/bridge/environment/set-skybox",
    category: "environment",
    action: "set-skybox",
  },
  {
    path: "/bridge/environment/set-time",
    category: "environment",
    action: "set-time",
  },
  {
    path: "/bridge/environment/set-fog",
    category: "environment",
    action: "set-fog",
  },
  {
    path: "/bridge/script/insert-script",
    category: "script",
    action: "insert-script",
  },
  {
    path: "/bridge/script/insert-local-script",
    category: "script",
    action: "insert-local-script",
  },
  {
    path: "/bridge/script/insert-module-script",
    category: "script",
    action: "insert-module-script",
  },
  {
    path: "/bridge/script/run-command",
    category: "script",
    action: "run-command",
  },
  {
    path: "/bridge/simulation/playtest/start",
    category: "simulation",
    action: "playtest-start",
  },
  {
    path: "/bridge/simulation/playtest/stop",
    category: "simulation",
    action: "playtest-stop",
  },
  {
    path: "/bridge/viewport/set-camera",
    category: "viewport",
    action: "set-camera",
  },
  {
    path: "/bridge/viewport/focus-selection",
    category: "viewport",
    action: "focus-selection",
  },
  {
    path: "/bridge/viewport/screenshot",
    category: "viewport",
    action: "screenshot",
  },
  {
    path: "/bridge/viewport/render-frame",
    category: "viewport",
    action: "render-frame",
  },
  {
    path: "/bridge/workspace/autosave",
    category: "workspace",
    action: "autosave",
  },
  { path: "/bridge/test-spawn", category: "test", action: "test-spawn" },
];

const commandCatalogByRoute = new Map(
  listCommandCatalog().map((item) => [item.route, item]),
);

function buildDocsEndpoints() {
  const core = [
    {
      method: "GET",
      path: "/bridge/health",
      auth: "none",
      category: "core",
      action: "",
      risk: "safe",
      description: "Bridge/service health and runtime status.",
      example_curl: "curl -s http://127.0.0.1:30010/bridge/health | jq .",
    },
    {
      method: "GET",
      path: "/bridge/capabilities",
      auth: "none",
      category: "core",
      action: "",
      risk: "safe",
      description: "Capability introspection for auth/import/capture/features.",
      example_curl: "curl -s http://127.0.0.1:30010/bridge/capabilities | jq .",
    },
    {
      method: "GET",
      path: "/bridge/planner/templates",
      auth: AUTH_ENABLED ? "read" : "none",
      category: "planner",
      action: "list-templates",
      risk: "safe",
      description: "List deterministic planner templates for Studio UI.",
      example_curl:
        'curl -s -H "X-API-Key: $API_KEY" http://127.0.0.1:30010/bridge/planner/templates | jq .',
    },
    {
      method: "GET",
      path: "/bridge/planner/catalog",
      auth: AUTH_ENABLED ? "read" : "none",
      category: "planner",
      action: "list-catalog",
      risk: "safe",
      description: "List route/action catalog with risk levels for planner.",
      example_curl:
        'curl -s -H "X-API-Key: $API_KEY" http://127.0.0.1:30010/bridge/planner/catalog | jq .',
    },
    {
      method: "POST",
      path: "/bridge/assistant/plan",
      auth: AUTH_ENABLED ? "read" : "none",
      category: "planner",
      action: "plan",
      risk: "safe",
      description:
        "Generate deterministic command plans from text/voice prompts.",
      example_curl:
        'curl -s -X POST http://127.0.0.1:30010/bridge/assistant/plan -H "X-API-Key: $API_KEY" -H \'Content-Type: application/json\' -d \'{"prompt":"build a 12 platform obby"}\' | jq .',
    },
    {
      method: "POST",
      path: "/bridge/assistant/execute",
      auth: AUTH_ENABLED ? "write" : "none",
      category: "planner",
      action: "execute-plan",
      risk: "caution",
      description:
        "Queue all commands from a generated plan (with danger guardrail).",
      example_curl:
        'curl -s -X POST http://127.0.0.1:30010/bridge/assistant/execute -H "X-API-Key: $API_KEY" -H \'Content-Type: application/json\' -d \'{"prompt":"terrain generator"}\' | jq .',
    },
    {
      method: "POST",
      path: "/bridge/introspection/scene",
      auth: AUTH_ENABLED ? "write" : "none",
      category: "introspection",
      action: "introspect-scene",
      risk: "safe",
      description: "Queue scene hierarchy introspection from Studio plugin.",
      example_curl:
        "curl -s -X POST http://127.0.0.1:30010/bridge/introspection/scene -H \"X-API-Key: $API_KEY\" -H 'Content-Type: application/json' -d '{\"max_objects\":500}' | jq .",
    },
    {
      method: "GET",
      path: "/bridge/introspection/scene",
      auth: AUTH_ENABLED ? "read" : "none",
      category: "introspection",
      action: "get-introspection",
      risk: "safe",
      description: "Read latest cached scene introspection snapshot.",
      example_curl:
        'curl -s -H "X-API-Key: $API_KEY" "http://127.0.0.1:30010/bridge/introspection/scene?include_objects=false" | jq .',
    },
    {
      method: "GET",
      path: "/bridge/studio",
      auth: "none",
      category: "ui",
      action: "studio-ui",
      risk: "safe",
      description: "Web Studio UI for text/voice planning and queue execution.",
      example_curl: "open http://127.0.0.1:30010/bridge/studio",
    },
    {
      method: "GET",
      path: "/docs",
      auth: "none",
      category: "ui",
      action: "api-docs",
      risk: "safe",
      description: "Browsable API explorer with search and endpoint metadata.",
      example_curl: "open http://127.0.0.1:30010/docs",
    },
  ];

  const commandDocs = commandRoutes.map((routeSpec) => {
    const catalog = commandCatalogByRoute.get(routeSpec.path);
    return {
      method: "POST",
      path: routeSpec.path,
      auth: AUTH_ENABLED ? "write" : "none",
      category: routeSpec.category,
      action: routeSpec.action,
      risk: catalog ? catalog.risk : "safe",
      description: catalog
        ? catalog.summary
        : `Queue ${routeSpec.action} command.`,
      example_curl: `curl -s -X POST http://127.0.0.1:30010${routeSpec.path} -H \"X-API-Key: $API_KEY\" -H 'Content-Type: application/json' -d '{}' | jq .`,
    };
  });

  return core.concat(commandDocs);
}

app.get("/docs", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "api-docs.html"));
});

app.get("/bridge/studio", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "studio.html"));
});

app.get("/bridge/docs/endpoints", (_req, res) => {
  res.json({
    status: "ok",
    generated_at: new Date().toISOString(),
    endpoints: buildDocsEndpoints(),
  });
});

app.get("/bridge/health", (_req, res) => {
  res.json({
    status: "ok",
    product: "NovaBlox",
    service: "RobloxStudioBridge",
    version: VERSION,
    queue: store.summary(),
    import_dir: IMPORT_DIR,
    export_dir: EXPORT_DIR,
    api_key_enabled: AUTH_ENABLED,
    auth: {
      enabled: AUTH_ENABLED,
      key_count: API_KEYS.size,
      roles: ["read", "write", "admin"],
    },
    security: {
      bind_host: HOST,
      binds_local_only: BIND_LOCAL_ONLY,
      trust_proxy: TRUST_PROXY,
      allow_unauthenticated_remote: ALLOW_UNAUTHENTICATED_REMOTE,
      unauthenticated_remote_blocked:
        !AUTH_ENABLED && !ALLOW_UNAUTHENTICATED_REMOTE,
    },
    rate_limit: {
      enabled: limiter.enabled(),
      window_ms: RATE_LIMIT_WINDOW_MS,
      max_requests: RATE_LIMIT_MAX,
      exempt_local: RATE_LIMIT_EXEMPT_LOCAL,
    },
    introspection: {
      state: sceneIntrospectionState.status,
      updated_at: sceneIntrospectionState.updated_at,
      last_command_id: sceneIntrospectionState.last_command_id,
      object_count: sceneIntrospectionState.scene
        ? sceneIntrospectionState.scene.object_count
        : 0,
      truncated: sceneIntrospectionState.scene
        ? sceneIntrospectionState.scene.truncated === true
        : false,
    },
  });
});

app.get("/bridge/capabilities", (_req, res) => {
  res.json({
    status: "ok",
    capabilities: {
      persistence: {
        queue_snapshot: Boolean(QUEUE_SNAPSHOT_PATH),
        queue_snapshot_path: QUEUE_SNAPSHOT_PATH || null,
      },
      auth: {
        enabled: AUTH_ENABLED,
        roles: ["read", "write", "admin"],
        local_only_when_unauthenticated: !ALLOW_UNAUTHENTICATED_REMOTE,
        trust_proxy: TRUST_PROXY,
        rate_limit: {
          enabled: limiter.enabled(),
          window_ms: RATE_LIMIT_WINDOW_MS,
          max_requests: RATE_LIMIT_MAX,
          exempt_local: RATE_LIMIT_EXEMPT_LOCAL,
        },
      },
      asset_import: {
        direct_local_import: false,
        asset_id_insert: true,
        manual_import_workflow: true,
      },
      capture: {
        native_programmatic_screenshot: false,
        external_capture_url: true,
        manual_capture_fallback: true,
      },
      results: {
        single: true,
        batch: true,
      },
      planner: {
        enabled: true,
        templates: listTemplates().map((item) => item.id),
        catalog_size: listCommandCatalog().length,
        requires_allow_dangerous: true,
        llm_providers_supported: [
          "deterministic",
          "openai",
          "openrouter",
          "anthropic",
        ],
        scene_context_from_cache: true,
      },
      introspection: {
        scene_snapshot: true,
        queue_route: "/bridge/introspection/scene",
        cache_route: "/bridge/introspection/scene",
        default_max_objects: INTROSPECTION_DEFAULT_MAX_OBJECTS,
        max_objects: INTROSPECTION_MAX_OBJECTS,
      },
    },
  });
});

app.get("/bridge/planner/templates", ...readAccess, (_req, res) => {
  res.json({
    status: "ok",
    templates: listTemplates(),
  });
});

app.get("/bridge/planner/catalog", ...readAccess, (_req, res) => {
  res.json({
    status: "ok",
    count: listCommandCatalog().length,
    catalog: listCommandCatalog(),
  });
});

app.post("/bridge/introspection/scene", ...writeAccess, (req, res) => {
  const maxObjects = parseInteger(
    req.body && req.body.max_objects,
    INTROSPECTION_DEFAULT_MAX_OBJECTS,
    1,
    INTROSPECTION_MAX_OBJECTS,
  );
  const includeSelection = !(req.body && req.body.include_selection === false);
  const includeNonWorkspace =
    req.body && req.body.include_non_workspace === true;
  return queueCommand(
    req,
    res,
    {
      path: "/bridge/introspection/scene",
      category: "introspection",
      action: "introspect-scene",
    },
    {
      max_objects: maxObjects,
      include_selection: includeSelection,
      include_non_workspace: includeNonWorkspace,
    },
    {
      onQueued: (command) => updateSceneStateOnQueued(command),
    },
  );
});

app.get("/bridge/introspection/scene", ...readAccess, (req, res) => {
  const includeObjects =
    String(req.query.include_objects || "true")
      .trim()
      .toLowerCase() !== "false";
  const scene = includeObjects
    ? sceneIntrospectionState.scene
    : sceneContextSummary(sceneIntrospectionState.scene);
  return res.json({
    status: "ok",
    introspection: {
      state: sceneIntrospectionState.status,
      queued_command_id: sceneIntrospectionState.queued_command_id,
      last_command_id: sceneIntrospectionState.last_command_id,
      queued_at: sceneIntrospectionState.queued_at,
      updated_at: sceneIntrospectionState.updated_at,
      error: sceneIntrospectionState.error,
      scene: scene || null,
    },
  });
});

app.post("/bridge/assistant/plan", ...readAccess, async (req, res) => {
  try {
    const body = req.body || {};
    const sceneContext = resolvePlannerSceneContext(body);
    const built = await buildPlanWithAssistant({
      prompt: body.prompt || "",
      template: body.template || "",
      voice_mode: body.voice_mode === true,
      use_llm: body.use_llm === true,
      provider: body.provider || "",
      model: body.model || "",
      temperature: body.temperature,
      timeout_ms: body.timeout_ms,
      allow_dangerous: body.allow_dangerous === true,
      scene_context: sceneContext,
    });
    return res.json({
      status: "ok",
      plan: built.plan,
      assistant: built.assistant,
      scene_context: sceneContext,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/bridge/assistant/execute", ...writeAccess, async (req, res) => {
  const body = req.body || {};
  const suppliedPlan = normalizeExternalPlan(body.plan);
  const allowDangerous = body.allow_dangerous === true;
  let plan = suppliedPlan;
  let assistant = null;
  let sceneContext = null;

  if (!plan) {
    try {
      sceneContext = resolvePlannerSceneContext(body);
      const built = await buildPlanWithAssistant({
        prompt: body.prompt || "",
        template: body.template || "",
        voice_mode: body.voice_mode === true,
        use_llm: body.use_llm === true,
        provider: body.provider || "",
        model: body.model || "",
        temperature: body.temperature,
        timeout_ms: body.timeout_ms,
        allow_dangerous: allowDangerous,
        scene_context: sceneContext,
      });
      plan = built.plan;
      assistant = built.assistant;
    } catch (error) {
      return res.status(500).json({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    assistant = {
      source: "external-plan",
      used_llm: false,
      fallback: false,
      provider_requested: null,
    };
  }

  if (!plan || !Array.isArray(plan.commands) || plan.commands.length === 0) {
    return res.status(400).json({
      status: "error",
      error: "plan must include at least one command",
    });
  }

  if (plan.risk_summary && plan.risk_summary.dangerous > 0 && !allowDangerous) {
    return res.status(400).json({
      status: "error",
      error:
        "plan includes dangerous commands; set allow_dangerous=true to execute",
      risk_summary: plan.risk_summary,
      warnings: plan.warnings || [],
    });
  }

  const queued = queuePlan(store, plan, {
    requested_by: req.get("X-Request-By") || "assistant-api",
    client_hint:
      req.body && req.body.client_hint
        ? req.body.client_hint
        : inferClientId(req),
    metadata:
      req.body && req.body.metadata && typeof req.body.metadata === "object"
        ? req.body.metadata
        : {},
    expires_in_ms:
      req.body && req.body.expires_in_ms ? req.body.expires_in_ms : 0,
    idempotency_prefix:
      req.body && req.body.idempotency_prefix
        ? req.body.idempotency_prefix
        : plan.id,
  });

  return res.json({
    status: "queued",
    plan_id: plan.id,
    queued_count: queued.queued_count,
    deduped_count: queued.deduped_count,
    command_ids: queued.command_ids,
    expires_at: queued.expires_at || null,
    risk_summary: plan.risk_summary,
    warnings: plan.warnings || [],
    assistant,
    scene_context: sceneContext,
  });
});

app.get("/bridge/stats", ...readAccess, (_req, res) => {
  res.json({ status: "ok", stats: store.summary() });
});

app.get("/bridge/commands/recent", ...readAccess, (req, res) => {
  const limit = parseInteger(req.query.limit, 50, 1, 500);
  res.json({ status: "ok", commands: store.listRecent(limit) });
});

app.get("/bridge/commands/:id", ...readAccess, (req, res) => {
  const command = store.get(req.params.id);
  if (!command) {
    return res.status(404).json({ status: "error", error: "not found" });
  }
  return res.json({ status: "ok", command });
});

app.post("/bridge/command", ...writeAccess, (req, res) => {
  const { route, category, action, payload } = req.body || {};
  if (!route || !action) {
    return res
      .status(400)
      .json({ status: "error", error: "route and action are required" });
  }
  const expires = parseExpiresAt(req.body || {});
  if (!expires.ok) {
    return res.status(400).json({ status: "error", error: expires.error });
  }
  const { command, deduped } = store.enqueueWithMeta({
    route,
    category: category || "custom",
    action,
    payload: payload || req.body.payload || {},
    priority: parseInteger(req.body.priority, 0, -100, 100),
    metadata: req.body.metadata || {},
    idempotencyKey: resolveIdempotencyKey(req, req.body || {}),
    expiresAt: expires.expiresAt,
  });
  return res.json({
    status: "queued",
    command_id: command.id,
    deduped,
    idempotency_key: command.idempotency_key,
    expires_at: command.expires_at,
    command,
  });
});

app.post("/bridge/commands/batch", ...writeAccess, (req, res) => {
  const commands = Array.isArray(req.body.commands) ? req.body.commands : [];
  if (commands.length === 0) {
    return res
      .status(400)
      .json({ status: "error", error: "commands[] is required" });
  }

  const normalized = [];
  for (let i = 0; i < commands.length; i += 1) {
    const cmd = commands[i] || {};
    const expires = parseExpiresAt(cmd);
    if (!expires.ok) {
      return res.status(400).json({
        status: "error",
        error: `${expires.error} (commands[${i}])`,
      });
    }
    normalized.push({
      route: cmd.route || "/bridge/custom",
      category: cmd.category || "custom",
      action: cmd.action || "command",
      payload: cmd.payload || {},
      priority: parseInteger(cmd.priority, 0, -100, 100),
      metadata: cmd.metadata || {},
      idempotencyKey: normalizeIdempotencyKey(cmd.idempotency_key),
      expiresAt: expires.expiresAt,
    });
  }

  const queuedWithMeta = store.enqueueBatchWithMeta(normalized);
  const queued = queuedWithMeta.map((item) => item.command);
  const dedupedCount = queuedWithMeta.filter((item) => item.deduped).length;
  return res.json({
    status: "queued",
    count: queued.length,
    deduped_count: dedupedCount,
    command_ids: queued.map((cmd) => cmd.id),
  });
});

app.get("/bridge/commands", ...writeAccess, (req, res) => {
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

app.post("/bridge/results", ...writeAccess, (req, res) => {
  const result = store.result(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ status: "error", error: result.error });
  }
  updateSceneStateFromCommand(result.command);
  return res.json({
    status: "ok",
    duplicate: result.duplicate === true,
    command_id: result.command.id,
    command_status: result.command.status,
    updated_at: result.command.updated_at,
    execution_ms: result.command.execution_ms,
  });
});

app.post("/bridge/results/batch", ...writeAccess, (req, res) => {
  const results = Array.isArray(req.body.results) ? req.body.results : [];
  if (results.length === 0) {
    return res
      .status(400)
      .json({ status: "error", error: "results[] is required" });
  }
  const batch = store.resultBatch(results);
  for (const outcome of batch.outcomes) {
    if (outcome && outcome.ok && outcome.command) {
      updateSceneStateFromCommand(outcome.command);
    }
  }
  const normalized = batch.outcomes.map((outcome) => {
    if (!outcome.ok) {
      return {
        index: outcome.index,
        ok: false,
        command_id: outcome.command_id,
        error: outcome.error,
      };
    }
    return {
      index: outcome.index,
      ok: true,
      duplicate: outcome.duplicate === true,
      command_id: outcome.command.id,
      command_status: outcome.command.status,
      updated_at: outcome.command.updated_at,
      execution_ms: outcome.command.execution_ms,
    };
  });

  return res.json({
    status: batch.error_count === 0 ? "ok" : "partial",
    total_count: batch.total_count,
    success_count: batch.success_count,
    error_count: batch.error_count,
    duplicate_count: batch.duplicate_count,
    results: normalized,
  });
});

app.post("/bridge/commands/:id/requeue", ...writeAccess, (req, res) => {
  const result = store.requeue(req.params.id);
  if (!result.ok) {
    return res.status(400).json({ status: "error", error: result.error });
  }
  return res.json({ status: "ok", command: result.command });
});

app.post("/bridge/commands/:id/cancel", ...writeAccess, (req, res) => {
  const result = store.cancel(req.params.id);
  if (!result.ok) {
    return res.status(400).json({ status: "error", error: result.error });
  }
  return res.json({ status: "ok", command: result.command });
});

app.get("/bridge/stream", ...writeAccess, (req, res) => {
  const clientId = inferClientId(req);
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write("event: connected\n");
  res.write(
    `data: ${JSON.stringify({ client_id: clientId, ts: new Date().toISOString() })}\n\n`,
  );

  store.addSseClient(clientId, res);

  const keepAlive = setInterval(() => {
    try {
      res.write("event: heartbeat\n");
      res.write(
        `data: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`,
      );
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
  app.post(spec.path, ...writeAccess, (req, res) =>
    queueCommand(req, res, spec),
  );
});

app.post(
  "/bridge/blender/import",
  ...writeAccess,
  upload.single("file"),
  (req, res) => {
    let localPath = req.body.file_path || null;
    if (req.file && req.file.path) {
      const extension = path.extname(req.file.originalname || "").toLowerCase();
      const safeName = `${req.file.filename}${extension}`;
      const finalPath = path.join(IMPORT_DIR, safeName);
      fs.renameSync(req.file.path, finalPath);
      localPath = finalPath;
    }

    if (!localPath) {
      return res.status(400).json({
        status: "error",
        error: "Provide multipart file upload or file_path",
      });
    }

    const scaleFix = req.body.scale_fix || "blender_to_roblox";
    const rawScale =
      req.body.scale_factor !== undefined
        ? req.body.scale_factor
        : req.body.scale;
    const scaleFactor = parseFloatSafe(
      rawScale,
      scaleFix === "blender_to_roblox" ? BLENDER_TO_ROBLOX_SCALE : 1.0,
    );

    return queueCommand(
      req,
      res,
      {
        path: "/bridge/blender/import",
        category: "blender",
        action: "import-blender",
      },
      {
        file_path: localPath,
        scale_fix: scaleFix,
        scale_factor: scaleFactor,
        recommended_blender_to_roblox_scale: BLENDER_TO_ROBLOX_SCALE,
      },
    );
  },
);

app.post(
  "/bridge/asset/import-blender",
  ...writeAccess,
  upload.single("file"),
  (req, res) => {
    const scaleFix = req.body.scale_fix || "blender_to_roblox";
    const rawScale =
      req.body.scale_factor !== undefined
        ? req.body.scale_factor
        : req.body.scale;
    const scaleFactor = parseFloatSafe(
      rawScale,
      scaleFix === "blender_to_roblox" ? BLENDER_TO_ROBLOX_SCALE : 1.0,
    );
    const assetId =
      req.body.asset_id !== undefined
        ? Number.parseInt(req.body.asset_id, 10)
        : null;

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
      {
        path: "/bridge/asset/import-blender",
        category: "asset",
        action: "import-blender",
      },
      {
        file_path: localPath,
        asset_id: Number.isFinite(assetId) ? assetId : undefined,
        original_name: originalName,
        scale_fix: scaleFix,
        scale_factor: scaleFactor,
        recommended_blender_to_roblox_scale: BLENDER_TO_ROBLOX_SCALE,
      },
    );
  },
);

app.post(
  "/bridge/asset/import-model/upload",
  ...writeAccess,
  upload.single("file"),
  (req, res) => {
    if (!req.file || !req.file.path) {
      return res
        .status(400)
        .json({ status: "error", error: "multipart file is required" });
    }
    const extension = path.extname(req.file.originalname || "").toLowerCase();
    const safeName = `${req.file.filename}${extension}`;
    const finalPath = path.join(IMPORT_DIR, safeName);
    fs.renameSync(req.file.path, finalPath);

    return queueCommand(
      req,
      res,
      {
        path: "/bridge/asset/import-model/upload",
        category: "asset",
        action: "import-model",
      },
      { file_path: finalPath, original_name: req.file.originalname },
    );
  },
);

app.post(
  "/bridge/asset/upload-result",
  ...writeAccess,
  upload.single("file"),
  (req, res) => {
    if (!req.file || !req.file.path) {
      return res
        .status(400)
        .json({ status: "error", error: "multipart file is required" });
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
  },
);

app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ status: "error", error: "upload too large" });
  }
  return res
    .status(500)
    .json({ status: "error", error: err ? err.message : "unknown error" });
});

const heartbeatInterval = setInterval(() => {
  store.broadcastHeartbeat();
}, 30000);
const rateLimitCleanupInterval = setInterval(
  () => {
    limiter.cleanup();
  },
  Math.max(1000, Math.min(RATE_LIMIT_WINDOW_MS, 60_000)),
);

process.on("SIGINT", () => {
  clearInterval(heartbeatInterval);
  clearInterval(rateLimitCleanupInterval);
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearInterval(heartbeatInterval);
  clearInterval(rateLimitCleanupInterval);
  process.exit(0);
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[NovaBlox] RobloxStudioBridge listening on http://${HOST}:${PORT}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[NovaBlox] Security: auth=${AUTH_ENABLED ? "enabled" : "disabled"}` +
      ` bind_local_only=${BIND_LOCAL_ONLY ? "yes" : "no"}` +
      ` trust_proxy=${TRUST_PROXY ? "on" : "off"}` +
      ` unauth_remote=${AUTH_ENABLED ? "n/a" : ALLOW_UNAUTHENTICATED_REMOTE ? "allowed (UNSAFE)" : "blocked"}`,
  );
  if (!AUTH_ENABLED && !BIND_LOCAL_ONLY && ALLOW_UNAUTHENTICATED_REMOTE) {
    // eslint-disable-next-line no-console
    console.warn(
      "[NovaBlox] WARNING: unauthenticated remote access is enabled on a non-loopback bind host. " +
        "Use API keys or set ROBLOXBRIDGE_HOST=127.0.0.1.",
    );
  }
});
