#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const CHECK_ONLY = process.argv.includes("--check-only");
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");

const PLUGIN_SOURCE = path.join(REPO_ROOT, "plugin", "RobloxStudioBridge.lua");
const PLUGIN_DEST = path.join(
  os.homedir(),
  "Documents",
  "Roblox",
  "Plugins",
  "NovaBlox.plugin.lua",
);

const summary = {
  ok: 0,
  warn: 0,
  error: 0,
  fixes: 0,
};

function print(message) {
  process.stdout.write(`${message}\n`);
}

function ok(message) {
  summary.ok += 1;
  print(`[doctor] ok: ${message}`);
}

function warn(message) {
  summary.warn += 1;
  print(`[doctor] warn: ${message}`);
}

function error(message) {
  summary.error += 1;
  print(`[doctor] error: ${message}`);
}

function fix(message) {
  summary.fixes += 1;
  print(`[doctor] fix: ${message}`);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const split = trimmed.indexOf("=");
    if (split <= 0) {
      continue;
    }
    const key = trimmed.slice(0, split).trim();
    const value = trimmed.slice(split + 1).trim();
    if (key) {
      out[key] = value;
    }
  }
  return out;
}

function resolveConfig() {
  const merged = Object.assign(
    {},
    loadEnvFile(ENV_EXAMPLE_PATH),
    loadEnvFile(ENV_PATH),
  );
  const host =
    process.env.ROBLOXBRIDGE_HOST || merged.ROBLOXBRIDGE_HOST || "127.0.0.1";
  const port =
    process.env.ROBLOXBRIDGE_PORT || merged.ROBLOXBRIDGE_PORT || "30010";
  const apiKey =
    process.env.ROBLOXBRIDGE_API_KEY || merged.ROBLOXBRIDGE_API_KEY || "";
  const baseUrl = (
    process.env.NOVABLOX_BASE ||
    process.env.BASE_URL ||
    `http://${host}:${port}`
  ).replace(/\/+$/, "");

  return {
    host,
    port,
    apiKey,
    baseUrl,
  };
}

function runCommand(command, args) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
}

function ensureApiKey(config) {
  if (config.apiKey) {
    ok(`API key found in .env (${config.apiKey.length} chars)`);
    return config;
  }

  if (CHECK_ONLY) {
    error("ROBLOXBRIDGE_API_KEY is missing. Run: npm run secure:local");
    return config;
  }

  const secureScript = path.join(REPO_ROOT, "scripts", "secure_local_env.sh");
  const result = runCommand("bash", [secureScript]);
  if (result.status !== 0) {
    error(
      `could not generate local API key: ${String(result.stderr || result.stdout || "").trim()}`,
    );
    return config;
  }
  fix("generated .env API key via secure:local");
  return resolveConfig();
}

function ensurePluginInstalled() {
  if (!fs.existsSync(PLUGIN_SOURCE)) {
    error(`plugin source missing: ${PLUGIN_SOURCE}`);
    return;
  }

  const sourceBody = fs.readFileSync(PLUGIN_SOURCE, "utf-8");
  const destExists = fs.existsSync(PLUGIN_DEST);
  const destBody = destExists ? fs.readFileSync(PLUGIN_DEST, "utf-8") : "";

  if (destExists && destBody === sourceBody) {
    ok(`local plugin is up to date (${PLUGIN_DEST})`);
    return;
  }

  if (CHECK_ONLY) {
    warn(`local plugin is missing/outdated (${PLUGIN_DEST})`);
    return;
  }

  fs.mkdirSync(path.dirname(PLUGIN_DEST), { recursive: true });
  fs.copyFileSync(PLUGIN_SOURCE, PLUGIN_DEST);
  fix(`installed/updated local plugin at ${PLUGIN_DEST}`);
}

function syncStudioSettings() {
  const syncScript = path.join(REPO_ROOT, "scripts", "sync_studio_settings.js");
  if (CHECK_ONLY) {
    ok("check-only mode: skipped writing Studio settings");
    return false;
  }
  const result = runCommand(process.execPath, [syncScript]);
  if (result.status !== 0) {
    warn(
      `could not sync Studio settings: ${String(result.stderr || result.stdout || "").trim()}`,
    );
    return false;
  }
  fix("synced Studio plugin host/API key settings");
  return true;
}

function requestJson(baseUrl, apiKey, method, route, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${baseUrl}${route}`);
    const hasBody =
      payload !== undefined &&
      payload !== null &&
      method !== "GET" &&
      method !== "HEAD";
    const body = hasBody ? JSON.stringify(payload) : null;
    const headers = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch (_err) {
              parsed = null;
            }
          }
          resolve({
            statusCode: res.statusCode || 0,
            body: parsed,
            raw,
          });
        });
      },
    );

    req.setTimeout(4000, () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkServer(config) {
  try {
    const health = await requestJson(
      config.baseUrl,
      "",
      "GET",
      "/bridge/health",
    );
    if (
      health.statusCode !== 200 ||
      !health.body ||
      health.body.status !== "ok"
    ) {
      error(`bridge health failed at ${config.baseUrl}/bridge/health`);
      return { serverUp: false, authOk: false };
    }
    ok(`bridge server reachable at ${config.baseUrl}`);
  } catch (err) {
    error(
      `bridge server unreachable at ${config.baseUrl} (${err.message}). Run: npm start`,
    );
    return { serverUp: false, authOk: false };
  }

  try {
    const stats = await requestJson(
      config.baseUrl,
      config.apiKey,
      "GET",
      "/bridge/stats",
    );
    if (stats.statusCode === 200) {
      ok("server auth check passed (/bridge/stats)");
      return { serverUp: true, authOk: true };
    }
    if (stats.statusCode === 401) {
      error(
        "server rejected API key (401 invalid API key). Restart server so it reloads .env",
      );
      return { serverUp: true, authOk: false };
    }
    const detail =
      stats.body && (stats.body.error || stats.body.status)
        ? `: ${stats.body.error || stats.body.status}`
        : "";
    error(`server auth check failed (${stats.statusCode})${detail}`);
    return { serverUp: true, authOk: false };
  } catch (err) {
    error(`server auth check failed (${err.message})`);
    return { serverUp: true, authOk: false };
  }
}

async function probeStudioPull(config, canAuth) {
  if (!canAuth) {
    return;
  }

  const probeName = `NovaBloxDoctorProbe_${crypto.randomUUID().slice(0, 8)}`;
  const probePayload = {
    route: "/bridge/test-spawn",
    action: "test-spawn",
    payload: {
      name: probeName,
      text: "NovaBlox Doctor",
      position: [0, 28, 0],
      color: "Bright green",
    },
    metadata: {
      requested_by: "doctor",
    },
    idempotency_key: `doctor-${crypto.randomUUID()}`,
  };

  let commandId = null;
  try {
    const queued = await requestJson(
      config.baseUrl,
      config.apiKey,
      "POST",
      "/bridge/command",
      probePayload,
    );
    if (
      queued.statusCode !== 200 ||
      !queued.body ||
      queued.body.status !== "queued" ||
      !queued.body.command_id
    ) {
      const detail =
        queued.body && (queued.body.error || queued.body.status)
          ? `: ${queued.body.error || queued.body.status}`
          : "";
      error(`failed to queue pull probe (${queued.statusCode})${detail}`);
      return;
    }
    commandId = queued.body.command_id;
    ok(`queued pull probe command (${commandId})`);
  } catch (err) {
    error(`failed to queue pull probe (${err.message})`);
    return;
  }

  const deadline = Date.now() + 12000;
  let lastStatus = "queued";
  while (Date.now() < deadline) {
    await sleep(1000);
    try {
      const statusRes = await requestJson(
        config.baseUrl,
        config.apiKey,
        "GET",
        `/bridge/commands/${encodeURIComponent(commandId)}`,
      );
      if (
        statusRes.statusCode !== 200 ||
        !statusRes.body ||
        !statusRes.body.command
      ) {
        continue;
      }
      const command = statusRes.body.command;
      lastStatus = command.status || lastStatus;
      if (command.status === "succeeded") {
        ok("Studio plugin pull/results path is healthy");
        if (!CHECK_ONLY) {
          try {
            await requestJson(
              config.baseUrl,
              config.apiKey,
              "POST",
              "/bridge/scene/delete-object",
              {
                target_name: probeName,
                idempotency_key: `doctor-cleanup-${commandId}`,
                metadata: { requested_by: "doctor-cleanup" },
              },
            );
            fix(`queued probe cleanup for ${probeName}`);
          } catch (_err) {
            warn(`probe cleanup queue failed for ${probeName}`);
          }
        }
        return;
      }
      if (
        command.status === "failed" ||
        command.status === "canceled" ||
        command.status === "expired"
      ) {
        error(`pull probe ${command.status}: ${command.error || "no details"}`);
        return;
      }
    } catch (_err) {
      // Keep polling until deadline.
    }
  }

  warn(
    `pull probe did not complete (last status: ${lastStatus}). Studio may be closed or plugin bridge disabled.`,
  );
  if (!CHECK_ONLY) {
    try {
      await requestJson(
        config.baseUrl,
        config.apiKey,
        "POST",
        `/bridge/commands/${encodeURIComponent(commandId)}/cancel`,
      );
      fix(`canceled stale probe command (${commandId})`);
    } catch (_err) {
      // Ignore cleanup errors.
    }
  }
}

async function main() {
  print(
    `[doctor] mode=${CHECK_ONLY ? "check-only" : "auto-fix"} repo=${REPO_ROOT}`,
  );

  if (!fs.existsSync(ENV_PATH) && !CHECK_ONLY) {
    const source = fs.existsSync(ENV_EXAMPLE_PATH) ? ENV_EXAMPLE_PATH : null;
    if (source) {
      fs.copyFileSync(source, ENV_PATH);
      fix(`created ${ENV_PATH} from .env.example`);
    }
  }

  let config = resolveConfig();
  config = ensureApiKey(config);

  ensurePluginInstalled();
  const syncedSettings = syncStudioSettings();

  config = resolveConfig();
  const server = await checkServer(config);
  await probeStudioPull(config, server.serverUp && server.authOk);

  print(
    `[doctor] summary ok=${summary.ok} warn=${summary.warn} error=${summary.error} fixes=${summary.fixes}`,
  );

  if (syncedSettings) {
    print(
      "[doctor] note: restart Roblox Studio if it was already open so new plugin settings load.",
    );
  }

  if (summary.error > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  error(`doctor crashed: ${err.message}`);
  print(
    `[doctor] summary ok=${summary.ok} warn=${summary.warn} error=${summary.error} fixes=${summary.fixes}`,
  );
  process.exitCode = 1;
});
