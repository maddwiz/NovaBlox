#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const path = require("path");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const out = {};
  const raw = fs.readFileSync(filePath, "utf-8");
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

const envFile = loadDotEnv(path.resolve(__dirname, "..", ".env"));
const defaultHost =
  process.env.ROBLOXBRIDGE_HOST || envFile.ROBLOXBRIDGE_HOST || "127.0.0.1";
const defaultPort =
  process.env.ROBLOXBRIDGE_PORT || envFile.ROBLOXBRIDGE_PORT || "30010";
const BASE_URL = (
  process.env.NOVABLOX_BASE ||
  process.env.BASE_URL ||
  `http://${defaultHost}:${defaultPort}`
).replace(/\/+$/, "");
const API_KEY =
  process.env.ROBLOXBRIDGE_API_KEY || envFile.ROBLOXBRIDGE_API_KEY || "";
const WAIT_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.SHOWCASE_TIMEOUT_MS || "90000", 10) || 90000,
);
const WAIT_INTERVAL_MS = Math.max(
  200,
  Number.parseInt(process.env.SHOWCASE_POLL_MS || "700", 10) || 700,
);

function request(method, route, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${BASE_URL}${route}`);
    const body = payload ? JSON.stringify(payload) : null;
    const headers = {
      "Content-Type": "application/json",
    };
    if (API_KEY) {
      headers["X-API-Key"] = API_KEY;
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
        timeout: 30000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch (_err) {
              parsed = { raw: data };
            }
          }
          if (res.statusCode >= 400) {
            const message =
              parsed && parsed.error ? parsed.error : `HTTP ${res.statusCode}`;
            const err = new Error(message);
            err.statusCode = res.statusCode;
            err.payload = parsed;
            reject(err);
            return;
          }
          resolve(parsed || { status: "ok" });
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCommand(commandId) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await request(
      "GET",
      `/bridge/commands/${encodeURIComponent(commandId)}`,
    );
    const command = response && response.command ? response.command : null;
    const status = command ? command.status : null;
    if (status === "succeeded") {
      return command;
    }
    if (status === "failed" || status === "canceled" || status === "expired") {
      throw new Error(
        `command ${commandId} ${status}: ${command && command.error ? command.error : "no details"}`,
      );
    }
    await sleep(WAIT_INTERVAL_MS);
  }
  throw new Error(`timed out waiting for command ${commandId}`);
}

async function queueStep(step, index, runId) {
  const payload = Object.assign({}, step.payload || {}, {
    idempotency_key: `showcase-${runId}-${String(index + 1).padStart(2, "0")}`,
    priority: 25,
    metadata: {
      profile: "showcase",
      step: step.name,
    },
  });

  const queued = await request("POST", step.route, payload);
  if (!queued || queued.status !== "queued" || !queued.command_id) {
    throw new Error(`failed to queue ${step.name}`);
  }
  process.stdout.write(
    `[showcase] queued ${step.name} (${queued.command_id})\n`,
  );

  try {
    const finished = await waitForCommand(queued.command_id);
    process.stdout.write(`[showcase] ok ${step.name} (${finished.status})\n`);
    return finished;
  } catch (err) {
    if (step.allowFailure) {
      process.stdout.write(`[showcase] skipped ${step.name}: ${err.message}\n`);
      return null;
    }
    throw err;
  }
}

async function main() {
  const runId = crypto.randomUUID().split("-")[0];
  process.stdout.write(`[showcase] base=${BASE_URL} run=${runId}\n`);

  const health = await request("GET", "/bridge/health");
  if (!health || health.status !== "ok") {
    throw new Error("bridge health check failed");
  }

  const steps = [
    {
      name: "cleanup-old-showcase",
      route: "/bridge/scene/delete-object",
      allowFailure: true,
      payload: { target_name: "NovaShowcase" },
    },
    {
      name: "create-folder",
      route: "/bridge/scene/create-folder",
      payload: { name: "NovaShowcase", parent_path: "Workspace" },
    },
    {
      name: "terrain-base",
      route: "/bridge/terrain/generate-terrain",
      payload: {
        center: [0, -4, 0],
        size: [900, 12, 900],
        material: "Grass",
      },
    },
    {
      name: "set-lighting",
      route: "/bridge/environment/set-lighting",
      payload: {
        brightness: 2.8,
        exposure_compensation: 0.2,
        ambient: [0.08, 0.09, 0.12],
      },
    },
    {
      name: "set-atmosphere",
      route: "/bridge/environment/set-atmosphere",
      payload: {
        density: 0.35,
        color: [0.72, 0.84, 1.0],
      },
    },
    {
      name: "set-time",
      route: "/bridge/environment/set-time",
      payload: {
        clock_time: 17.5,
      },
    },
    {
      name: "spawn-platform",
      route: "/bridge/scene/spawn-object",
      payload: {
        class_name: "Part",
        name: "ShowcasePlatform",
        parent_path: "Workspace/NovaShowcase",
        position: [0, 8, 0],
        size: [220, 2, 220],
        color: "Dark stone grey",
        material: "Slate",
        anchored: true,
      },
    },
    {
      name: "spawn-tower",
      route: "/bridge/scene/spawn-object",
      payload: {
        class_name: "Part",
        name: "ShowcaseTower",
        parent_path: "Workspace/NovaShowcase",
        position: [0, 22, 0],
        size: [18, 28, 18],
        color: "Institutional white",
        material: "Concrete",
        anchored: true,
      },
    },
    {
      name: "spawn-beacon",
      route: "/bridge/scene/spawn-object",
      payload: {
        class_name: "Part",
        name: "ShowcaseBeacon",
        parent_path: "Workspace/NovaShowcase",
        position: [0, 42, 0],
        size: [20, 2, 20],
        color: "Bright blue",
        material: "Neon",
        anchored: true,
      },
    },
    {
      name: "insert-rotation-script",
      route: "/bridge/script/insert-script",
      payload: {
        name: "ShowcaseSpinController",
        parent_path: "Workspace/NovaShowcase",
        source: [
          "local folder = script.Parent",
          'local beacon = folder:FindFirstChild("ShowcaseBeacon")',
          'if beacon and beacon:IsA("BasePart") then',
          "  while task.wait(0.03) do",
          "    beacon.CFrame = beacon.CFrame * CFrame.Angles(0, math.rad(1.5), 0)",
          "  end",
          "end",
        ].join("\\n"),
      },
    },
    {
      name: "frame-camera",
      route: "/bridge/viewport/set-camera",
      payload: {
        position: [120, 70, 120],
        look_at: [0, 18, 0],
        field_of_view: 50,
      },
    },
    {
      name: "connectivity-marker",
      route: "/bridge/test-spawn",
      payload: {
        text: "NovaBlox Showcase Ready",
        position: [0, 48, 0],
        color: "Bright bluish green",
      },
    },
  ];

  for (let i = 0; i < steps.length; i += 1) {
    await queueStep(steps[i], i, runId);
  }

  const stats = await request("GET", "/bridge/stats");
  process.stdout.write("[showcase] complete\n");
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`[showcase] failed: ${err.message}\n`);
  process.exit(1);
});
