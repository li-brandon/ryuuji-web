import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Single-user passcode access. The cookie holds an HMAC of a fixed string keyed by the
// passcode, so changing RYUUJI_PASSCODE invalidates every existing session.

export const SESSION_COOKIE = "ryuuji_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export const passcode = () => process.env.RYUUJI_PASSCODE || null;

export const sessionToken = (key: string) =>
  createHmac("sha256", key).update("ryuuji-session-v1").digest("base64url");

/** Constant-time string comparison; hashing first equalizes lengths. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** An error response when the request lacks a valid session, else null. Fails closed. */
export function requireSession(request: NextRequest): Response | null {
  const key = passcode();
  if (!key) return Response.json({ error: "Access not configured" }, { status: 503 });
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie || !safeEqual(cookie, sessionToken(key))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
