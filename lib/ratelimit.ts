// In-memory sliding-window request rate limiter.
//
// This is an application-level limiter for a single-instance deployment
// (the production Docker Compose app is a single Next.js standalone server),
// keyed by tenant orgId so one org's investigation load can't starve others.
//
// For horizontally-scaled / serverless deployments this should be replaced
// with a shared store (e.g. an external Redis/Upstash counter keyed by orgId);
// the env vars below keep the knob surface identical.
//
// Limits are configurable at boot:
//   RATE_LIMIT_MAX_REQUESTS  (default 10)
//   RATE_LIMIT_WINDOW_MS     (default 60_000 — 1 minute)
// Setting RATE_LIMIT_MAX_REQUESTS to 0 disables the limiter entirely.

interface Entry {
  timestamps: number[];
}

const buckets = new Map<string, Entry>();

/** Parse an env var: return `fallback` when absent/invalid, but honor an
 *  explicit integer (including 0, which callers use to disable). */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function config() {
  const maxRequests = envInt("RATE_LIMIT_MAX_REQUESTS", 10);
  const windowMs = envInt("RATE_LIMIT_WINDOW_MS", 60_000);
  return {
    maxRequests,
    // A 0 window has no meaning — fall back to the default.
    windowMs: windowMs <= 0 ? 60_000 : windowMs,
    disabled: maxRequests <= 0,
  };
}

/**
 * Sliding-window allow check for `key`.
 *
 * Returns the number of requests remaining in the current window when allowed,
 * or 0 when the window is exhausted. Callers decide how to respond (429).
 * Purely in-memory and process-local — not shared across instances.
 */
export function checkRateLimit(
  key: string,
  opts?: { maxRequests?: number; windowMs?: number }
): { allowed: boolean; remaining: number; resetAtMs: number } {
  const cfg = config();
  const maxRequests = opts?.maxRequests ?? cfg.maxRequests;
  const windowMs = opts?.windowMs ?? cfg.windowMs;

  if (cfg.disabled || maxRequests <= 0) {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, resetAtMs: 0 };
  }

  const now = Date.now();
  const entry = buckets.get(key) ?? { timestamps: [] };

  // Drop timestamps outside the sliding window.
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  // The window is exhausted: record nothing, report when it resets.
  if (entry.timestamps.length >= maxRequests) {
    buckets.set(key, entry);
    const resetAtMs =
      entry.timestamps.length > 0 ? entry.timestamps[0] + windowMs : now + windowMs;
    return { allowed: false, remaining: 0, resetAtMs };
  }

  // Within budget: record this request and report what's left.
  entry.timestamps.push(now);
  buckets.set(key, entry);

  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetAtMs: entry.timestamps[0] + windowMs,
  };
}

/** Reset all state — used by tests. */
export function resetRateLimiter() {
  buckets.clear();
}
