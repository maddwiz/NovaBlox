"use strict";

class FixedWindowRateLimiter {
  constructor(options = {}) {
    const max = Number.parseInt(String(options.max || 0), 10);
    const windowMs = Number.parseInt(String(options.windowMs || 60_000), 10);
    this.max = Number.isFinite(max) && max > 0 ? max : 0;
    this.windowMs =
      Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000;
    this.buckets = new Map();
  }

  enabled() {
    return this.max > 0;
  }

  consume(key, now = Date.now()) {
    if (!this.enabled()) {
      return {
        allowed: true,
        limit: 0,
        remaining: null,
        reset_at_ms: now + this.windowMs,
        retry_after_ms: 0,
      };
    }

    const normalizedKey = String(key || "unknown");
    const previous = this.buckets.get(normalizedKey);
    const shouldReset = !previous || previous.reset_at_ms <= now;
    const bucket = shouldReset
      ? { count: 0, reset_at_ms: now + this.windowMs }
      : previous;

    bucket.count += 1;
    this.buckets.set(normalizedKey, bucket);

    const remaining = Math.max(0, this.max - bucket.count);
    const allowed = bucket.count <= this.max;
    const retryAfterMs = allowed ? 0 : Math.max(0, bucket.reset_at_ms - now);
    return {
      allowed,
      limit: this.max,
      remaining,
      reset_at_ms: bucket.reset_at_ms,
      retry_after_ms: retryAfterMs,
    };
  }

  cleanup(now = Date.now()) {
    for (const [key, bucket] of this.buckets.entries()) {
      if (!bucket || bucket.reset_at_ms <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

module.exports = { FixedWindowRateLimiter };
