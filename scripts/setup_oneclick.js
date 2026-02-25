#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");

function print(message) {
  process.stdout.write(`${message}\n`);
}

function ensureEnvFile() {
  if (fs.existsSync(ENV_PATH)) {
    return;
  }
  if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
    throw new Error(".env.example is missing");
  }
  fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
  print("[setup] created .env from .env.example");
}

function loadEnv(filePath) {
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertEnvText(rawText, key, value) {
  const normalized = typeof rawText === "string" ? rawText : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${escapeRegex(key)}=.*$`, "m");
  if (pattern.test(normalized)) {
    return normalized.replace(pattern, line);
  }
  const trimmed = normalized.replace(/[\r\n]+$/, "");
  return `${trimmed}\n${line}\n`;
}

function writeEnvWithUpdates(updates) {
  let raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  for (const [key, value] of Object.entries(updates)) {
    raw = upsertEnvText(raw, key, value);
  }
  fs.writeFileSync(ENV_PATH, raw, "utf-8");
}

function generateBridgeApiKey() {
  return crypto.randomBytes(24).toString("hex");
}

function requestJson(urlText, timeoutMs = 2800) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlText);
    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: "GET",
        path: `${target.pathname}${target.search}`,
        headers: {
          Accept: "application/json",
        },
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
          resolve({ statusCode: res.statusCode || 0, body: parsed, raw });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function detectOllama(host) {
  const normalizedHost = String(host || "http://127.0.0.1:11434").replace(
    /\/+$/,
    "",
  );
  try {
    const response = await requestJson(`${normalizedHost}/api/tags`);
    if (response.statusCode !== 200 || !response.body) {
      return null;
    }
    const models = Array.isArray(response.body.models)
      ? response.body.models
      : [];
    if (models.length === 0) {
      return null;
    }
    const first =
      models.find((item) => item && typeof item.name === "string") || models[0];
    const modelName =
      first && typeof first.name === "string" ? first.name : "llama3.1:8b";
    return {
      kind: "ollama",
      baseUrl: `${normalizedHost}/v1`,
      model: modelName,
    };
  } catch (_err) {
    return null;
  }
}

async function detectLmStudio(baseUrl) {
  const normalizedBase = String(baseUrl || "http://127.0.0.1:1234/v1").replace(
    /\/+$/,
    "",
  );
  try {
    const response = await requestJson(`${normalizedBase}/models`);
    if (response.statusCode !== 200 || !response.body) {
      return null;
    }
    const models = Array.isArray(response.body.data) ? response.body.data : [];
    if (models.length === 0) {
      return null;
    }
    const first = models[0];
    const modelName =
      first && typeof first.id === "string" && first.id
        ? first.id
        : "local-model";
    return {
      kind: "lmstudio",
      baseUrl: normalizedBase,
      model: modelName,
    };
  } catch (_err) {
    return null;
  }
}

function runNodeScript(scriptFile) {
  const fullPath = path.join(__dirname, scriptFile);
  return spawnSync(process.execPath, [fullPath], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
}

function resolveProviderFromKeys(env, updates) {
  const openaiKey = String(env.OPENAI_API_KEY || "").trim();
  const openrouterKey = String(env.OPENROUTER_API_KEY || "").trim();
  const anthropicKey = String(env.ANTHROPIC_API_KEY || "").trim();
  const openaiBaseUrl = String(
    env.ROBLOXBRIDGE_ASSISTANT_OPENAI_BASE_URL || "",
  ).trim();

  if (openrouterKey) {
    updates.ROBLOXBRIDGE_ASSISTANT_PROVIDER = "openrouter";
    return { mode: "cloud-openrouter", provider: "openrouter" };
  }

  if (anthropicKey) {
    updates.ROBLOXBRIDGE_ASSISTANT_PROVIDER = "anthropic";
    return { mode: "cloud-anthropic", provider: "anthropic" };
  }

  if (openaiKey) {
    updates.ROBLOXBRIDGE_ASSISTANT_PROVIDER = "openai";
    if (openaiBaseUrl) {
      return {
        mode: "openai-compatible-custom",
        provider: "openai",
        baseUrl: openaiBaseUrl,
      };
    }
    return { mode: "cloud-openai", provider: "openai" };
  }

  if (openaiBaseUrl) {
    updates.OPENAI_API_KEY = "local-dev";
    updates.ROBLOXBRIDGE_ASSISTANT_PROVIDER = "openai";
    return {
      mode: "openai-compatible-custom",
      provider: "openai",
      baseUrl: openaiBaseUrl,
      model: String(env.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL || "").trim(),
    };
  }

  return null;
}

async function autoDetectLocalProvider(env, updates) {
  const ollamaHost = String(env.OLLAMA_HOST || "http://127.0.0.1:11434").trim();
  const ollama = await detectOllama(ollamaHost);
  if (ollama) {
    updates.ROBLOXBRIDGE_ASSISTANT_PROVIDER = "openai";
    updates.ROBLOXBRIDGE_ASSISTANT_OPENAI_BASE_URL = ollama.baseUrl;
    updates.OPENAI_API_KEY =
      String(env.OPENAI_API_KEY || "").trim() || "local-dev";
    if (!String(env.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL || "").trim()) {
      updates.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL = ollama.model;
    }
    return {
      mode: "local-ollama",
      provider: "openai",
      baseUrl: ollama.baseUrl,
      model:
        updates.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL ||
        String(env.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL || "").trim() ||
        ollama.model,
    };
  }

  const lmStudio = await detectLmStudio("http://127.0.0.1:1234/v1");
  if (lmStudio) {
    updates.ROBLOXBRIDGE_ASSISTANT_PROVIDER = "openai";
    updates.ROBLOXBRIDGE_ASSISTANT_OPENAI_BASE_URL = lmStudio.baseUrl;
    updates.OPENAI_API_KEY =
      String(env.OPENAI_API_KEY || "").trim() || "local-dev";
    if (!String(env.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL || "").trim()) {
      updates.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL = lmStudio.model;
    }
    return {
      mode: "local-lmstudio",
      provider: "openai",
      baseUrl: lmStudio.baseUrl,
      model:
        updates.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL ||
        String(env.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL || "").trim() ||
        lmStudio.model,
    };
  }

  updates.ROBLOXBRIDGE_ASSISTANT_PROVIDER = "deterministic";
  return {
    mode: "deterministic-only",
    provider: "deterministic",
  };
}

async function main() {
  ensureEnvFile();
  const env = loadEnv(ENV_PATH);

  const updates = {
    ROBLOXBRIDGE_HOST: "127.0.0.1",
  };

  const currentApiKey = String(env.ROBLOXBRIDGE_API_KEY || "").trim();
  if (!currentApiKey) {
    updates.ROBLOXBRIDGE_API_KEY = generateBridgeApiKey();
  }

  const baseResolution = resolveProviderFromKeys(env, updates);
  const providerResolution =
    baseResolution || (await autoDetectLocalProvider(env, updates));

  const timeoutRaw = Number.parseInt(
    String(env.ROBLOXBRIDGE_ASSISTANT_TIMEOUT_MS || ""),
    10,
  );
  if (!Number.isFinite(timeoutRaw) || timeoutRaw < 60000) {
    updates.ROBLOXBRIDGE_ASSISTANT_TIMEOUT_MS = "60000";
  }

  writeEnvWithUpdates(updates);

  print("[setup] one-click BYOK setup complete");
  print(`[setup] env=${ENV_PATH}`);
  print(`[setup] bridge_host=127.0.0.1`);
  print(
    `[setup] bridge_api_key=${
      (updates.ROBLOXBRIDGE_API_KEY || currentApiKey || "").length > 0
        ? "set"
        : "missing"
    }`,
  );
  print(`[setup] assistant_mode=${providerResolution.mode}`);
  print(`[setup] assistant_provider=${providerResolution.provider}`);
  if (providerResolution.baseUrl) {
    print(`[setup] openai_base_url=${providerResolution.baseUrl}`);
  }
  if (providerResolution.model) {
    print(`[setup] model=${providerResolution.model}`);
  }

  const sync = runNodeScript("sync_studio_settings.js");
  if (sync.status === 0) {
    print("[setup] studio settings synced (host/api key)");
  } else {
    const detail = String(sync.stderr || sync.stdout || "").trim();
    print(`[setup] warning: studio sync failed (${detail || "unknown"})`);
  }

  print("[setup] next:");
  print("[setup] 1) start/restart bridge: npm start");
  print("[setup] 2) restart Roblox Studio");
  print("[setup] 3) run: npm run doctor");
}

main().catch((err) => {
  process.stderr.write(`[setup] failed: ${err.message}\n`);
  process.exitCode = 1;
});
