"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { CommandStore } = require("../server/command_store");

function makeStore(options = {}) {
  return new CommandStore(
    Object.assign(
      {
        leaseMs: 1000,
        maxRetention: 1000,
        snapshotPath: null,
      },
      options,
    ),
  );
}

test("enqueueWithMeta dedupes by idempotency key", () => {
  const store = makeStore();
  const first = store.enqueueWithMeta({
    route: "/bridge/scene/spawn-object",
    category: "scene",
    action: "spawn-object",
    payload: { name: "PartA" },
    idempotencyKey: "run-1-step-1",
  });
  const second = store.enqueueWithMeta({
    route: "/bridge/scene/spawn-object",
    category: "scene",
    action: "spawn-object",
    payload: { name: "PartA" },
    idempotencyKey: "run-1-step-1",
  });

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.command.id, second.command.id);
  assert.equal(store.summary().total_commands, 1);
});

test("expired commands are not dispatched", () => {
  const store = makeStore();
  const expiresAt = new Date(Date.now() - 60_000).toISOString();
  const queued = store.enqueueWithMeta({
    route: "/bridge/workspace/autosave",
    category: "workspace",
    action: "autosave",
    payload: {},
    expiresAt,
  });

  const pulled = store.dispatch("studio-a", 10);
  assert.equal(pulled.length, 0);

  const command = store.get(queued.command.id);
  assert.ok(command);
  assert.equal(command.status, "expired");
});

test("results enforce dispatch token and reject stale completions", () => {
  const store = makeStore();
  const queued = store.enqueueWithMeta({
    route: "/bridge/scene/spawn-object",
    category: "scene",
    action: "spawn-object",
    payload: { name: "TokenPart" },
  });

  const firstDispatch = store.dispatch("studio-a", 1)[0];
  const firstToken = firstDispatch.dispatch_token;
  assert.ok(firstToken);

  const requeueResult = store.requeue(queued.command.id);
  assert.equal(requeueResult.ok, true);

  const secondDispatch = store.dispatch("studio-b", 1)[0];
  const secondToken = secondDispatch.dispatch_token;
  assert.ok(secondToken);
  assert.notEqual(secondToken, firstToken);

  const stale = store.result({
    command_id: queued.command.id,
    dispatch_token: firstToken,
    ok: true,
    status: "ok",
    result: { stale: true },
  });
  assert.equal(stale.ok, false);

  const missingToken = store.result({
    command_id: queued.command.id,
    ok: true,
    status: "ok",
    result: { missing: true },
  });
  assert.equal(missingToken.ok, false);

  const fresh = store.result({
    command_id: queued.command.id,
    dispatch_token: secondToken,
    ok: true,
    status: "ok",
    execution_ms: 12.4,
    result: { fresh: true },
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.command.status, "succeeded");
  assert.equal(fresh.command.execution_ms, 12.4);
});

test("snapshot persistence restores queued and completed commands", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "novablox-store-test-"),
  );
  const snapshotPath = path.join(tempDir, "queue-snapshot.json");

  try {
    const writer = makeStore({ snapshotPath });
    const queued = writer.enqueueWithMeta({
      route: "/bridge/scene/spawn-object",
      category: "scene",
      action: "spawn-object",
      payload: { name: "PersistedPart" },
      idempotencyKey: "persist-k1",
    }).command;

    const dispatched = writer.dispatch("studio-persist", 1)[0];
    assert.equal(dispatched.id, queued.id);
    const saved = writer.result({
      command_id: queued.id,
      dispatch_token: dispatched.dispatch_token,
      ok: true,
      status: "ok",
      result: { persisted: true },
    });
    assert.equal(saved.ok, true);

    const reader = makeStore({ snapshotPath });
    const restored = reader.get(queued.id);
    assert.ok(restored);
    assert.equal(restored.status, "succeeded");
    assert.equal(restored.idempotency_key, "persist-k1");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resultBatch supports mixed outcomes and duplicate reporting", () => {
  const store = makeStore();
  const first = store.enqueueWithMeta({
    route: "/bridge/test-spawn",
    category: "test",
    action: "test-spawn",
    payload: { text: "A" },
  }).command;
  const second = store.enqueueWithMeta({
    route: "/bridge/test-spawn",
    category: "test",
    action: "test-spawn",
    payload: { text: "B" },
  }).command;

  const firstDispatch = store.dispatch("studio-a", 1)[0];
  const secondDispatch = store.dispatch("studio-a", 1)[0];

  const mixed = store.resultBatch([
    {
      command_id: first.id,
      dispatch_token: firstDispatch.dispatch_token,
      ok: true,
      status: "ok",
      result: { done: true },
    },
    {
      command_id: second.id,
      dispatch_token: "wrong-token",
      ok: true,
      status: "ok",
    },
  ]);

  assert.equal(mixed.ok, false);
  assert.equal(mixed.total_count, 2);
  assert.equal(mixed.success_count, 1);
  assert.equal(mixed.error_count, 1);
  assert.equal(mixed.duplicate_count, 0);

  const duplicate = store.resultBatch([
    {
      command_id: first.id,
      dispatch_token: firstDispatch.dispatch_token,
      ok: true,
      status: "ok",
      result: { duplicate: true },
    },
    {
      command_id: second.id,
      dispatch_token: secondDispatch.dispatch_token,
      ok: true,
      status: "ok",
      result: { done: true },
    },
  ]);

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.total_count, 2);
  assert.equal(duplicate.success_count, 2);
  assert.equal(duplicate.error_count, 0);
  assert.equal(duplicate.duplicate_count, 1);
});
