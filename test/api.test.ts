import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/session/route";
import { GET } from "@/app/api/tmdb/[...path]/route";
import { SESSION_MAX_AGE } from "@/lib/server/session";
import movie from "./fixtures/tmdb/movie-27205.json";
import search from "./fixtures/tmdb/search-movie.json";

vi.mock("server-only", () => ({}));

const PASSCODE = "correct horse battery staple";
const SECRET = "test-session-secret-0123456789abcdef";
const TOKEN = "test-tmdb-token";
let ip = 0;

const loginRequest = (body: string, headers: Record<string, string> = { "x-forwarded-for": `10.1.0.${++ip}` }) =>
  new NextRequest("http://localhost/api/session", { method: "POST", body, headers });
const loginBody = (passcode = PASSCODE) => JSON.stringify({ passcode });

async function sessionCookie(): Promise<string> {
  const response = await login(loginRequest(JSON.stringify({ passcode: PASSCODE })));
  return response.headers.get("set-cookie")!.split(";")[0];
}

/** GETs the proxy from a fresh client IP unless one is given. */
async function get(url: string, { cookie = "", clientIp = `10.0.0.${++ip}` } = {}) {
  const request = new NextRequest(`http://localhost/api/tmdb/${url}`, {
    headers: { cookie, "x-forwarded-for": clientIp },
  });
  const path = request.nextUrl.pathname.replace("/api/tmdb/", "").split("/");
  return GET(request, { params: Promise.resolve({ path }) });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("RYUUJI_PASSCODE", PASSCODE);
  vi.stubEnv("RYUUJI_SESSION_SECRET", SECRET);
  vi.stubEnv("RYUUJI_SESSION_NOT_BEFORE", "");
  vi.stubEnv("TMDB_TOKEN", TOKEN);
  fetchMock = vi.fn(async (input: string) => Response.json(input.includes("/search/") ? search : movie));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/session", () => {
  it("sets a strict httpOnly secure cookie for the right passcode", async () => {
    const response = await login(loginRequest(JSON.stringify({ passcode: PASSCODE })));
    expect(response.status).toBe(204);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^ryuuji_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).not.toContain(PASSCODE);
  });

  it("rejects a wrong or missing passcode", async () => {
    for (const body of [JSON.stringify({ passcode: "nope" }), "{}", "not json"]) {
      const response = await login(loginRequest(body));
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("issues a signed cookie carrying the issue time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    const response = await login(loginRequest(loginBody()));
    const value = response.headers.get("set-cookie")!.split(";")[0].split("=")[1];
    expect(value).toMatch(new RegExp(`^v1\\.${Date.parse("2026-10-29T12:00:00Z") / 1000}\\.[A-Za-z0-9_-]{43}$`));
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`Max-Age=${SESSION_MAX_AGE}`, "i"));
  });

  it("rate-limits passcode attempts to 10 per minute per IP, even for the right passcode", async () => {
    const headers = { "x-forwarded-for": "10.7.7.7" };
    for (let i = 0; i < 10; i++) expect((await login(loginRequest(loginBody("wrong passcode guess"), headers))).status).toBe(401);
    const blocked = await login(loginRequest(loginBody(), headers));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect((await login(loginRequest(loginBody(), { "x-forwarded-for": "10.7.7.8" }))).status).toBe(204);
  });

  it("keys the limit on x-vercel-forwarded-for before x-forwarded-for", async () => {
    const vercel = "203.0.113.9";
    for (let i = 0; i < 10; i++) {
      // A spoofed, rotating x-forwarded-for does not escape the Vercel-set address.
      const response = await login(loginRequest("{}", { "x-vercel-forwarded-for": vercel, "x-forwarded-for": `10.8.0.${i}` }));
      expect(response.status).toBe(401);
    }
    expect((await login(loginRequest("{}", { "x-vercel-forwarded-for": vercel, "x-forwarded-for": "10.8.1.1" }))).status).toBe(429);
    expect((await login(loginRequest("{}", { "x-vercel-forwarded-for": "203.0.113.10", "x-forwarded-for": "10.8.0.1" }))).status).toBe(401);
  });

  it("503s when the passcode is shorter than 16 characters or the secret is short", async () => {
    vi.stubEnv("RYUUJI_PASSCODE", "fifteen chars!!");
    expect((await login(loginRequest(loginBody("fifteen chars!!")))).status).toBe(503);
    vi.stubEnv("RYUUJI_PASSCODE", PASSCODE);
    vi.stubEnv("RYUUJI_SESSION_SECRET", "too short");
    expect((await login(loginRequest(loginBody()))).status).toBe(503);
  });
});

describe("session cookie", () => {
  const issuedAt = new Date("2026-10-01T00:00:00Z");
  async function cookieIssuedAt(date: Date) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(date);
    return sessionCookie();
  }
  const at = (date: Date | number) => vi.setSystemTime(date);

  it("is valid until the max age, then expires", async () => {
    const cookie = await cookieIssuedAt(issuedAt);
    at(issuedAt.getTime() + SESSION_MAX_AGE * 1000 - 1000);
    expect((await get("movie/27205", { cookie })).status).toBe(200);
    at(issuedAt.getTime() + SESSION_MAX_AGE * 1000);
    expect((await get("movie/27205", { cookie })).status).toBe(401);
  });

  it("rejects issue times in the future", async () => {
    const cookie = await cookieIssuedAt(new Date(issuedAt.getTime() + 5 * 60_000));
    at(issuedAt);
    expect((await get("movie/27205", { cookie })).status).toBe(401);
  });

  it("rejects tampered issue times and signatures", async () => {
    const cookie = await cookieIssuedAt(issuedAt);
    const [, iat, sig] = cookie.split("=")[1].split(".");
    const later = `ryuuji_session=v1.${Number(iat) + 1}.${sig}`;
    const flipped = `ryuuji_session=v1.${iat}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    for (const forged of [later, flipped, `ryuuji_session=v2.${iat}.${sig}`, `ryuuji_session=v1.${iat}.${sig}AA`]) {
      expect((await get("movie/27205", { cookie: forged })).status, forged).toBe(401);
    }
  });

  it("is revoked by rotating the secret", async () => {
    const cookie = await sessionCookie();
    vi.stubEnv("RYUUJI_SESSION_SECRET", "another-test-secret-0123456789abcdef");
    expect((await get("movie/27205", { cookie })).status).toBe(401);
  });

  it.each([
    ["ISO", "2026-10-15T00:00:00Z"],
    ["epoch seconds", String(Date.parse("2026-10-15T00:00:00Z") / 1000)],
  ])("is revoked when issued before RYUUJI_SESSION_NOT_BEFORE (%s)", async (_format, notBefore) => {
    const old = await cookieIssuedAt(issuedAt);
    const fresh = await cookieIssuedAt(new Date("2026-10-16T00:00:00Z"));
    vi.stubEnv("RYUUJI_SESSION_NOT_BEFORE", notBefore);
    expect((await get("movie/27205", { cookie: old })).status).toBe(401);
    expect((await get("movie/27205", { cookie: fresh })).status).toBe(200);
  });

  it("fails closed on an unparseable RYUUJI_SESSION_NOT_BEFORE", async () => {
    const cookie = await sessionCookie();
    vi.stubEnv("RYUUJI_SESSION_NOT_BEFORE", "yesterday");
    expect((await get("movie/27205", { cookie })).status).toBe(503);
  });
});

describe("GET /api/tmdb/[...path]", () => {
  it("proxies allow-listed endpoints with the server token and caching", async () => {
    const cookie = await sessionCookie();
    const response = await get("search/movie?query=inception&page=1", { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(search);
    expect(response.headers.get("cache-control")).toBe("private, max-age=600");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.themoviedb.org/3/search/movie?language=en-US&page=1&query=inception");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.next).toEqual({ revalidate: 600 });

    for (const path of [
      "search/tv?query=frieren",
      "movie/27205",
      "tv/1396?append_to_response=season/1,season/2",
      "tv/1396/season/1",
      "discover/tv?with_genres=16&with_origin_country=JP&first_air_date.gte=2026-10-01&sort_by=popularity.desc",
      "movie/27205/watch/providers",
      "tv/1396/watch/providers",
      "watch/providers/regions?language=en-US",
      "watch/providers/movie?watch_region=US&language=en-US",
      "watch/providers/tv?watch_region=JP&language=ja-JP",
      "configuration",
    ]) {
      expect((await get(path, { cookie })).status, path).toBe(200);
    }
    expect(fetchMock.mock.calls[2][1].next).toEqual({ revalidate: 86400 });
  });

  it("404s anything off the allow-list", async () => {
    const cookie = await sessionCookie();
    for (const path of ["search/multi?query=x", "movie/abc", "person/1", "tv/1/season/1/episode/1", "authentication", "movie/1/credits", "watch/providers/person", "watch/providers/movie/1", "watch/providers/regions/US"]) {
      expect((await get(path, { cookie })).status, path).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s unknown, duplicate, or malformed query params", async () => {
    const cookie = await sessionCookie();
    for (const path of [
      "movie/1?api_key=x",
      "search/movie?query=a&query=b",
      "search/movie?page=0",
      "movie/1?append_to_response=credits",
      "tv/1?append_to_response=credits",
      "discover/tv?with_genres=abc",
      "configuration?language=en-US",
      "watch/providers/movie?watch_region=us",
      "watch/providers/tv?watch_region=USA",
      "watch/providers/tv?watch_region=US&watch_region=JP",
      "watch/providers/regions?watch_region=US",
      "watch/providers/movie?language=english",
      "watch/providers/movie?api_key=x",
    ]) {
      expect((await get(path, { cookie })).status, path).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503s when the TMDB token is missing", async () => {
    const cookie = await sessionCookie();
    vi.stubEnv("TMDB_TOKEN", "");
    const response = await get("movie/27205", { cookie });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "TMDB not configured" });
  });

  it("refuses to follow redirects", async () => {
    const cookie = await sessionCookie();
    await get("movie/27205", { cookie });
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");

    // With redirect: "error", fetch rejects on a 3xx; the proxy reports it as unreachable.
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed: unexpected redirect"));
    const response = await get("movie/27205", { cookie });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Could not reach TMDB" });
  });

  it.each([
    [500, 502, "TMDB returned an error (HTTP 500)"],
    [401, 502, "TMDB returned an error (HTTP 401)"],
    [429, 502, "TMDB returned an error (HTTP 429)"],
    [404, 404, "Not found"],
  ])("does not pass through upstream HTTP %i error bodies", async (upstream, status, error) => {
    const cookie = await sessionCookie();
    const body = JSON.stringify({ status_message: "upstream-detail-leak", token: TOKEN });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: upstream, headers: { "X-Upstream": "leak" } }));
    const response = await get("movie/27205", { cookie });
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error });
    expect(text).not.toContain("upstream-detail-leak");
    expect(text).not.toContain(TOKEN);
    expect(response.headers.get("x-upstream")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("503s when the passcode is shorter than 16 characters", async () => {
    const cookie = await sessionCookie();
    vi.stubEnv("RYUUJI_PASSCODE", "fifteen chars!!");
    const response = await get("movie/27205", { cookie });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Access not configured" });
  });

  it("503s when the passcode is not configured", async () => {
    vi.stubEnv("RYUUJI_PASSCODE", "");
    const response = await get("movie/27205");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Access not configured" });
  });

  it("401s without a valid session cookie", async () => {
    expect((await get("movie/27205")).status).toBe(401);
    expect((await get("movie/27205", { cookie: "ryuuji_session=forged" })).status).toBe(401);
    const cookie = await sessionCookie();
    vi.stubEnv("RYUUJI_PASSCODE", "a rotated passcode, long enough");
    expect((await get("movie/27205", { cookie })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429s past 60 requests per minute per IP", async () => {
    for (let i = 0; i < 60; i++) expect((await get("movie/1", { clientIp: "10.9.9.9" })).status).toBe(401);
    const response = await get("movie/1", { clientIp: "10.9.9.9" });
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await response.json()).toEqual({ error: `Too many requests, try again in ${retryAfter} seconds` });
    expect((await get("movie/1", { clientIp: "10.9.9.10" })).status).toBe(401);
  });
});
