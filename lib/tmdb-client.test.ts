import { afterEach, describe, expect, it, vi } from "vitest";
import { tmdbFetch, TMDBRequestError } from "./tmdb-client";

afterEach(() => vi.unstubAllGlobals());

describe("TMDBRequestError", () => {
  it("keeps the status constructor param as a readonly property", () => {
    const error = new TMDBRequestError("Not found", 404);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "TMDBRequestError", message: "Not found", status: 404 });
  });
});

describe("tmdbFetch", () => {
  it("calls the same-origin proxy with stringified params", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await tmdbFetch("search/tv", { query: "frieren", page: 2, include_adult: false })).toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/tmdb/search/tv?query=frieren&page=2&include_adult=false", { credentials: "same-origin" });
    await tmdbFetch("configuration");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/tmdb/configuration", { credentials: "same-origin" });
  });

  it("throws TMDBRequestError with the proxy's message and status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401 })));
    await expect(tmdbFetch("movie/1")).rejects.toMatchObject({ name: "TMDBRequestError", message: "Unauthorized", status: 401 });
  });

  it("falls back to a generic message for non-JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })));
    const error = await tmdbFetch("movie/1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TMDBRequestError);
    expect(error).toMatchObject({ message: "Request failed (HTTP 502)", status: 502 });
  });
});
