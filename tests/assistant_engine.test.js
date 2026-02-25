"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CommandStore } = require("../server/command_store");
const {
  buildPlan,
  normalizeExternalPlan,
  queuePlan,
  listTemplates,
} = require("../server/assistant_engine");

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
