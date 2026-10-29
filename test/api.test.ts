import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/session/route";
import { GET } from "@/app/api/tmdb/[...path]/route";
import movie from "./fixtures/tmdb/movie-27205.json";
import search from "./fixtures/tmdb/search-movie.json";

vi.mock("server-only", () => ({}));

const PASSCODE = "correct horse battery staple";
const TOKEN = "test-tmdb-token";
let ip = 0;

const loginRequest = (body: string) =>
  new NextRequest("http://localhost/api/session", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": `10.1.0.${++ip}` },
  });

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
  vi.stubEnv("TMDB_TOKEN", TOKEN);
  fetchMock = vi.fn(async (input: string) => Response.json(input.includes("/search/") ? search : movie));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
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
    vi.stubEnv("RYUUJI_PASSCODE", "rotated");
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
