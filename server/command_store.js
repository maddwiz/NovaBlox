"use strict";

const { randomUUID } = require("crypto");

class CommandStore {
  constructor(options = {}) {
    this.leaseMs = Number.isFinite(options.leaseMs) ? options.leaseMs : 120000;
    this.maxRetention = Number.isFinite(options.maxRetention) ? options.maxRetention : 10000;
    this.commands = new Map();
    this.pending = [];
    this.sseClients = new Map();
    this.stats = {
      queued_total: 0,
      dispatched_total: 0,
      succeeded_total: 0,
      failed_total: 0,
      canceled_total: 0,
      requeued_total: 0,
    };
  }

  enqueue(commandInput) {
    const now = Date.now();
    const command = {
      id: randomUUID(),
      route: commandInput.route,
      category: commandInput.category || "generic",
      action: commandInput.action || "command",
      payload: commandInput.payload || {},
      priority: Number.isFinite(commandInput.priority) ? commandInput.priority : 0,
      metadata: commandInput.metadata || {},
      status: "queued",
      attempts: 0,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      dispatched_at: null,
      lease_expires_at: null,
      completed_at: null,
      delivered_to: null,
      result: null,
      error: null,
    };

    this.commands.set(command.id, command);
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
    });
    return command;
  }

  enqueueBatch(items) {
    return items.map((item) => this.enqueue(item));
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
      cmd.status = "dispatched";
      cmd.delivered_to = clientId;
      cmd.dispatched_at = new Date(now).toISOString();
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
    }

    return out;
  }

  result(input) {
    const id = input.command_id || input.id;
    if (!id) {
      return { ok: false, error: "command_id is required" };
    }
    const cmd = this.commands.get(id);
    if (!cmd) {
      return { ok: false, error: `command ${id} not found` };
    }

    const now = Date.now();
    const resultOk = input.ok === true || String(input.status || "").toLowerCase() === "ok";
    const shouldRequeue = input.requeue === true;

    cmd.result = input.result || null;
    cmd.error = input.error || null;
    cmd.updated_at = new Date(now).toISOString();

    if (shouldRequeue) {
      cmd.status = "queued";
      cmd.lease_expires_at = null;
      cmd.updated_at = new Date(now).toISOString();
      this.pending.push(cmd.id);
      this._sortPending();
      this.stats.requeued_total += 1;
      this._broadcast("requeued", { id: cmd.id, attempts: cmd.attempts });
      return { ok: true, command: cmd };
    }

    cmd.status = resultOk ? "succeeded" : "failed";
    cmd.completed_at = new Date(now).toISOString();
    cmd.lease_expires_at = null;
    if (resultOk) {
      this.stats.succeeded_total += 1;
    } else {
      this.stats.failed_total += 1;
    }
    this._broadcast(resultOk ? "succeeded" : "failed", {
      id: cmd.id,
      error: cmd.error,
    });
    return { ok: true, command: cmd };
  }

  cancel(id) {
    const cmd = this.commands.get(id);
    if (!cmd) {
      return { ok: false, error: `command ${id} not found` };
    }
    if (cmd.status === "succeeded" || cmd.status === "failed") {
      return { ok: false, error: `command ${id} already completed` };
    }
    cmd.status = "canceled";
    cmd.updated_at = new Date().toISOString();
    cmd.completed_at = cmd.updated_at;
    cmd.lease_expires_at = null;
    this.pending = this.pending.filter((pendingId) => pendingId !== id);
    this.stats.canceled_total += 1;
    this._broadcast("canceled", { id: cmd.id });
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
    if (cmd.status === "canceled") {
      return { ok: false, error: `command ${id} is canceled` };
    }
    cmd.status = "queued";
    cmd.updated_at = new Date().toISOString();
    cmd.lease_expires_at = null;
    cmd.error = null;
    this.pending.push(id);
    this._sortPending();
    this.stats.requeued_total += 1;
    this._broadcast("requeued", { id: cmd.id });
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
    const byStatus = {
      queued: 0,
      dispatched: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    };
    for (const cmd of this.commands.values()) {
      byStatus[cmd.status] = (byStatus[cmd.status] || 0) + 1;
    }
    return {
      total_commands: this.commands.size,
      pending_count: this.pending.length,
      by_status: byStatus,
      counters: this.stats,
      sse_clients: this.sseClients.size,
      lease_ms: this.leaseMs,
    };
  }

  addSseClient(clientId, res) {
    this.sseClients.set(res, { clientId, connectedAt: new Date().toISOString() });
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
    for (const cmd of this.commands.values()) {
      if (cmd.status !== "dispatched" || !cmd.lease_expires_at) {
        continue;
      }
      const leaseExpiresAt = Date.parse(cmd.lease_expires_at);
      if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt > now) {
        continue;
      }
      cmd.status = "queued";
      cmd.updated_at = new Date(now).toISOString();
      cmd.lease_expires_at = null;
      this.pending.push(cmd.id);
      this.stats.requeued_total += 1;
    }
    this._sortPending();
  }

  _pruneIfNeeded() {
    if (this.commands.size <= this.maxRetention) {
      return;
    }
    const completed = Array.from(this.commands.values())
      .filter((cmd) => cmd.status === "succeeded" || cmd.status === "failed" || cmd.status === "canceled")
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    const pruneCount = this.commands.size - this.maxRetention;
    for (let i = 0; i < pruneCount && i < completed.length; i += 1) {
      this.commands.delete(completed[i].id);
    }
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
}

module.exports = { CommandStore };
