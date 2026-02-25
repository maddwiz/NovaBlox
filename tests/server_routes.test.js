"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const { once } = require("events");
const http = require("http");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const READ_KEY = "test-read-key";
const WRITE_KEY = "test-write-key";

function makePort(seed = 0) {
  return 32100 + Math.floor(Math.random() * 1000) + seed;
}

function requestJson(port, method, route, options = {}) {
  const payload =
    options.body === undefined || options.body === null
      ? null
      : JSON.stringify(options.body);
  const headers = Object.assign({}, options.headers || {});
  headers["Content-Type"] = "application/json";
  if (options.apiKey) {
    headers["X-API-Key"] = options.apiKey;
  }
  if (payload) {
    headers["Content-Length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port,
        path: route,
        method,
        headers,
        timeout: 4000,
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
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: parsed,
            raw,
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function waitForServer(port, timeoutMs = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await requestJson(port, "GET", "/bridge/health");
      if (
        health.statusCode === 200 &&
        health.body &&
        health.body.status === "ok"
      ) {
        return;
      }
    } catch (_err) {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy on port ${port}`);
}

function startServer(port, envOverrides = {}) {
  const env = Object.assign(
    {},
    process.env,
    {
      ROBLOXBRIDGE_HOST: HOST,
      ROBLOXBRIDGE_PORT: String(port),
      ROBLOXBRIDGE_API_KEY: "",
      ROBLOXBRIDGE_API_KEYS: `${READ_KEY}:read,${WRITE_KEY}:write`,
      ROBLOXBRIDGE_QUEUE_SNAPSHOT_PATH: "",
      ROBLOXBRIDGE_RATE_LIMIT_WINDOW_MS: "60000",
      ROBLOXBRIDGE_RATE_LIMIT_MAX: "1000",
      ROBLOXBRIDGE_RATE_LIMIT_EXEMPT_LOCAL: "false",
    },
    envOverrides,
  );

  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  async function stop() {
    if (child.exitCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2000);
    await once(child, "exit");
    clearTimeout(timer);
  }

  return {
    child,
    stop,
    getStderr: () => stderr,
  };
}

test("server enforces read/write roles and supports batch results", async () => {
  const port = makePort(1);
  const server = startServer(port);
  try {
    await waitForServer(port);

    const capabilities = await requestJson(port, "GET", "/bridge/capabilities");
    assert.equal(capabilities.statusCode, 200);
    assert.equal(capabilities.body.capabilities.results.batch, true);

    const statsRead = await requestJson(port, "GET", "/bridge/stats", {
      apiKey: READ_KEY,
    });
    assert.equal(statsRead.statusCode, 200);

    const queueWithRead = await requestJson(port, "POST", "/bridge/command", {
      apiKey: READ_KEY,
      body: {
        route: "/bridge/test-spawn",
        action: "test-spawn",
        payload: { text: "role test" },
      },
    });
    assert.equal(queueWithRead.statusCode, 403);

    const queued = await requestJson(port, "POST", "/bridge/command", {
      apiKey: WRITE_KEY,
      body: {
        route: "/bridge/test-spawn",
        action: "test-spawn",
        payload: { text: "batch test" },
      },
    });
    assert.equal(queued.statusCode, 200);
    assert.equal(queued.body.status, "queued");
    const commandId = queued.body.command_id;
    assert.ok(commandId);

    const dispatched = await requestJson(
      port,
      "GET",
      "/bridge/commands?client_id=route-test-client&limit=1",
      { apiKey: WRITE_KEY },
    );
    assert.equal(dispatched.statusCode, 200);
    assert.equal(dispatched.body.count, 1);
    const command = dispatched.body.commands[0];
    assert.equal(command.id, commandId);
    assert.ok(command.dispatch_token);

    const batchResult = await requestJson(
      port,
      "POST",
      "/bridge/results/batch",
      {
        apiKey: WRITE_KEY,
        body: {
          results: [
            {
              command_id: command.id,
              dispatch_token: command.dispatch_token,
              ok: true,
              status: "ok",
              result: { done: true },
            },
          ],
        },
      },
    );
    assert.equal(batchResult.statusCode, 200);
    assert.equal(batchResult.body.status, "ok");
    assert.equal(batchResult.body.success_count, 1);

    const status = await requestJson(
      port,
      "GET",
      `/bridge/commands/${encodeURIComponent(command.id)}`,
      {
        apiKey: READ_KEY,
      },
    );
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.command.status, "succeeded");
  } finally {
    await server.stop();
    assert.equal(server.child.exitCode, 0, server.getStderr());
  }
});

test("rate limiter blocks excess requests with 429", async () => {
  const port = makePort(2);
  const server = startServer(port, {
    ROBLOXBRIDGE_RATE_LIMIT_MAX: "1",
    ROBLOXBRIDGE_RATE_LIMIT_EXEMPT_LOCAL: "false",
  });
  try {
    await waitForServer(port);

    const first = await requestJson(port, "GET", "/bridge/stats", {
      apiKey: READ_KEY,
    });
    assert.equal(first.statusCode, 200);

    const second = await requestJson(port, "GET", "/bridge/stats", {
      apiKey: READ_KEY,
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.body.error, "rate limit exceeded");
    assert.ok(second.headers["retry-after"]);
  } finally {
    await server.stop();
    assert.equal(server.child.exitCode, 0, server.getStderr());
  }
});

test("unauthenticated mode blocks remote clients by default", async () => {
  const port = makePort(3);
  const server = startServer(port, {
    ROBLOXBRIDGE_API_KEYS: "",
    ROBLOXBRIDGE_TRUST_PROXY: "true",
    ROBLOXBRIDGE_ALLOW_UNAUTHENTICATED_REMOTE: "false",
  });
  try {
    await waitForServer(port);

    const localHealth = await requestJson(port, "GET", "/bridge/health");
    assert.equal(localHealth.statusCode, 200);
    assert.equal(
      localHealth.body.security.unauthenticated_remote_blocked,
      true,
    );

    const remoteHealth = await requestJson(port, "GET", "/bridge/health", {
      headers: { "X-Forwarded-For": "203.0.113.10" },
    });
    assert.equal(remoteHealth.statusCode, 403);
    assert.equal(remoteHealth.body.status, "error");
    assert.match(remoteHealth.body.error, /remote access denied/i);
  } finally {
    await server.stop();
    assert.equal(server.child.exitCode, 0, server.getStderr());
  }
});

test("explicit unsafe override allows unauthenticated remote clients", async () => {
  const port = makePort(4);
  const server = startServer(port, {
    ROBLOXBRIDGE_API_KEYS: "",
    ROBLOXBRIDGE_TRUST_PROXY: "true",
    ROBLOXBRIDGE_ALLOW_UNAUTHENTICATED_REMOTE: "true",
  });
  try {
    await waitForServer(port);

    const remoteHealth = await requestJson(port, "GET", "/bridge/health", {
      headers: { "X-Forwarded-For": "203.0.113.10" },
    });
    assert.equal(remoteHealth.statusCode, 200);
    assert.equal(remoteHealth.body.security.allow_unauthenticated_remote, true);
    assert.equal(
      remoteHealth.body.security.unauthenticated_remote_blocked,
      false,
    );
  } finally {
    await server.stop();
    assert.equal(server.child.exitCode, 0, server.getStderr());
  }
});

test("planner endpoints and browser UIs are reachable", async () => {
  const port = makePort(5);
  const server = startServer(port);
  try {
    await waitForServer(port);

    const templates = await requestJson(
      port,
      "GET",
      "/bridge/planner/templates",
      { apiKey: READ_KEY },
    );
    assert.equal(templates.statusCode, 200);
    assert.ok(Array.isArray(templates.body.templates));
    assert.ok(
      templates.body.templates.some(
        (item) => item.id === "obstacle_course_builder",
      ),
    );

    const plan = await requestJson(port, "POST", "/bridge/assistant/plan", {
      apiKey: READ_KEY,
      body: {
        prompt: "build a 9 platform obby",
        template: "obstacle_course_builder",
      },
    });
    assert.equal(plan.statusCode, 200);
    assert.ok(plan.body.plan);
    assert.ok(Array.isArray(plan.body.plan.commands));
    assert.ok(plan.body.plan.commands.length >= 8);

    const execute = await requestJson(
      port,
      "POST",
      "/bridge/assistant/execute",
      {
        apiKey: WRITE_KEY,
        body: { plan: plan.body.plan, allow_dangerous: true },
      },
    );
    assert.equal(execute.statusCode, 200);
    assert.equal(execute.body.status, "queued");
    assert.ok(execute.body.queued_count > 0);

    const dangerousReject = await requestJson(
      port,
      "POST",
      "/bridge/assistant/execute",
      {
        apiKey: WRITE_KEY,
        body: {
          plan: {
            title: "Danger Test",
            commands: [
              {
                route: "/bridge/scene/delete-object",
                payload: { target_name: "DeleteMe" },
              },
            ],
          },
        },
      },
    );
    assert.equal(dangerousReject.statusCode, 400);
    assert.match(dangerousReject.body.error, /allow_dangerous=true/i);

    const endpointDocs = await requestJson(
      port,
      "GET",
      "/bridge/docs/endpoints",
    );
    assert.equal(endpointDocs.statusCode, 200);
    assert.ok(Array.isArray(endpointDocs.body.endpoints));
    assert.ok(
      endpointDocs.body.endpoints.some(
        (item) => item.path === "/bridge/assistant/plan",
      ),
    );

    const docsPage = await requestJson(port, "GET", "/docs");
    assert.equal(docsPage.statusCode, 200);
    assert.match(docsPage.raw, /NovaBlox API Explorer/i);

    const studioPage = await requestJson(port, "GET", "/bridge/studio");
    assert.equal(studioPage.statusCode, 200);
    assert.match(studioPage.raw, /NovaBlox Studio/i);
  } finally {
    await server.stop();
    assert.equal(server.child.exitCode, 0, server.getStderr());
  }
});
