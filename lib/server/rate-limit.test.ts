import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { clientIp, createRateLimiter, MAX_RATE_LIMIT_KEYS } from "./rate-limit";

vi.mock("server-only", () => ({}));

describe("createRateLimiter", () => {
  it("allows `limit` hits per `windowMs`, then 429s until the window resets", async () => {
    const check = createRateLimiter(2, 1_000);
    expect(check("a", 0)).toBeNull();
    expect(check("a", 10)).toBeNull();
    const limited = check("a", 500)!;
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(await limited.json()).toEqual({ error: "Too many requests, try again in 1 seconds" });
    expect(check("b", 500)).toBeNull();
    expect(check("a", 1_000)).toBeNull();
  });

  it("defaults the key cap to MAX_RATE_LIMIT_KEYS", () => {
    const check = createRateLimiter(1, 60_000);
    for (let i = 0; i <= MAX_RATE_LIMIT_KEYS; i++) check(`k${i}`, 0);
    expect(check.keys()).toHaveLength(MAX_RATE_LIMIT_KEYS);
    expect(check.keys()[0]).toBe("k1");
  });

  it("caps the table at maxKeys, dropping the least recently seen key first", () => {
    const check = createRateLimiter(1, 60_000, 3);
    check("a", 0);
    check("b", 1);
    check("c", 2);
    check("a", 3); // touch: a moves to the back
    expect(check.keys()).toEqual(["b", "c", "a"]);
    check("d", 4);
    expect(check.keys()).toEqual(["c", "a", "d"]);
    // "a" kept its window, so it is still limited; "b" was trimmed and starts fresh.
    expect(check("a", 5)?.status).toBe(429);
    expect(check("b", 6)).toBeNull();
    expect(check.keys()).toEqual(["d", "a", "b"]);
  });

  it("trims without scanning the table", () => {
    const check = createRateLimiter(1, 60_000, 100);
    for (let i = 0; i < 100; i++) check(`k${i}`, 0);
    const iterate = vi.spyOn(Map.prototype, "entries");
    const forEach = vi.spyOn(Map.prototype, "forEach");
    const values = vi.spyOn(Map.prototype, "values");
    check("new", 1);
    expect(iterate).not.toHaveBeenCalled();
    expect(forEach).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(check.keys()).toHaveLength(100);
    expect(check.keys()[0]).toBe("k1");
  });
});

describe("clientIp", () => {
  const request = (headers: Record<string, string>) => new NextRequest("http://localhost/", { headers });

  it("prefers x-vercel-forwarded-for, then x-forwarded-for, then x-real-ip", () => {
    const all = { "x-vercel-forwarded-for": "203.0.113.1", "x-forwarded-for": "10.0.0.1, 10.0.0.2", "x-real-ip": "10.0.0.3" };
    expect(clientIp(request(all))).toBe("203.0.113.1");
    expect(clientIp(request({ "x-vercel-forwarded-for": " 203.0.113.1 , 10.0.0.9" }))).toBe("203.0.113.1");
    expect(clientIp(request({ "x-forwarded-for": "10.0.0.1, 10.0.0.2", "x-real-ip": "10.0.0.3" }))).toBe("10.0.0.1");
    expect(clientIp(request({ "x-vercel-forwarded-for": "", "x-real-ip": "10.0.0.3" }))).toBe("10.0.0.3");
    expect(clientIp(request({}))).toBe("unknown");
  });
});
