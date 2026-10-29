import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { accessConfigOrNull, type AccessConfig } from "./config";

// Single-user passcode access. The cookie is `v1.<issued-at seconds>.<HMAC-SHA256>`, keyed by
// RYUUJI_SESSION_SECRET over the version, issued-at time and passcode. Rotating the secret or
// the passcode, or raising RYUUJI_SESSION_NOT_BEFORE, invalidates every existing session.

export const SESSION_COOKIE = "ryuuji_session";
/** Session lifetime in seconds, enforced server-side from the signed issued-at time. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
/** Tolerated clock drift for issued-at times slightly in the future. */
const CLOCK_SKEW = 60;

const TOKEN = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

const signature = ({ secret, passcode }: AccessConfig, issuedAt: number) =>
  createHmac("sha256", secret).update(`ryuuji-session-v1\0${issuedAt}\0`).update(passcode).digest();

/** A fresh session token issued at `now` (ms). */
export function issueSessionToken(config: AccessConfig, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  return `v1.${issuedAt}.${signature(config, issuedAt).toString("base64url")}`;
}

/** Whether `token` has a valid signature, is unexpired, and was issued after the not-before time. */
export function verifySessionToken(token: string, config: AccessConfig, now = Date.now()): boolean {
  const match = TOKEN.exec(token);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  const given = Buffer.from(match[2], "base64url");
  const expected = signature(config, issuedAt);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const nowSeconds = Math.floor(now / 1000);
  return issuedAt >= config.notBefore && issuedAt <= nowSeconds + CLOCK_SKEW && nowSeconds - issuedAt < SESSION_MAX_AGE;
}

/** Constant-time string comparison; hashing first equalizes lengths. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export const accessNotConfigured = () => Response.json({ error: "Access not configured" }, { status: 503 });

/** An error response when the request lacks a valid session, else null. Fails closed. */
export function requireSession(request: NextRequest, now = Date.now()): Response | null {
  const config = accessConfigOrNull();
  if (!config) return accessNotConfigured();
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie || !verifySessionToken(cookie, config, now)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
