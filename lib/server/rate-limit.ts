import "server-only";
import type { NextRequest } from "next/server";

// Fixed-window limiter held in memory. Per server instance and reset on cold start, so it
// is best-effort only: serverless platforms may run several instances at once.

export function createRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>();

  /** A 429 response once `key` exceeds the limit in the current window, else null. */
  return (key: string, now = Date.now()): Response | null => {
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
    }
    let window = windows.get(key);
    if (!window || now - window.start >= windowMs) {
      window = { start: now, count: 0 };
      windows.set(key, window);
    }
    if (++window.count <= limit) return null;
    const retryAfter = Math.ceil((window.start + windowMs - now) / 1000);
    return Response.json(
      { error: `Too many requests, try again in ${retryAfter} seconds` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  };
}

export const clientIp = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
  request.headers.get("x-real-ip") ||
  "unknown";
