import { timingSafeEqual } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessConfig } from "./config";
import { issueSessionToken, safeEqual, SESSION_MAX_AGE, verifySessionToken } from "./session";

vi.mock("server-only", () => ({}));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const spy = vi.mocked(timingSafeEqual);
beforeEach(() => {
  spy.mockClear();
});

describe("safeEqual", () => {
  it("compares passcodes with timingSafeEqual on equal-length digests", () => {
    expect(safeEqual("correct horse battery staple", "correct horse battery staple")).toBe(true);
    expect(safeEqual("correct horse battery staple", "correct horse battery stapl")).toBe(false);
    expect(safeEqual("", "correct horse battery staple")).toBe(false);
    expect(safeEqual("a".repeat(10_000), "a")).toBe(false);
    expect(spy).toHaveBeenCalledTimes(4);
    for (const [a, b] of spy.mock.calls) {
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    }
  });

  it("does not throw on different-length inputs (timingSafeEqual alone would)", () => {
    expect(() => timingSafeEqual(Buffer.from("ab"), Buffer.from("abc"))).toThrow();
    expect(() => safeEqual("ab", "abc")).not.toThrow();
  });
});

describe("session tokens", () => {
  const config: AccessConfig = { passcode: "correct horse battery staple", secret: "s".repeat(32), notBefore: 0 };
  const now = Date.parse("2026-10-29T00:00:00Z");

  it("verifies the HMAC with timingSafeEqual", () => {
    const token = issueSessionToken(config, now);
    spy.mockClear();
    expect(verifySessionToken(token, config, now)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("enforces the max age and not-before time", () => {
    const token = issueSessionToken(config, now);
    expect(verifySessionToken(token, config, now + (SESSION_MAX_AGE - 1) * 1000)).toBe(true);
    expect(verifySessionToken(token, config, now + SESSION_MAX_AGE * 1000)).toBe(false);
    expect(verifySessionToken(token, { ...config, notBefore: now / 1000 }, now)).toBe(true);
    expect(verifySessionToken(token, { ...config, notBefore: now / 1000 + 1 }, now)).toBe(false);
  });

  it("is bound to the secret and the passcode", () => {
    const token = issueSessionToken(config, now);
    expect(verifySessionToken(token, { ...config, secret: "t".repeat(32) }, now)).toBe(false);
    expect(verifySessionToken(token, { ...config, passcode: "another passcode, long" }, now)).toBe(false);
  });

  it("rejects malformed tokens before comparing", () => {
    for (const token of ["", "v1", "v1.1.", "v1.abc.x", `v1.${now}.${"A".repeat(42)}`]) {
      expect(verifySessionToken(token, config, now), token).toBe(false);
    }
  });
});
