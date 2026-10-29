import "server-only";
import type { NextRequest } from "next/server";

// Fixed-window limiter held in memory. Per server instance and reset on cold start, so it
// is best-effort only: serverless platforms may run several instances at once.

/** Default cap on tracked keys; past it the least recently seen keys are dropped. */
export const MAX_RATE_LIMIT_KEYS = 10_000;

export function createRateLimiter(limit: number, windowMs: number, maxKeys = MAX_RATE_LIMIT_KEYS) {
  // Map iteration follows insertion order. Re-inserting a key on every hit keeps the
  // least recently seen key first, so trimming drops from the front without scanning.
  const windows = new Map<string, { start: number; count: number }>();

  /** A 429 response once `key` exceeds the limit in the current window, else null. */
  const check = (key: string, now = Date.now()): Response | null => {
    let window = windows.get(key);
    windows.delete(key);
    if (!window || now - window.start >= windowMs) window = { start: now, count: 0 };
    windows.set(key, window);
    while (windows.size > maxKeys) windows.delete(windows.keys().next().value!);

    if (++window.count <= limit) return null;
    const retryAfter = Math.ceil((window.start + windowMs - now) / 1000);
    return Response.json(
      { error: `Too many requests, try again in ${retryAfter} seconds` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  };
  /** Tracked keys, least recently seen first. For tests. */
  check.keys = () => [...windows.keys()];
  return check;
}

const firstHop = (value: string | null) => value?.split(",")[0].trim() || null;

/**
 * The client IP. Vercel sets `x-vercel-forwarded-for` itself and clients cannot spoof it, so it
 * wins over the general `x-forwarded-for` / `x-real-ip` headers used elsewhere.
 */
export const clientIp = (request: NextRequest) =>
  firstHop(request.headers.get("x-vercel-forwarded-for")) ||
  firstHop(request.headers.get("x-forwarded-for")) ||
  request.headers.get("x-real-ip") ||
  "unknown";
