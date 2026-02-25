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
const PROVIDER = (
  process.env.ULTIMATE_PROVIDER ||
  process.env.ROBLOXBRIDGE_ASSISTANT_PROVIDER ||
  envFile.ROBLOXBRIDGE_ASSISTANT_PROVIDER ||
  "openai"
)
  .trim()
  .toLowerCase();
const ASSISTANT_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(
    process.env.ULTIMATE_ASSISTANT_TIMEOUT_MS ||
      process.env.ROBLOXBRIDGE_ASSISTANT_TIMEOUT_MS ||
      envFile.ROBLOXBRIDGE_ASSISTANT_TIMEOUT_MS ||
      "60000",
    10,
  ) || 60_000,
);
const WAIT_TIMEOUT_MS = Math.max(
  20_000,
  Number.parseInt(process.env.ULTIMATE_WAIT_TIMEOUT_MS || "150000", 10) ||
    150_000,
);
const WAIT_INTERVAL_MS = Math.max(
  200,
  Number.parseInt(process.env.ULTIMATE_POLL_MS || "700", 10) || 700,
);
const ALLOW_FALLBACK =
  String(process.env.ULTIMATE_ALLOW_FALLBACK || "false")
    .trim()
    .toLowerCase() === "true";

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
          if ((res.statusCode || 0) >= 400) {
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
    if (!command) {
      await sleep(WAIT_INTERVAL_MS);
      continue;
    }
    if (command.status === "succeeded") {
      return { ok: true, command };
    }
    if (
      command.status === "failed" ||
      command.status === "canceled" ||
      command.status === "expired"
    ) {
      return { ok: false, command };
    }
    await sleep(WAIT_INTERVAL_MS);
  }
  return {
    ok: false,
    command: {
      id: commandId,
      status: "timeout",
      error: `timed out after ${WAIT_TIMEOUT_MS}ms`,
    },
  };
}

async function runStep(step, index, runId) {
  const requestBody = {
    prompt: step.prompt,
    use_llm: true,
    provider: PROVIDER,
    include_scene_context: true,
    allow_dangerous: false,
    timeout_ms: ASSISTANT_TIMEOUT_MS,
    idempotency_prefix: `ultimate-${runId}-${String(index + 1).padStart(2, "0")}`,
  };

  const queued = await request(
    "POST",
    "/bridge/assistant/execute",
    requestBody,
  );
  if (
    !queued ||
    queued.status !== "queued" ||
    !Array.isArray(queued.command_ids)
  ) {
    throw new Error(`invalid assistant execute response for step ${step.name}`);
  }

  process.stdout.write(
    `[ultimate] queued ${step.name} commands=${queued.queued_count} plan=${queued.plan_id}\n`,
  );

  const assistant = queued.assistant || {};
  const source = String(assistant.source || "unknown");
  const fallback = assistant.fallback === true;
  process.stdout.write(
    `[ultimate] assistant source=${source} fallback=${fallback ? "yes" : "no"}\n`,
  );

  if (fallback && !ALLOW_FALLBACK) {
    throw new Error(
      `assistant fallback detected on step ${step.name}: ${assistant.error || "unknown"}`,
    );
  }

  let successCount = 0;
  const failures = [];
  for (const commandId of queued.command_ids) {
    const outcome = await waitForCommand(commandId);
    if (outcome.ok) {
      successCount += 1;
      continue;
    }
    failures.push({
      id: outcome.command.id,
      action: outcome.command.action,
      status: outcome.command.status,
      error: outcome.command.error,
    });
  }

  process.stdout.write(
    `[ultimate] ${step.name} result succeeded=${successCount} failed=${failures.length}\n`,
  );

  return {
    step: step.name,
    queuedCount: queued.queued_count,
    successCount,
    failures,
    assistant,
    planId: queued.plan_id,
  };
}

async function main() {
  if (!API_KEY) {
    throw new Error(
      "ROBLOXBRIDGE_API_KEY is missing. Run npm run secure:local.",
    );
  }

  const runId = crypto.randomUUID().split("-")[0];
  process.stdout.write(
    `[ultimate] base=${BASE_URL} provider=${PROVIDER} run=${runId} timeout=${ASSISTANT_TIMEOUT_MS}ms\n`,
  );

  const health = await request("GET", "/bridge/health");
  if (!health || health.status !== "ok") {
    throw new Error("bridge health check failed");
  }

  const steps = [
    {
      name: "pirate-dock-core",
      prompt:
        "Create a new folder named NovaUltimateLive in Workspace and build a compact pirate dock scene with wooden planks, two lantern posts, and one lookout mast. Use ONLY /bridge/scene/create-folder and /bridge/scene/spawn-object routes.",
    },
    {
      name: "sunset-mood",
      prompt:
        "Apply dramatic sunset atmosphere for the whole scene. Use ONLY /bridge/environment/set-time, /bridge/environment/set-lighting, /bridge/environment/set-atmosphere, and /bridge/environment/set-fog routes.",
    },
    {
      name: "waypoint-markers",
      prompt:
        "Add five waypoint marker parts around the dock and mast using ONLY /bridge/scene/spawn-object. Keep all parts anchored and highly visible.",
    },
  ];

  const results = [];
  for (let i = 0; i < steps.length; i += 1) {
    const outcome = await runStep(steps[i], i, runId);
    results.push(outcome);
  }

  const stats = await request("GET", "/bridge/stats");
  const totalQueued = results.reduce((sum, item) => sum + item.queuedCount, 0);
  const totalSucceeded = results.reduce(
    (sum, item) => sum + item.successCount,
    0,
  );
  const totalFailed = results.reduce(
    (sum, item) => sum + item.failures.length,
    0,
  );

  process.stdout.write("[ultimate] complete\n");
  process.stdout.write(
    `${JSON.stringify(
      {
        status: totalFailed === 0 ? "ok" : "partial",
        provider: PROVIDER,
        run_id: runId,
        totals: {
          queued: totalQueued,
          succeeded: totalSucceeded,
          failed: totalFailed,
        },
        steps: results,
        stats: stats && stats.stats ? stats.stats : null,
      },
      null,
      2,
    )}\n`,
  );

  if (totalFailed > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  process.stderr.write(`[ultimate] failed: ${err.message}\n`);
  process.exitCode = 1;
});
