"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CommandStore } = require("../server/command_store");
const {
  buildPlan,
  buildPlanWithAssistant,
  normalizeExternalPlan,
  queuePlan,
  listTemplates,
  __internal,
} = require("../server/assistant_engine");

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "ROBLOXBRIDGE_ASSISTANT_PROVIDER",
  "ROBLOXBRIDGE_ASSISTANT_OPENAI_MODEL",
];

function snapshotEnv() {
  const out = {};
  ENV_KEYS.forEach((key) => {
    out[key] = process.env[key];
  });
  return out;
}

function restoreEnv(snapshot) {
  ENV_KEYS.forEach((key) => {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  });
}

test("buildPlan auto-detects obstacle template deterministically", () => {
  const first = buildPlan({
    prompt: "Build a 12 platform obby with sunset vibes",
  });
  const second = buildPlan({
    prompt: "Build a 12 platform obby with sunset vibes",
  });

  assert.equal(first.workflow.template, "obstacle_course_builder");
  assert.equal(first.commands.length, second.commands.length);
  assert.deepEqual(first.commands, second.commands);
  assert.ok(first.commands.length >= 10);
});

test("buildPlan supports explicit lighting preset template", () => {
  const plan = buildPlan({
    prompt: "moody noir cinematic look",
    template: "lighting_mood_presets",
  });

  assert.equal(plan.workflow.template, "lighting_mood_presets");
  assert.ok(
    plan.commands.some(
      (cmd) => cmd.route === "/bridge/environment/set-lighting",
    ),
  );
  assert.ok(
    plan.commands.some((cmd) => cmd.route === "/bridge/environment/set-fog"),
  );
});

test("normalizeExternalPlan rejects unknown routes", () => {
  const invalid = normalizeExternalPlan({
    title: "bad",
    commands: [
      {
        route: "/bridge/unknown/route",
        payload: {},
      },
    ],
  });

  assert.equal(invalid, null);
});

test("queuePlan enqueues all plan commands", () => {
  const store = new CommandStore({
    leaseMs: 1000,
    maxRetention: 200,
    snapshotPath: null,
  });

  const plan = buildPlan({
    prompt: "Generate terrain island for prototype",
    template: "terrain_generator",
  });
  const queued = queuePlan(store, plan, {
    requested_by: "test-suite",
    client_hint: "assistant-tests",
    idempotency_prefix: "plan-test-1",
  });

  assert.equal(queued.queued_count, plan.commands.length);
  assert.equal(queued.command_ids.length, plan.commands.length);

  const summary = store.summary();
  assert.equal(summary.pending_count, plan.commands.length);
});

test("listTemplates exposes workflow templates", () => {
  const templates = listTemplates();
  const ids = templates.map((item) => item.id);
  assert.ok(ids.includes("obstacle_course_builder"));
  assert.ok(ids.includes("terrain_generator"));
  assert.ok(ids.includes("lighting_mood_presets"));
});

test(
  "buildPlanWithAssistant falls back when provider is unavailable",
  { concurrency: false },
  async () => {
    const env = snapshotEnv();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const result = await buildPlanWithAssistant({
        prompt: "build me an obby",
        provider: "openai",
        use_llm: true,
      });

      assert.equal(result.assistant.fallback, true);
      assert.equal(result.assistant.source, "deterministic");
      assert.ok(
        result.plan.warnings.some((warning) =>
          String(warning).includes("LLM fallback"),
        ),
      );
    } finally {
      restoreEnv(env);
      __internal.resetFetchImplementation();
    }
  },
);

test(
  "buildPlanWithAssistant accepts valid OpenAI-compatible JSON output",
  { concurrency: false },
  async () => {
    const env = snapshotEnv();
    process.env.OPENAI_API_KEY = "sk-test";

    __internal.setFetchImplementation(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "LLM Test Plan",
                  summary: "Test",
                  commands: [
                    {
                      route: "/bridge/scene/create-folder",
                      reason: "create workspace folder",
                      payload: { name: "LLMFolder", parent_path: "Workspace" },
                    },
                  ],
                }),
              },
            },
          ],
        }),
    }));

    try {
      const result = await buildPlanWithAssistant({
        prompt: "create a folder",
        provider: "openai",
        use_llm: true,
      });

      assert.equal(result.assistant.source, "openai");
      assert.equal(result.assistant.used_llm, true);
      assert.equal(result.plan.workflow.provider, "openai");
      assert.equal(result.plan.commands.length, 1);
      assert.equal(
        result.plan.commands[0].route,
        "/bridge/scene/create-folder",
      );
    } finally {
      restoreEnv(env);
      __internal.resetFetchImplementation();
    }
  },
);
