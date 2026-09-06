import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit, resetRateLimiter } from "@/lib/ratelimit";

describe("checkRateLimit (org-keyed sliding window)", () => {
  beforeEach(() => {
    resetRateLimiter();
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  });

  afterEach(() => {
    resetRateLimiter();
    vi.restoreAllMocks();
  });

  it("allows requests within the window budget", () => {
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit("orgA");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(10 - (i + 1));
    }
  });

  it("rejects after the budget is exhausted", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("orgA");
    const r = checkRateLimit("orgA");
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("keys are org-isolated", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("orgA");
    expect(checkRateLimit("orgA").allowed).toBe(false);
    // Different org is unaffected.
    expect(checkRateLimit("orgB").allowed).toBe(true);
  });

  it("frees budget after the window elapses", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 10; i++) checkRateLimit("orgA");
      expect(checkRateLimit("orgA").allowed).toBe(false);

      vi.setSystemTime(Date.now() + 60_001);
      expect(checkRateLimit("orgA").allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects explicit opts over env defaults", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("orgA", { maxRequests: 3, windowMs: 5000 }).allowed).toBe(true);
    }
    expect(checkRateLimit("orgA", { maxRequests: 3, windowMs: 5000 }).allowed).toBe(false);
  });

  it("RATE_LIMIT_MAX_REQUESTS=0 disables the limiter", () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = "0";
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit("orgA").allowed).toBe(true);
    }
  });
});
