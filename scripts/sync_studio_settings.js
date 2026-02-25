#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const env = {};
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
      env[key] = value;
    }
  }
  return env;
}

function readJsonOrEmpty(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (_err) {
    return {};
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function discoverSettingsFiles(robloxRoot) {
  const files = new Set();
  const stack = [robloxRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_err) {
      continue;
    }

    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (
        entry.isFile() &&
        entry.name === "settings.json" &&
        target.includes(`${path.sep}InstalledPlugins${path.sep}`)
      ) {
        files.add(target);
      }
    }
  }

  return files;
}

function discoverProfileSettingsFiles(robloxRoot) {
  const files = new Set();
  let entries = [];
  try {
    entries = fs.readdirSync(robloxRoot, { withFileTypes: true });
  } catch (_err) {
    return files;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!/^\d+$/.test(entry.name)) {
      continue;
    }
    files.add(
      path.join(
        robloxRoot,
        entry.name,
        "InstalledPlugins",
        "0",
        "settings.json",
      ),
    );
  }

  if (files.size === 0) {
    files.add(
      path.join(robloxRoot, "0", "InstalledPlugins", "0", "settings.json"),
    );
  }
  return files;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const env = Object.assign(
    {},
    loadEnvFile(path.join(repoRoot, ".env.example")),
    loadEnvFile(path.join(repoRoot, ".env")),
  );

  const host =
    process.env.ROBLOXBRIDGE_HOST || env.ROBLOXBRIDGE_HOST || "127.0.0.1";
  const port =
    process.env.ROBLOXBRIDGE_PORT || env.ROBLOXBRIDGE_PORT || "30010";
  const apiKey =
    process.env.ROBLOXBRIDGE_API_KEY || env.ROBLOXBRIDGE_API_KEY || "";
  const bridgeHost = `http://${host}:${port}`;

  const robloxRoot =
    process.env.NOVABLOX_ROBLOX_DIR ||
    path.join(os.homedir(), "Documents", "Roblox");
  if (!fs.existsSync(robloxRoot)) {
    process.stderr.write(
      `[studio-sync] Roblox settings directory not found: ${robloxRoot}\n`,
    );
    process.exit(1);
  }

  const targets = new Set([
    ...discoverSettingsFiles(robloxRoot),
    ...discoverProfileSettingsFiles(robloxRoot),
  ]);

  let updated = 0;
  for (const filePath of targets) {
    const settings = readJsonOrEmpty(filePath);
    settings.novablox_bridgeHost = bridgeHost;
    settings["novablox.bridgeHost"] = bridgeHost;
    settings.novablox_apiKey = apiKey;
    settings["novablox.apiKey"] = apiKey;
    writeJson(filePath, settings);
    process.stdout.write(`[studio-sync] updated ${filePath}\n`);
    updated += 1;
  }

  process.stdout.write(
    `[studio-sync] done. files=${updated} host=${bridgeHost} api_key_set=${apiKey.length > 0}\n`,
  );
  process.stdout.write(
    "[studio-sync] restart Roblox Studio to load updated plugin settings.\n",
  );
}

main();
