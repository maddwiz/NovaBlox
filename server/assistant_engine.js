"use strict";

const { createHash, randomUUID } = require("crypto");

const {
  listCommandCatalog,
  commandForRoute,
  riskForAction,
  riskRank,
} = require("./command_catalog");

const TEMPLATE_METADATA = Object.freeze({
  starter_scene: {
    id: "starter_scene",
    label: "Starter Scene",
    description: "Simple spawn + lighting baseline for quick validation.",
  },
  obstacle_course_builder: {
    id: "obstacle_course_builder",
    label: "Obstacle Course Builder",
    description: "Deterministic obby platform layout with start/goal markers.",
  },
  terrain_generator: {
    id: "terrain_generator",
    label: "Terrain Generator",
    description: "Terrain block, atmosphere, and basic lighting seed.",
  },
  lighting_mood_presets: {
    id: "lighting_mood_presets",
    label: "Lighting Mood Presets",
    description: "Fast mood setup: sunset, noir, neon, day, storm.",
  },
});

const TEMPLATE_ALIASES = Object.freeze({
  starter: "starter_scene",
  starter_scene: "starter_scene",
  default: "starter_scene",
  obstacle: "obstacle_course_builder",
  obby: "obstacle_course_builder",
  obstacle_course: "obstacle_course_builder",
  obstacle_course_builder: "obstacle_course_builder",
  terrain: "terrain_generator",
  terrain_generator: "terrain_generator",
  landscape: "terrain_generator",
  lighting: "lighting_mood_presets",
  mood: "lighting_mood_presets",
  lighting_mood_presets: "lighting_mood_presets",
});

const ROUTE_BY_ACTION = new Map();
for (const item of listCommandCatalog()) {
  if (item && item.action && item.route && !ROUTE_BY_ACTION.has(item.action)) {
    ROUTE_BY_ACTION.set(item.action, item.route);
  }
}

let fetchImplementation = (...args) => fetch(...args);

function setFetchImplementation(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation must be a function");
  }
  fetchImplementation = fetchImpl;
}

function resetFetchImplementation() {
  fetchImplementation = (...args) => fetch(...args);
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeProvider(value) {
  const provider = normalizeString(value).toLowerCase();
  if (
    provider === "openai" ||
    provider === "openrouter" ||
    provider === "anthropic" ||
    provider === "deterministic"
  ) {
    return provider;
  }
  if (provider === "auto" || provider === "llm") {
    return provider;
  }
  return "";
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function clampFloat(value, min, max, fallback) {
  const parsed = Number.parseFloat(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function safeJsonParse(text) {
  if (typeof text !== "string") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function extractFirstJsonObject(text) {
  const source = normalizeString(text);
  if (!source) {
    return null;
  }

  const direct = safeJsonParse(source);
  if (direct && typeof direct === "object") {
    return direct;
  }

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") {
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth += 1;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = source.slice(start, i + 1);
          const parsed = safeJsonParse(candidate);
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
        }
      }
    }
  }

  return null;
}

function deterministicNumber(seed, min, max) {
  const hash = createHash("sha1")
    .update(String(seed || "novablox"))
    .digest();
  const span = Math.max(1, max - min + 1);
  const n = hash.readUInt16BE(0) % span;
  return min + n;
}

function inferTemplate(prompt, explicitTemplate) {
  const explicit = normalizeString(explicitTemplate).toLowerCase();
  if (explicit && TEMPLATE_ALIASES[explicit]) {
    return TEMPLATE_ALIASES[explicit];
  }

  const text = normalizeString(prompt).toLowerCase();
  if (
    text.includes("obby") ||
    text.includes("obstacle") ||
    text.includes("parkour")
  ) {
    return "obstacle_course_builder";
  }
  if (
    text.includes("terrain") ||
    text.includes("mountain") ||
    text.includes("island") ||
    text.includes("biome")
  ) {
    return "terrain_generator";
  }
  if (
    text.includes("lighting") ||
    text.includes("mood") ||
    text.includes("atmosphere") ||
    text.includes("sunset")
  ) {
    return "lighting_mood_presets";
  }
  return "starter_scene";
}

function extractCount(prompt, fallback, min, max) {
  const text = normalizeString(prompt);
  const match = text.match(
    /(\d{1,3})\s*(?:platform|jump|stage|checkpoint|section)s?/i,
  );
  if (!match) {
    return fallback;
  }
  return clampInt(match[1], min, max, fallback);
}

function annotateCommand(route, payload, reason) {
  const entry = commandForRoute(route);
  if (!entry) {
    throw new Error(`unknown route in planner template: ${route}`);
  }
  return {
    route: entry.route,
    category: entry.category,
    action: entry.action,
    risk: entry.risk || riskForAction(entry.action),
    reason: reason || entry.summary,
    payload: payload || {},
  };
}

function createPartPayload(name, position, size, color, extra = {}) {
  return Object.assign(
    {
      class_name: "Part",
      name,
      position,
      size,
      color,
      anchored: true,
    },
    extra,
  );
}

function buildStarterSceneTemplate(prompt) {
  const suffix = deterministicNumber(`starter:${prompt}`, 100, 999);
  const folderName = `NovaBloxStarter_${suffix}`;
  return {
    title: "Starter Scene",
    summary:
      "Creates a tiny starter scene and applies a neutral daylight setup.",
    commands: [
      annotateCommand(
        "/bridge/scene/create-folder",
        { name: folderName, parent_path: "Workspace" },
        "Create folder for starter scene.",
      ),
      annotateCommand(
        "/bridge/scene/spawn-object",
        createPartPayload(
          "StarterFloor",
          [0, 2, 0],
          [24, 1, 24],
          "Medium stone grey",
          {
            parent_path: `Workspace/${folderName}`,
            material: "Concrete",
          },
        ),
        "Spawn the floor plate.",
      ),
      annotateCommand(
        "/bridge/scene/spawn-object",
        createPartPayload("StarterSpawn", [0, 5, 0], [6, 1, 6], "Lime green", {
          parent_path: `Workspace/${folderName}`,
          material: "Neon",
        }),
        "Spawn a visible start pad.",
      ),
      annotateCommand(
        "/bridge/environment/set-lighting",
        {
          brightness: 2.1,
          ambient: [160, 172, 186],
          exposure_compensation: 0.1,
        },
        "Apply neutral baseline lighting.",
      ),
      annotateCommand(
        "/bridge/environment/set-time",
        { clock_time: 14.5 },
        "Set bright daytime clock.",
      ),
    ],
  };
}

function buildObstacleTemplate(prompt) {
  const platformCount = extractCount(prompt, 10, 4, 30);
  const hardMode = /hard|difficult|challenge|insane/i.test(prompt);
  const easyMode = /easy|beginner|casual/i.test(prompt);

  const gap = hardMode ? 12 : easyMode ? 7 : 9;
  const verticalStep = hardMode ? 3.2 : easyMode ? 1.7 : 2.4;
  const laneOffset = deterministicNumber(`obby_lane:${prompt}`, -14, 14);
  const suffix = deterministicNumber(`obby:${prompt}`, 100, 999);
  const folderName = `NovaBloxObby_${suffix}`;

  const commands = [
    annotateCommand(
      "/bridge/scene/create-folder",
      { name: folderName, parent_path: "Workspace" },
      "Create obstacle course container.",
    ),
    annotateCommand(
      "/bridge/environment/set-time",
      { clock_time: 16.8 },
      "Set golden-hour visibility for obby readabilty.",
    ),
    annotateCommand(
      "/bridge/environment/set-lighting",
      {
        brightness: 2.35,
        ambient: [133, 150, 178],
        exposure_compensation: 0.12,
      },
      "Tune lighting to emphasize obstacle silhouettes.",
    ),
    annotateCommand(
      "/bridge/scene/spawn-object",
      createPartPayload(
        "ObbyStart",
        [0, 6, laneOffset],
        [10, 1.2, 10],
        "Lime green",
        {
          parent_path: `Workspace/${folderName}`,
          material: "Neon",
        },
      ),
      "Spawn start platform.",
    ),
  ];

  for (let i = 0; i < platformCount; i += 1) {
    const x = (i + 1) * gap;
    const y = 6 + (i + 1) * verticalStep;
    const z = laneOffset + (i % 2 === 0 ? 7 : -7);
    const color = i % 2 === 0 ? "Bright blue" : "Bright orange";
    commands.push(
      annotateCommand(
        "/bridge/scene/spawn-object",
        createPartPayload(`ObbyStep_${i + 1}`, [x, y, z], [8, 1, 8], color, {
          parent_path: `Workspace/${folderName}`,
          material: "SmoothPlastic",
        }),
        `Spawn jump platform ${i + 1}/${platformCount}.`,
      ),
    );
  }

  const goalX = (platformCount + 2) * gap;
  commands.push(
    annotateCommand(
      "/bridge/scene/spawn-object",
      createPartPayload(
        "ObbyGoal",
        [goalX, 6 + (platformCount + 2) * verticalStep, laneOffset],
        [10, 1.2, 10],
        "New Yeller",
        {
          parent_path: `Workspace/${folderName}`,
          material: "Neon",
        },
      ),
      "Spawn goal platform.",
    ),
  );

  commands.push(
    annotateCommand(
      "/bridge/script/insert-script",
      {
        parent_path: `Workspace/${folderName}`,
        name: "GoalSpin",
        source:
          "local p = script.Parent:FindFirstChild('ObbyGoal')\\nif p then while true do p.CFrame = p.CFrame * CFrame.Angles(0, math.rad(1), 0); task.wait(0.03) end end",
      },
      "Add lightweight visual motion on goal for player guidance.",
    ),
  );

  return {
    title: "Obstacle Course Builder",
    summary: `Builds a deterministic obby with ${platformCount} jump platforms and a visual goal marker.`,
    commands,
  };
}

function buildTerrainTemplate(prompt) {
  const text = normalizeString(prompt).toLowerCase();
  let material = "Grass";
  if (text.includes("desert")) {
    material = "Sand";
  } else if (text.includes("snow") || text.includes("ice")) {
    material = "Snow";
  } else if (text.includes("volcan")) {
    material = "Basalt";
  } else if (text.includes("moon")) {
    material = "Slate";
  }

  const large = /large|huge|massive|open world/i.test(text);
  const compact = /small|tiny|compact/i.test(text);
  const size = large
    ? [420, 120, 420]
    : compact
      ? [160, 48, 160]
      : [280, 80, 280];

  const fogEnd = material === "Sand" ? 460 : material === "Snow" ? 380 : 520;

  return {
    title: "Terrain Generator",
    summary: `Creates a ${material.toLowerCase()} terrain seed with matching atmosphere and lighting.`,
    commands: [
      annotateCommand(
        "/bridge/terrain/generate-terrain",
        { center: [0, 0, 0], size, material },
        "Generate primary terrain volume.",
      ),
      annotateCommand(
        "/bridge/environment/set-lighting",
        {
          brightness: 2.0,
          ambient: material === "Snow" ? [174, 186, 196] : [126, 139, 156],
          exposure_compensation: 0.05,
        },
        "Tune global lighting for selected biome.",
      ),
      annotateCommand(
        "/bridge/environment/set-atmosphere",
        {
          density:
            material === "Sand" ? 0.34 : material === "Snow" ? 0.42 : 0.28,
          color:
            material === "Sand"
              ? [248, 214, 152]
              : material === "Snow"
                ? [214, 229, 255]
                : [180, 210, 234],
        },
        "Apply atmosphere to improve depth perception.",
      ),
      annotateCommand(
        "/bridge/environment/set-time",
        { clock_time: material === "Snow" ? 11.2 : 15.4 },
        "Set biome-friendly time of day.",
      ),
      annotateCommand(
        "/bridge/environment/set-fog",
        {
          fog_start: 45,
          fog_end: fogEnd,
          fog_color: material === "Sand" ? [244, 205, 139] : [173, 195, 224],
        },
        "Set fog range to frame terrain scale.",
      ),
    ],
  };
}

function buildLightingPresetTemplate(prompt) {
  const text = normalizeString(prompt).toLowerCase();
  let mood = "day";
  if (text.includes("sunset") || text.includes("golden")) {
    mood = "sunset";
  } else if (
    text.includes("noir") ||
    text.includes("dark") ||
    text.includes("cinematic")
  ) {
    mood = "noir";
  } else if (text.includes("neon") || text.includes("cyber")) {
    mood = "neon";
  } else if (
    text.includes("storm") ||
    text.includes("rain") ||
    text.includes("moody")
  ) {
    mood = "storm";
  }

  const profiles = {
    day: {
      time: 13.0,
      lighting: {
        brightness: 2.3,
        ambient: [166, 184, 205],
        exposure_compensation: 0.12,
      },
      atmosphere: { density: 0.25, color: [183, 216, 247] },
      fog: { fog_start: 80, fog_end: 650, fog_color: [177, 209, 238] },
      summary: "Clean daytime baseline for gameplay prototyping.",
    },
    sunset: {
      time: 18.7,
      lighting: {
        brightness: 1.95,
        ambient: [165, 118, 96],
        exposure_compensation: -0.06,
      },
      atmosphere: { density: 0.39, color: [255, 174, 115] },
      fog: { fog_start: 45, fog_end: 430, fog_color: [236, 161, 116] },
      summary: "Warm late-afternoon cinematic palette.",
    },
    noir: {
      time: 22.4,
      lighting: {
        brightness: 0.95,
        ambient: [88, 94, 108],
        exposure_compensation: -0.32,
      },
      atmosphere: { density: 0.58, color: [123, 132, 154] },
      fog: { fog_start: 18, fog_end: 220, fog_color: [96, 102, 118] },
      summary: "Low-key night preset with strong contrast and fog.",
    },
    neon: {
      time: 20.8,
      lighting: {
        brightness: 1.4,
        ambient: [96, 122, 170],
        exposure_compensation: 0.0,
      },
      atmosphere: { density: 0.47, color: [111, 200, 235] },
      fog: { fog_start: 30, fog_end: 280, fog_color: [86, 164, 209] },
      summary: "Bold synthetic look for stylized worlds.",
    },
    storm: {
      time: 17.2,
      lighting: {
        brightness: 1.1,
        ambient: [90, 103, 121],
        exposure_compensation: -0.14,
      },
      atmosphere: { density: 0.62, color: [123, 145, 166] },
      fog: { fog_start: 16, fog_end: 180, fog_color: [115, 132, 153] },
      summary: "Heavy atmosphere preset for tense scenes.",
    },
  };

  const profile = profiles[mood];
  return {
    title: "Lighting Mood Presets",
    summary: `Applies ${mood} mood preset. ${profile.summary}`,
    commands: [
      annotateCommand(
        "/bridge/environment/set-time",
        { clock_time: profile.time },
        "Set mood clock time.",
      ),
      annotateCommand(
        "/bridge/environment/set-lighting",
        profile.lighting,
        "Apply lighting profile.",
      ),
      annotateCommand(
        "/bridge/environment/set-atmosphere",
        profile.atmosphere,
        "Apply atmosphere profile.",
      ),
      annotateCommand(
        "/bridge/environment/set-fog",
        profile.fog,
        "Apply fog profile.",
      ),
    ],
  };
}

function buildTemplate(templateId, prompt) {
  if (templateId === "obstacle_course_builder") {
    return buildObstacleTemplate(prompt);
  }
  if (templateId === "terrain_generator") {
    return buildTerrainTemplate(prompt);
  }
  if (templateId === "lighting_mood_presets") {
    return buildLightingPresetTemplate(prompt);
  }
  return buildStarterSceneTemplate(prompt);
}

function summarizeRisk(commands) {
  const summary = {
    safe: 0,
    caution: 0,
    dangerous: 0,
    max_risk: "safe",
  };
  for (const command of commands) {
    const risk = command.risk || "safe";
    if (risk === "dangerous") {
      summary.dangerous += 1;
    } else if (risk === "caution") {
      summary.caution += 1;
    } else {
      summary.safe += 1;
    }
    if (riskRank(risk) > riskRank(summary.max_risk)) {
      summary.max_risk = risk;
    }
  }
  return summary;
}

function buildWarnings(plan) {
  const warnings = [];
  if (plan.risk_summary.dangerous > 0) {
    warnings.push(
      "Plan includes dangerous actions. Require allow_dangerous=true before queueing.",
    );
  }
  if (
    plan.commands.some(
      (cmd) => cmd.action === "import-model" || cmd.action === "import-blender",
    )
  ) {
    warnings.push(
      "Local OBJ/FBX import can require manual Studio import UI on some builds.",
    );
  }
  if (
    plan.commands.some(
      (cmd) => cmd.action === "screenshot" || cmd.action === "render-frame",
    )
  ) {
    warnings.push(
      "Programmatic screenshot/render support depends on Studio build; external capture may be required.",
    );
  }
  return warnings;
}

function buildPlan(input = {}) {
  const prompt = normalizeString(input.prompt);
  const template = inferTemplate(prompt, input.template);
  const built = buildTemplate(template, prompt);

  const plan = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    workflow: {
      template,
      deterministic: true,
    },
    input: {
      prompt,
      template_requested: normalizeString(input.template) || null,
      voice_mode: input.voice_mode === true,
    },
    title: built.title,
    summary: built.summary,
    commands: built.commands,
  };

  plan.risk_summary = summarizeRisk(plan.commands);
  plan.warnings = buildWarnings(plan);
  return plan;
}

function inferAutoProvider() {
  if (normalizeString(process.env.OPENAI_API_KEY)) {
    return "openai";
  }
  if (normalizeString(process.env.OPENROUTER_API_KEY)) {
    return "openrouter";
  }
  if (normalizeString(process.env.ANTHROPIC_API_KEY)) {
    return "anthropic";
  }
  return "deterministic";
}

function resolveRequestedProvider(input = {}) {
  const explicit = normalizeProvider(input.provider);
  if (explicit && explicit !== "auto" && explicit !== "llm") {
    return explicit;
  }

  const useLlm = input.use_llm === true;
  if (explicit === "auto" || explicit === "llm" || useLlm) {
    const envProvider = normalizeProvider(
      process.env.ROBLOXBRIDGE_ASSISTANT_PROVIDER,
    );
    if (envProvider && envProvider !== "auto" && envProvider !== "llm") {
      return envProvider;
    }
    return inferAutoProvider();
  }

  return "deterministic";
}

function buildProviderConfig(input = {}) {
  const provider = resolveRequestedProvider(input);
  const timeoutMs = clampInt(
    input.timeout_ms || process.env.ROBLOXBRIDGE_ASSISTANT_TIMEOUT_MS,
    2000,
    120000,
    20000,
  );
  const temperature = clampFloat(
    input.temperature || process.env.ROBLOXBRIDGE_ASSISTANT_TEMPERATURE,
    0,
    1,
    0.15,
  );

  const config = {
    provider,
    timeout_ms: timeoutMs,
    temperature,
  };

  if (provider === "openai") {
    config.api_key = normalizeString(process.env.OPENAI_API_KEY);
    config.base_url =
      normalizeString(process.env.ROBLOXBRIDGE_ASSISTANT_OPENAI_BASE_URL) ||
      "https://api.openai.com/v1";
    config.model =
      normalizeString(input.model) ||
      normalizeString(process.env.ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL) ||
      "gpt-4.1-mini";
  } else if (provider === "openrouter") {
    config.api_key = normalizeString(process.env.OPENROUTER_API_KEY);
    config.base_url =
      normalizeString(process.env.ROBLOXBRIDGE_ASSISTANT_OPENROUTER_BASE_URL) ||
      "https://openrouter.ai/api/v1";
    config.model =
      normalizeString(input.model) ||
      normalizeString(process.env.ROBLOXBRIDGE_ASSISTANT_OPENROUTER_MODEL) ||
      "openai/gpt-4.1-mini";
    config.extra_headers = {};
    const referer = normalizeString(process.env.OPENROUTER_HTTP_REFERER);
    const title =
      normalizeString(process.env.OPENROUTER_APP_TITLE) || "NovaBlox";
    if (referer) {
      config.extra_headers["HTTP-Referer"] = referer;
    }
    if (title) {
      config.extra_headers["X-Title"] = title;
    }
  } else if (provider === "anthropic") {
    config.api_key = normalizeString(process.env.ANTHROPIC_API_KEY);
    config.base_url =
      normalizeString(process.env.ROBLOXBRIDGE_ASSISTANT_ANTHROPIC_BASE_URL) ||
      "https://api.anthropic.com";
    config.model =
      normalizeString(input.model) ||
      normalizeString(process.env.ROBLOXBRIDGE_ASSISTANT_ANTHROPIC_MODEL) ||
      "claude-3-5-sonnet-latest";
  }

  return config;
}

function shortenErrorDetail(raw, maxLength = 300) {
  const text = normalizeString(raw);
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

async function fetchJsonWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(url, {
      ...init,
      signal: controller.signal,
    });
    const rawText = await response.text();
    const parsed = safeJsonParse(rawText);
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${shortenErrorDetail(
          parsed ? JSON.stringify(parsed) : rawText,
        )}`,
      );
    }
    return parsed || {};
  } finally {
    clearTimeout(timer);
  }
}

function openAiMessageToText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if (typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function anthropicMessageToText(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function callOpenAiCompatiblePlan(systemPrompt, userPrompt, config) {
  if (!config.api_key) {
    throw new Error(`missing API key for provider ${config.provider}`);
  }
  const headers = Object.assign(
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.api_key}`,
    },
    config.extra_headers || {},
  );
  const baseUrl = String(config.base_url || "").replace(/\/+$/, "");
  const payload = await fetchJsonWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    config.timeout_ms,
  );
  const content = openAiMessageToText(
    payload &&
      payload.choices &&
      payload.choices[0] &&
      payload.choices[0].message
      ? payload.choices[0].message.content
      : "",
  );
  const parsed = extractFirstJsonObject(content);
  if (!parsed) {
    throw new Error("provider response did not contain valid JSON plan");
  }
  return parsed;
}

async function callAnthropicPlan(systemPrompt, userPrompt, config) {
  if (!config.api_key) {
    throw new Error("missing ANTHROPIC_API_KEY");
  }
  const baseUrl = String(config.base_url || "").replace(/\/+$/, "");
  const payload = await fetchJsonWithTimeout(
    `${baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        system: systemPrompt,
        max_tokens: 1400,
        temperature: config.temperature,
        messages: [{ role: "user", content: userPrompt }],
      }),
    },
    config.timeout_ms,
  );
  const parsed = extractFirstJsonObject(
    anthropicMessageToText(payload.content),
  );
  if (!parsed) {
    throw new Error("anthropic response did not contain valid JSON plan");
  }
  return parsed;
}

function buildPlannerSystemPrompt() {
  return [
    "You are NovaBlox assistant planner for Roblox Studio automation.",
    "Return JSON only. Do not include markdown, code fences, or prose.",
    "Use only routes that exist in command_catalog_json.",
    "Prefer safe/caution actions and avoid dangerous actions unless prompt explicitly requests them.",
    "Output schema:",
    "{",
    '  "title": "string",',
    '  "summary": "string",',
    '  "commands": [',
    '    { "route": "/bridge/...", "reason": "string", "payload": { "...": "..." } }',
    "  ]",
    "}",
  ].join("\n");
}

function buildPlannerUserPrompt(input) {
  return [
    `prompt=${normalizeString(input.prompt)}`,
    `template_requested=${normalizeString(input.template) || "auto"}`,
    `voice_mode=${input.voice_mode === true ? "true" : "false"}`,
    `allow_dangerous=${input.allow_dangerous === true ? "true" : "false"}`,
    "scene_context_json=",
    JSON.stringify(input.scene_context || {}, null, 2),
    "command_catalog_json=",
    JSON.stringify(input.catalog || [], null, 2),
  ].join("\n");
}

function resolveRouteFromLlmCommand(rawCommand) {
  const route = normalizeString(rawCommand && rawCommand.route);
  if (route) {
    const byRoute = commandForRoute(route);
    if (byRoute) {
      return byRoute.route;
    }
  }
  const action = normalizeString(rawCommand && rawCommand.action).toLowerCase();
  if (action && ROUTE_BY_ACTION.has(action)) {
    return ROUTE_BY_ACTION.get(action);
  }
  return null;
}

function normalizeLlmPlan(rawPlan, input = {}, source = "llm") {
  if (!rawPlan || typeof rawPlan !== "object") {
    return { plan: null, warnings: ["LLM response was not an object."] };
  }

  const rawCommands = Array.isArray(rawPlan.commands) ? rawPlan.commands : [];
  const maxCommands = clampInt(input.max_commands, 1, 80, 40);
  const commands = [];
  const warnings = [];
  let dropped = 0;

  for (const rawCommand of rawCommands) {
    if (commands.length >= maxCommands) {
      dropped += 1;
      continue;
    }
    const route = resolveRouteFromLlmCommand(rawCommand || {});
    if (!route) {
      dropped += 1;
      continue;
    }

    const entry = commandForRoute(route);
    if (!entry) {
      dropped += 1;
      continue;
    }

    commands.push({
      route: entry.route,
      category: entry.category,
      action: entry.action,
      risk: entry.risk || riskForAction(entry.action),
      reason:
        normalizeString(
          rawCommand &&
            (rawCommand.reason || rawCommand.summary || rawCommand.note),
        ) || entry.summary,
      payload:
        rawCommand &&
        rawCommand.payload &&
        typeof rawCommand.payload === "object" &&
        !Array.isArray(rawCommand.payload)
          ? rawCommand.payload
          : {},
    });
  }

  if (dropped > 0) {
    warnings.push(`Dropped ${dropped} unsupported or invalid LLM command(s).`);
  }
  if (commands.length === 0) {
    warnings.push("No valid commands were produced by LLM output.");
    return { plan: null, warnings };
  }

  const plan = {
    id:
      normalizeString(rawPlan.id || rawPlan.plan_id || rawPlan.planId) ||
      randomUUID(),
    created_at: new Date().toISOString(),
    workflow: {
      template:
        normalizeString(rawPlan.template || rawPlan.workflow_template) ||
        "llm_freeform",
      deterministic: false,
      provider: source,
    },
    input: {
      prompt: normalizeString(input.prompt),
      template_requested: normalizeString(input.template) || null,
      voice_mode: input.voice_mode === true,
    },
    title: normalizeString(rawPlan.title) || "LLM Assistant Plan",
    summary:
      normalizeString(rawPlan.summary) ||
      "LLM-generated Roblox Studio command sequence.",
    commands,
  };

  plan.risk_summary = summarizeRisk(plan.commands);
  plan.warnings = buildWarnings(plan).concat(warnings);
  return { plan, warnings };
}

async function buildPlanWithAssistant(input = {}) {
  const deterministicPlan = buildPlan(input);
  const config = buildProviderConfig(input);

  if (config.provider === "deterministic") {
    return {
      plan: deterministicPlan,
      assistant: {
        source: "deterministic",
        used_llm: false,
        fallback: false,
        provider_requested: normalizeString(input.provider) || null,
      },
    };
  }

  const systemPrompt = buildPlannerSystemPrompt();
  const userPrompt = buildPlannerUserPrompt({
    prompt: input.prompt,
    template: input.template,
    voice_mode: input.voice_mode === true,
    allow_dangerous: input.allow_dangerous === true,
    scene_context:
      input.scene_context && typeof input.scene_context === "object"
        ? input.scene_context
        : null,
    catalog: listCommandCatalog(),
  });

  try {
    let rawPlan = null;
    if (config.provider === "openai" || config.provider === "openrouter") {
      rawPlan = await callOpenAiCompatiblePlan(
        systemPrompt,
        userPrompt,
        config,
      );
    } else if (config.provider === "anthropic") {
      rawPlan = await callAnthropicPlan(systemPrompt, userPrompt, config);
    } else {
      throw new Error(`unsupported provider: ${config.provider}`);
    }

    const normalized = normalizeLlmPlan(rawPlan, input, config.provider);
    if (!normalized.plan) {
      throw new Error(normalized.warnings.join(" "));
    }

    return {
      plan: normalized.plan,
      assistant: {
        source: config.provider,
        used_llm: true,
        fallback: false,
        provider_requested: normalizeString(input.provider) || config.provider,
      },
    };
  } catch (error) {
    deterministicPlan.warnings = deterministicPlan.warnings.concat(
      `LLM fallback (${config.provider}): ${error.message}`,
    );
    deterministicPlan.workflow.provider = "deterministic";
    deterministicPlan.workflow.deterministic = true;
    return {
      plan: deterministicPlan,
      assistant: {
        source: "deterministic",
        used_llm: false,
        fallback: true,
        provider_requested: config.provider,
        error: String(error.message || error),
      },
    };
  }
}

function normalizeExternalPlan(rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object") {
    return null;
  }
  const rawCommands = Array.isArray(rawPlan.commands) ? rawPlan.commands : [];
  if (rawCommands.length === 0) {
    return null;
  }

  const commands = [];
  for (const raw of rawCommands) {
    const route = normalizeString(raw.route);
    const entry = commandForRoute(route);
    if (!entry) {
      return null;
    }
    commands.push({
      route: entry.route,
      category: entry.category,
      action: entry.action,
      risk: entry.risk || riskForAction(entry.action),
      reason: normalizeString(raw.reason) || entry.summary,
      payload:
        raw && typeof raw.payload === "object" && raw.payload !== null
          ? raw.payload
          : {},
    });
  }

  const plan = {
    id: normalizeString(rawPlan.id) || randomUUID(),
    created_at: normalizeString(rawPlan.created_at) || new Date().toISOString(),
    workflow: {
      template:
        normalizeString(rawPlan.workflow && rawPlan.workflow.template) ||
        "custom",
      deterministic: rawPlan.workflow
        ? rawPlan.workflow.deterministic === true
        : true,
    },
    input: {
      prompt: normalizeString(rawPlan.input && rawPlan.input.prompt),
      template_requested:
        normalizeString(rawPlan.input && rawPlan.input.template_requested) ||
        null,
      voice_mode: rawPlan.input ? rawPlan.input.voice_mode === true : false,
    },
    title: normalizeString(rawPlan.title) || "Custom Plan",
    summary: normalizeString(rawPlan.summary) || "User-provided command plan",
    commands,
  };
  plan.risk_summary = summarizeRisk(plan.commands);
  plan.warnings = buildWarnings(plan);
  return plan;
}

function queuePlan(store, plan, options = {}) {
  if (!plan || !Array.isArray(plan.commands) || plan.commands.length === 0) {
    return {
      queued_count: 0,
      deduped_count: 0,
      command_ids: [],
      queued: [],
    };
  }

  const now = Date.now();
  const expiresInMs = clampInt(
    options.expires_in_ms,
    0,
    24 * 60 * 60 * 1000,
    0,
  );
  const expiresAt =
    expiresInMs > 0 ? new Date(now + expiresInMs).toISOString() : null;
  const prefix = normalizeString(options.idempotency_prefix) || plan.id;

  const queued = [];
  let dedupedCount = 0;
  plan.commands.forEach((command, index) => {
    const metadata = Object.assign({}, options.metadata || {}, {
      planner: "novablox-assistant",
      planner_template:
        plan.workflow && plan.workflow.template
          ? plan.workflow.template
          : "custom",
      planner_title: plan.title,
      planner_step: index + 1,
      planner_steps_total: plan.commands.length,
      planner_risk: command.risk || "safe",
      requested_by: options.requested_by || "assistant",
      client_hint: options.client_hint || null,
    });

    const result = store.enqueueWithMeta({
      route: command.route,
      category: command.category,
      action: command.action,
      payload: command.payload || {},
      priority:
        command.risk === "dangerous" ? 6 : command.risk === "caution" ? 2 : 0,
      metadata,
      idempotencyKey: `${prefix}:${index + 1}:${command.action}`,
      expiresAt,
    });

    queued.push(result.command);
    if (result.deduped) {
      dedupedCount += 1;
    }
  });

  return {
    queued_count: queued.length,
    deduped_count: dedupedCount,
    command_ids: queued.map((item) => item.id),
    queued,
    expires_at: expiresAt,
  };
}

function listTemplates() {
  return Object.values(TEMPLATE_METADATA).map((item) => ({ ...item }));
}

module.exports = {
  TEMPLATE_METADATA,
  listTemplates,
  buildPlan,
  buildPlanWithAssistant,
  normalizeExternalPlan,
  queuePlan,
  listCommandCatalog,
  __internal: {
    safeJsonParse,
    extractFirstJsonObject,
    normalizeLlmPlan,
    resolveRequestedProvider,
    buildProviderConfig,
    setFetchImplementation,
    resetFetchImplementation,
  },
};
