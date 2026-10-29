import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import movie from "../test/fixtures/tmdb/movie-27205.json";
import searchMovie from "../test/fixtures/tmdb/search-movie.json";
import breakingBad from "../test/fixtures/tmdb/tv-1396.json";
import breakingBadSeason1 from "../test/fixtures/tmdb/tv-1396-season-1.json";
import { addTitle, isQuickAddShortcut, moveSelection, searchTitles, type Fetcher, type SearchItem } from "./quick-add";
import { LibraryRepository, openLibraryDB } from "./storage";
import { TMDBRequestError } from "./tmdb-client";

let dbCount = 0;
const repo = async () => new LibraryRepository(await openLibraryDB(`quick-add-${dbCount++}`));
const now = new Date("2026-10-28T12:00:00.000Z");

/** A fake proxy: responses by path + query string. */
function fakeFetcher(routes: Record<string, unknown>) {
  return vi.fn(async (path: string, params: Record<string, string | number | boolean> = {}) => {
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const key = query.size ? `${path}?${query}` : path;
    if (!(key in routes)) throw new TMDBRequestError("Not found", 404);
    return routes[key];
  }) as unknown as Fetcher & ReturnType<typeof vi.fn>;
}

const inception: SearchItem = { tmdbId: 27205, kind: "movie", name: "Inception", year: "2010", posterPath: null, isAnime: false };
const bb: SearchItem = { tmdbId: 1396, kind: "show", name: "Breaking Bad", year: "2008", posterPath: null, isAnime: false };

describe("searchTitles", () => {
  it("merges movie and TV results by popularity", async () => {
    const fetcher = fakeFetcher({
      "search/movie?query=x&include_adult=false&page=1": { results: [{ ...searchMovie.results[0], popularity: 5 }] },
      "search/tv?query=x&include_adult=false&page=1": {
        results: [{ id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20", poster_path: "/bb.jpg", popularity: 9 }],
      },
    });
    expect(await searchTitles("x", fetcher)).toEqual([
      { tmdbId: 1396, kind: "show", name: "Breaking Bad", year: "2008", posterPath: "/bb.jpg", isAnime: false },
      { tmdbId: 27205, kind: "movie", name: "Inception", year: "2010", posterPath: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg", isAnime: false },
    ]);
  });
});

describe("addTitle", () => {
  it("fetches a movie and creates it as Plan to Watch", async () => {
    const library = await repo();
    const { outcome, title } = await addTitle(library, inception, "planToWatch", {
      fetcher: fakeFetcher({ "movie/27205": movie }),
      now,
    });
    expect(outcome).toBe("added");
    expect(title).toMatchObject({ tmdbId: 27205, kind: "movie", name: "Inception", status: "planToWatch", addedAt: now.toISOString() });
    expect(await library.getTitle(inception)).toEqual(title);
  });

  it("fetches a show's seasons through append_to_response", async () => {
    const library = await repo();
    const fetcher = fakeFetcher({
      "tv/1396": breakingBad,
      "tv/1396?append_to_response=season%2F1": { ...breakingBad, "season/1": breakingBadSeason1 },
    });
    const { title } = await addTitle(library, bb, "planToWatch", { fetcher, now });
    expect(title.episodes?.seasons.map((s) => [s.number, s.episodes.length])).toEqual([
      [1, breakingBadSeason1.episodes.length],
    ]);
    expect(title.showStatus).toBe("Ended");
  });

  it("returns the existing title without fetching or duplicating", async () => {
    const library = await repo();
    await addTitle(library, inception, "planToWatch", { fetcher: fakeFetcher({ "movie/27205": movie }), now });
    const fetcher = fakeFetcher({ "movie/27205": movie });
    const second = await addTitle(library, inception, "planToWatch", { fetcher, now });
    expect(second.outcome).toBe("existing");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await library.listTitles()).toHaveLength(1);
  });

  it("marks a title created while fetching as existing", async () => {
    const library = await repo();
    const fetcher = fakeFetcher({ "movie/27205": movie });
    const [a, b] = await Promise.all([
      addTitle(library, inception, "planToWatch", { fetcher, now }),
      addTitle(library, inception, "planToWatch", { fetcher, now }),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["added", "existing"]);
    expect(await library.listTitles()).toHaveLength(1);
  });

  it("writes nothing when TMDB fails", async () => {
    const library = await repo();
    await expect(addTitle(library, inception, "planToWatch", { fetcher: fakeFetcher({}), now })).rejects.toThrow(TMDBRequestError);
    expect(await library.listTitles()).toEqual([]);
  });
});

describe("keyboard", () => {
  it("clamps arrow-key selection to the list", () => {
    expect(moveSelection(-1, 1, 3)).toBe(0);
    expect(moveSelection(2, 1, 3)).toBe(2);
    expect(moveSelection(0, -1, 3)).toBe(0);
    expect(moveSelection(0, 1, 0)).toBe(-1);
  });

  it("opens on Cmd-K or Ctrl-K only", () => {
    const key = { key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isQuickAddShortcut({ ...key, metaKey: true })).toBe(true);
    expect(isQuickAddShortcut({ ...key, ctrlKey: true, key: "K" })).toBe(true);
    expect(isQuickAddShortcut(key)).toBe(false);
    expect(isQuickAddShortcut({ ...key, ctrlKey: true, shiftKey: true })).toBe(false);
  });
});
