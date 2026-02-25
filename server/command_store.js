"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const SNAPSHOT_VERSION = 1;
const DEFAULT_STATS = Object.freeze({
  queued_total: 0,
  dispatched_total: 0,
  succeeded_total: 0,
  failed_total: 0,
  canceled_total: 0,
  expired_total: 0,
  requeued_total: 0,
  rejected_results_total: 0,
});

class CommandStore {
  constructor(options = {}) {
    this.leaseMs = Number.isFinite(options.leaseMs) ? options.leaseMs : 120000;
    this.maxRetention = Number.isFinite(options.maxRetention)
      ? options.maxRetention
      : 10000;
    this.snapshotPath =
      typeof options.snapshotPath === "string" &&
      options.snapshotPath.trim() !== ""
        ? options.snapshotPath
        : null;

    this.commands = new Map();
    this.pending = [];
    this.idempotencyIndex = new Map();
    this.sseClients = new Map();
    this.stats = Object.assign({}, DEFAULT_STATS);

    this._loadSnapshot();
    this._requeueExpired();
    if (this._pruneIfNeeded()) {
      this._persist();
    }
  }

  enqueue(commandInput) {
    return this.enqueueWithMeta(commandInput).command;
  }

  enqueueWithMeta(commandInput) {
    const now = Date.now();
    const idempotencyKey = this._normalizeIdempotencyKey(
      commandInput.idempotencyKey,
    );
    if (idempotencyKey) {
      const existingId = this.idempotencyIndex.get(idempotencyKey);
      const existing = existingId ? this.commands.get(existingId) : null;
      if (existing) {
        return { command: existing, deduped: true };
      }
      this.idempotencyIndex.delete(idempotencyKey);
    }

    const command = {
      id: randomUUID(),
      route: commandInput.route,
      category: commandInput.category || "generic",
      action: commandInput.action || "command",
      payload: commandInput.payload || {},
      priority: Number.isFinite(commandInput.priority)
        ? commandInput.priority
        : 0,
      metadata: commandInput.metadata || {},
      status: "queued",
      attempts: 0,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      dispatched_at: null,
      dispatch_token: null,
      lease_expires_at: null,
      completed_at: null,
      delivered_to: null,
      result: null,
      error: null,
      execution_ms: null,
      idempotency_key: idempotencyKey,
      expires_at: this._normalizeExpiresAt(commandInput.expiresAt, now),
    };

    this.commands.set(command.id, command);
    if (command.idempotency_key) {
      this.idempotencyIndex.set(command.idempotency_key, command.id);
    }
    this.pending.push(command.id);
    this._sortPending();
    this.stats.queued_total += 1;
    this._pruneIfNeeded();
    this._broadcast("queued", {
      id: command.id,
      category: command.category,
      action: command.action,
      route: command.route,
      created_at: command.created_at,
      expires_at: command.expires_at,
      deduped: false,
    });
    this._persist();
    return { command, deduped: false };
  }

  enqueueBatch(items) {
    return items.map((item) => this.enqueue(item));
  }

  enqueueBatchWithMeta(items) {
    return items.map((item) => this.enqueueWithMeta(item));
  }

  dispatch(clientId, limit) {
    this._requeueExpired();
    const max = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
    const out = [];
    const now = Date.now();

    while (out.length < max && this.pending.length > 0) {
      const id = this.pending.shift();
      const cmd = this.commands.get(id);
      if (!cmd || cmd.status !== "queued") {
        continue;
      }
      if (this._isExpired(cmd, now)) {
        this._expireCommand(cmd, now);
        continue;
      }
      cmd.status = "dispatched";
      cmd.delivered_to = clientId;
      cmd.dispatched_at = new Date(now).toISOString();
      cmd.dispatch_token = randomUUID();
      cmd.lease_expires_at = new Date(now + this.leaseMs).toISOString();
      cmd.updated_at = new Date(now).toISOString();
      cmd.attempts += 1;
      this.stats.dispatched_total += 1;
      out.push(cmd);
    }

    if (out.length > 0) {
      this._broadcast("dispatched", {
        client_id: clientId,
        count: out.length,
        ids: out.map((c) => c.id),
      });
      this._persist();
    }

    return out;
  }

  result(input) {
    const id = input.command_id || input.id;
    if (!id) {
      this.stats.rejected_results_total += 1;
      return { ok: false, error: "command_id is required" };
    }
    const cmd = this.commands.get(id);
    if (!cmd) {
      this.stats.rejected_results_total += 1;
      return { ok: false, error: `command ${id} not found` };
    }

    if (cmd.status === "succeeded" || cmd.status === "failed") {
      return { ok: true, duplicate: true, command: cmd };
    }
    if (cmd.status === "canceled" || cmd.status === "expired") {
      this.stats.rejected_results_total += 1;
      return { ok: false, error: `command ${id} is ${cmd.status}` };
    }
    if (cmd.status !== "dispatched") {
      this.stats.rejected_results_total += 1;
      return { ok: false, error: `command ${id} is not in dispatched state` };
    }

    const incomingDispatchToken = this._normalizeDispatchToken(
      input.dispatch_token,
    );
    if (cmd.dispatch_token && !incomingDispatchToken) {
      this.stats.rejected_results_total += 1;
      return {
        ok: false,
        error: `dispatch_token is required for command ${id}`,
      };
    }
    if (
      cmd.dispatch_token &&
      incomingDispatchToken &&
      incomingDispatchToken !== cmd.dispatch_token
    ) {
      this.stats.rejected_results_total += 1;
      return {
        ok: false,
        error: `dispatch token mismatch for command ${id}`,
      };
    }

    const now = Date.now();
    const resultOk =
      input.ok === true || String(input.status || "").toLowerCase() === "ok";
    const shouldRequeue = input.requeue === true;

    cmd.result = input.result || null;
    cmd.error = input.error || null;
    cmd.execution_ms = this._normalizeExecutionMs(
      input.execution_ms,
      cmd.execution_ms,
    );
    cmd.updated_at = new Date(now).toISOString();

    if (shouldRequeue) {
      if (this._isExpired(cmd, now)) {
        this._expireCommand(cmd, now);
        this._persist();
        return {
          ok: false,
          error: `command ${id} is expired and cannot be requeued`,
        };
      }
      cmd.status = "queued";
      cmd.delivered_to = null;
      cmd.dispatch_token = null;
      cmd.lease_expires_at = null;
      cmd.updated_at = new Date(now).toISOString();
      this.pending.push(cmd.id);
      this._sortPending();
      this.stats.requeued_total += 1;
      this._broadcast("requeued", { id: cmd.id, attempts: cmd.attempts });
      this._persist();
      return { ok: true, command: cmd };
    }

    cmd.status = resultOk ? "succeeded" : "failed";
    cmd.completed_at = new Date(now).toISOString();
    cmd.lease_expires_at = null;
    cmd.dispatch_token = null;
    if (resultOk) {
      this.stats.succeeded_total += 1;
    } else {
      this.stats.failed_total += 1;
    }
    this._broadcast(resultOk ? "succeeded" : "failed", {
      id: cmd.id,
      error: cmd.error,
      execution_ms: cmd.execution_ms,
    });
    this._persist();
    return { ok: true, command: cmd };
  }

  resultBatch(items) {
    const inputs = Array.isArray(items) ? items : [];
    const outcomes = [];
    let successCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;

    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index] || {};
      const result = this.result(input);
      if (result.ok) {
        successCount += 1;
        if (result.duplicate === true) {
          duplicateCount += 1;
        }
        outcomes.push({
          index,
          ok: true,
          duplicate: result.duplicate === true,
          command: result.command,
        });
      } else {
        errorCount += 1;
        outcomes.push({
          index,
          ok: false,
          command_id: input.command_id || input.id || null,
          error: result.error,
        });
      }
    }

    return {
      ok: errorCount === 0,
      total_count: inputs.length,
      success_count: successCount,
      error_count: errorCount,
      duplicate_count: duplicateCount,
      outcomes,
    };
  }

  cancel(id) {
    const cmd = this.commands.get(id);
    if (!cmd) {
      return { ok: false, error: `command ${id} not found` };
    }
    if (
      cmd.status === "succeeded" ||
      cmd.status === "failed" ||
      cmd.status === "expired" ||
      cmd.status === "canceled"
    ) {
      return { ok: false, error: `command ${id} already completed` };
    }
    cmd.status = "canceled";
    cmd.updated_at = new Date().toISOString();
    cmd.completed_at = cmd.updated_at;
    cmd.lease_expires_at = null;
    cmd.dispatch_token = null;
    this.pending = this.pending.filter((pendingId) => pendingId !== id);
    this.stats.canceled_total += 1;
    this._broadcast("canceled", { id: cmd.id });
    this._persist();
    return { ok: true, command: cmd };
  }

  requeue(id) {
    const cmd = this.commands.get(id);
    if (!cmd) {
      return { ok: false, error: `command ${id} not found` };
    }
    if (cmd.status === "queued") {
      return { ok: true, command: cmd };
    }
    if (cmd.status === "canceled" || cmd.status === "expired") {
      return { ok: false, error: `command ${id} is ${cmd.status}` };
    }
    if (this._isExpired(cmd, Date.now())) {
      this._expireCommand(cmd, Date.now());
      this._persist();
      return { ok: false, error: `command ${id} is expired` };
    }
    cmd.status = "queued";
    cmd.updated_at = new Date().toISOString();
    cmd.lease_expires_at = null;
    cmd.delivered_to = null;
    cmd.dispatch_token = null;
    cmd.error = null;
    this.pending.push(id);
    this._sortPending();
    this.stats.requeued_total += 1;
    this._broadcast("requeued", { id: cmd.id });
    this._persist();
    return { ok: true, command: cmd };
  }

  get(id) {
    return this.commands.get(id) || null;
  }

  listRecent(limit = 100) {
    const max = Math.max(1, Math.min(500, Number(limit) || 100));
    return Array.from(this.commands.values())
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, max);
  }

  summary() {
    this._requeueExpired();
    const byStatus = {
      queued: 0,
      dispatched: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
      expired: 0,
    };

    let executionCount = 0;
    let executionTotalMs = 0;
    for (const cmd of this.commands.values()) {
      byStatus[cmd.status] = (byStatus[cmd.status] || 0) + 1;
      if (Number.isFinite(cmd.execution_ms)) {
        executionCount += 1;
        executionTotalMs += cmd.execution_ms;
      }
    }

    return {
      total_commands: this.commands.size,
      pending_count: this.pending.length,
      by_status: byStatus,
      counters: this.stats,
      sse_clients: this.sseClients.size,
      lease_ms: this.leaseMs,
      average_execution_ms:
        executionCount > 0
          ? Math.round((executionTotalMs / executionCount) * 100) / 100
          : null,
      persisted_snapshot: this.snapshotPath,
    };
  }

  addSseClient(clientId, res) {
    this.sseClients.set(res, {
      clientId,
      connectedAt: new Date().toISOString(),
    });
  }

  removeSseClient(res) {
    this.sseClients.delete(res);
  }

  broadcastHeartbeat() {
    this._broadcast("heartbeat", { ts: new Date().toISOString() });
  }

  _sortPending() {
    this.pending.sort((left, right) => {
      const a = this.commands.get(left);
      const b = this.commands.get(right);
      if (!a || !b) {
        return 0;
      }
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.created_at.localeCompare(b.created_at);
    });
  }

  _requeueExpired() {
    const now = Date.now();
    let mutated = false;

    for (const cmd of this.commands.values()) {
      if (cmd.status === "queued" && this._isExpired(cmd, now)) {
        this._expireCommand(cmd, now);
        mutated = true;
        continue;
      }

      if (cmd.status !== "dispatched" || !cmd.lease_expires_at) {
        continue;
      }

      const leaseExpiresAt = Date.parse(cmd.lease_expires_at);
      if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt > now) {
        continue;
      }

      if (this._isExpired(cmd, now)) {
        this._expireCommand(cmd, now);
        mutated = true;
        continue;
      }

      cmd.status = "queued";
      cmd.updated_at = new Date(now).toISOString();
      cmd.lease_expires_at = null;
      cmd.dispatch_token = null;
      cmd.delivered_to = null;
      this.pending.push(cmd.id);
      this.stats.requeued_total += 1;
      this._broadcast("lease-expired", { id: cmd.id, attempts: cmd.attempts });
      mutated = true;
    }

    if (mutated) {
      this._sortPending();
      this._persist();
    }
  }

  _pruneIfNeeded() {
    if (this.commands.size <= this.maxRetention) {
      return false;
    }

    const completed = Array.from(this.commands.values())
      .filter(
        (cmd) =>
          cmd.status === "succeeded" ||
          cmd.status === "failed" ||
          cmd.status === "canceled" ||
          cmd.status === "expired",
      )
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));

    const pruneCount = this.commands.size - this.maxRetention;
    let pruned = 0;
    for (let i = 0; i < pruneCount && i < completed.length; i += 1) {
      const id = completed[i].id;
      this.commands.delete(id);
      this._deleteIdempotencyForCommandId(id);
      pruned += 1;
    }

    if (pruned > 0) {
      this.pending = this.pending.filter((pendingId) =>
        this.commands.has(pendingId),
      );
      return true;
    }
    return false;
  }

  _broadcast(event, payload) {
    const data = JSON.stringify(payload || {});
    for (const [res] of this.sseClients.entries()) {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${data}\n\n`);
      } catch (_err) {
        this.sseClients.delete(res);
      }
    }
  }

  _expireCommand(cmd, now) {
    if (cmd.status === "expired") {
      return;
    }
    cmd.status = "expired";
    cmd.updated_at = new Date(now).toISOString();
    cmd.completed_at = cmd.updated_at;
    cmd.lease_expires_at = null;
    cmd.dispatch_token = null;
    cmd.delivered_to = null;
    cmd.error = cmd.error || "command expired before execution";
    this.pending = this.pending.filter((pendingId) => pendingId !== cmd.id);
    this.stats.expired_total += 1;
    this._broadcast("expired", { id: cmd.id, expires_at: cmd.expires_at });
  }

  _normalizeExpiresAt(value, now = Date.now()) {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    let ts = null;
    if (typeof value === "number" && Number.isFinite(value)) {
      ts = value;
    } else if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        ts = parsed;
      }
    } else if (value instanceof Date) {
      ts = value.getTime();
    }

    if (!Number.isFinite(ts)) {
      return null;
    }
    if (ts <= now) {
      return new Date(now).toISOString();
    }
    return new Date(ts).toISOString();
  }

  _normalizeIdempotencyKey(value) {
    if (value === undefined || value === null) {
      return null;
    }
    const normalized = String(value).trim();
    if (normalized === "") {
      return null;
    }
    return normalized.slice(0, 256);
  }

  _normalizeDispatchToken(value) {
    if (value === undefined || value === null) {
      return null;
    }
    const normalized = String(value).trim();
    return normalized === "" ? null : normalized;
  }

  _normalizeExecutionMs(value, fallback = null) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return Math.round(parsed * 1000) / 1000;
  }

  _isExpired(cmd, now = Date.now()) {
    if (!cmd || !cmd.expires_at) {
      return false;
    }
    const expiresTs = Date.parse(cmd.expires_at);
    if (!Number.isFinite(expiresTs)) {
      return false;
    }
    return expiresTs <= now;
  }

  _deleteIdempotencyForCommandId(commandId) {
    for (const [key, id] of this.idempotencyIndex.entries()) {
      if (id === commandId) {
        this.idempotencyIndex.delete(key);
      }
    }
  }

  _loadSnapshot() {
    if (!this.snapshotPath) {
      return;
    }
    if (!fs.existsSync(this.snapshotPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.snapshotPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== SNAPSHOT_VERSION) {
        return;
      }

      this.commands = new Map();
      const rows = Array.isArray(parsed.commands) ? parsed.commands : [];
      for (const row of rows) {
        if (!row || typeof row.id !== "string") {
          continue;
        }
        this.commands.set(row.id, row);
      }

      this.pending = Array.isArray(parsed.pending)
        ? parsed.pending.filter((id) => {
            const cmd = this.commands.get(id);
            return Boolean(cmd && cmd.status === "queued");
          })
        : [];

      this.stats = Object.assign({}, DEFAULT_STATS, parsed.stats || {});
      this.idempotencyIndex = new Map();

      const fromSnapshot = Array.isArray(parsed.idempotency)
        ? parsed.idempotency
        : [];
      for (const pair of fromSnapshot) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          continue;
        }
        const key = this._normalizeIdempotencyKey(pair[0]);
        const id = String(pair[1] || "");
        if (key && id && this.commands.has(id)) {
          this.idempotencyIndex.set(key, id);
        }
      }

      // Rebuild missing index entries if snapshot came from older format.
      for (const cmd of this.commands.values()) {
        const key = this._normalizeIdempotencyKey(cmd.idempotency_key);
        if (key && !this.idempotencyIndex.has(key)) {
          this.idempotencyIndex.set(key, cmd.id);
        }
      }

      this._sortPending();
    } catch (_err) {
      // Ignore invalid snapshots and continue with a clean in-memory store.
      this.commands = new Map();
      this.pending = [];
      this.idempotencyIndex = new Map();
      this.stats = Object.assign({}, DEFAULT_STATS);
    }
  }

  _persist() {
    if (!this.snapshotPath) {
      return;
    }

    try {
      const dir = path.dirname(this.snapshotPath);
      fs.mkdirSync(dir, { recursive: true });
      const snapshot = {
        version: SNAPSHOT_VERSION,
        commands: Array.from(this.commands.values()),
        pending: this.pending.filter((id) => {
          const cmd = this.commands.get(id);
          return Boolean(cmd && cmd.status === "queued");
        }),
        stats: this.stats,
        idempotency: Array.from(this.idempotencyIndex.entries()),
      };
      const tempPath = `${this.snapshotPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
      fs.renameSync(tempPath, this.snapshotPath);
    } catch (_err) {
      // Non-fatal. Runtime behavior remains in-memory if persistence fails.
    }
  }
}

module.exports = { CommandStore };
