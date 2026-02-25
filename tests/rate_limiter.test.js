"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { FixedWindowRateLimiter } = require("../server/rate_limiter");

test("allows requests within the limit and blocks overflow", () => {
  const limiter = new FixedWindowRateLimiter({ max: 2, windowMs: 1_000 });
  const now = Date.now();

  const first = limiter.consume("k1", now);
  const second = limiter.consume("k1", now + 10);
  const third = limiter.consume("k1", now + 20);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retry_after_ms > 0);
});

test("resets counts after the window expires", () => {
  const limiter = new FixedWindowRateLimiter({ max: 1, windowMs: 100 });
  const now = Date.now();

  const first = limiter.consume("k1", now);
  const blocked = limiter.consume("k1", now + 50);
  const afterReset = limiter.consume("k1", now + 101);

  assert.equal(first.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(afterReset.allowed, true);
});

test("cleanup removes expired buckets", () => {
  const limiter = new FixedWindowRateLimiter({ max: 2, windowMs: 100 });
  const now = Date.now();

  limiter.consume("k1", now);
  limiter.consume("k2", now);
  assert.equal(limiter.buckets.size, 2);

  limiter.cleanup(now + 101);
  assert.equal(limiter.buckets.size, 0);
});
