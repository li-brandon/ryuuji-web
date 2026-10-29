import { titleProgress } from "./progress";
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import movie from "../test/fixtures/tmdb/movie-27205.json";
import searchMovie from "../test/fixtures/tmdb/search-movie.json";
import breakingBad from "../test/fixtures/tmdb/tv-1396.json";
import breakingBadSeason1 from "../test/fixtures/tmdb/tv-1396-season-1.json";
import {
  addTitle,
  existingTitleHref,
  isQuickAddShortcut,
  itemId,
  moveSelection,
  refreshTitle,
  searchTitles,
  shortcutStatus,
  type Fetcher,
  type SearchItem,
} from "./quick-add";
import { LibraryRepository, openLibraryDB } from "./storage";
import { TMDBRequestError } from "./tmdb-client";
import { UndoStack } from "./undo-stack";
import { InvalidStatusError, WatchLogService } from "./watch-log";

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

describe("adding with a status (LIB-415)", () => {
  const key = { key: "1", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };

  it("maps Cmd/Ctrl-1 to 6 like the macOS panel", () => {
    expect(["1", "2", "3", "4", "5", "6"].map((k) => shortcutStatus({ ...key, key: k }, "show"))).toEqual([
      "planToWatch", "watching", "caughtUp", "onHold", "dropped", "completed",
    ]);
    expect(shortcutStatus({ ...key, metaKey: false, ctrlKey: true, key: "6" }, "movie")).toBe("completed");
  });

  it("ignores other keys and statuses the result's kind doesn't allow", () => {
    expect(shortcutStatus({ ...key, key: "3" }, "movie")).toBeNull();
    expect(shortcutStatus({ ...key, key: "7" }, "show")).toBeNull();
    expect(shortcutStatus({ ...key, metaKey: false }, "show")).toBeNull();
    expect(shortcutStatus({ ...key, shiftKey: true }, "show")).toBeNull();
  });

  it("opens the detail page for a title already in the library", () => {
    expect(existingTitleHref(bb, new Set([itemId(bb)]))).toBe("/title/show/1396");
    expect(existingTitleHref(inception, new Set([itemId(bb)]))).toBeNull();
  });

  it("adds as Completed through setStatus: logs what's aired as one undo step", async () => {
    const library = await repo();
    const undo = new UndoStack();
    const fetcher = fakeFetcher({
      "tv/1396": breakingBad,
      "tv/1396?append_to_response=season%2F1": { ...breakingBad, "season/1": breakingBadSeason1 },
    });
    const watchLog = new WatchLogService(library, { now: () => now });
    const { title } = await addTitle(library, bb, "completed", { fetcher, now, undo, watchLog });
    expect(title.status).toBe("completed");
    expect(await library.listWatchEvents(bb)).toHaveLength(breakingBadSeason1.episodes.length);
    expect(undo.size).toBe(1);

    await undo.undo();
    expect((await library.getTitle(bb))?.status).toBe("planToWatch");
    expect(await library.listWatchEvents(bb)).toEqual([]);
  });

  it("registers no undo step for the default status", async () => {
    const library = await repo();
    const undo = new UndoStack();
    await addTitle(library, inception, "planToWatch", { fetcher: fakeFetcher({ "movie/27205": movie }), now, undo });
    expect(undo.size).toBe(0);
  });

  it("rejects a status the kind doesn't allow before fetching", async () => {
    const library = await repo();
    const fetcher = fakeFetcher({ "movie/27205": movie });
    await expect(addTitle(library, inception, "caughtUp", { fetcher, now })).rejects.toThrow(InvalidStatusError);
    await expect(addTitle(library, inception, "rewatching", { fetcher, now })).rejects.toThrow(InvalidStatusError);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await library.listTitles()).toEqual([]);
  });
});

describe("refreshTitle (LIB-415)", () => {
  const fetcher = () =>
    fakeFetcher({
      "tv/1396": breakingBad,
      "tv/1396?append_to_response=season%2F1": { ...breakingBad, "season/1": breakingBadSeason1 },
    });

  it("replaces metadata but keeps history and user fields", async () => {
    const library = await repo();
    const { title } = await addTitle(library, bb, "planToWatch", { fetcher: fetcher(), now });
    const first = title.episodes!.seasons[0].episodes[0];
    await library.updateTitle(bb, { name: "Old name", episodes: null, score: 9, notes: "Rewatch with friends", status: "onHold" });
    const event = { uid: crypto.randomUUID(), tmdbId: 1396, kind: "show" as const, watchedAt: now.toISOString(), season: 1, episode: 1, tmdbEpisodeId: first.tmdbId, batchId: null };
    await library.addWatchEvent(event);

    const later = new Date("2026-10-29T12:00:00.000Z");
    const refreshed = await refreshTitle(library, bb, { fetcher: fetcher(), now: later, today: "2026-10-29" });
    expect(refreshed).toMatchObject({
      name: "Breaking Bad",
      score: 9,
      notes: "Rewatch with friends",
      status: "onHold",
      addedAt: now.toISOString(),
      lastRefreshedAt: later.toISOString(),
      metadataRevision: title.metadataRevision + 1,
    });
    expect(refreshed.episodes?.seasons[0].episodes).toHaveLength(breakingBadSeason1.episodes.length);
    expect(await library.listWatchEvents(bb)).toEqual([event]);
  });

  it("keeps notes and a score edited while the fetch is in flight", async () => {
    const library = await repo();
    await addTitle(library, bb, "planToWatch", { fetcher: fetcher(), now });
    await library.updateTitle(bb, { score: 5, notes: "before" });
    const inner = fetcher();
    const editing = vi.fn(async (...args: Parameters<Fetcher>) => {
      await library.updateTitle(bb, { score: 8, notes: "typed during refresh", status: "dropped" });
      return inner(...args);
    }) as unknown as Fetcher;

    const refreshed = await refreshTitle(library, bb, { fetcher: editing, now, today: "2026-10-29" });
    expect(refreshed).toMatchObject({ score: 8, notes: "typed during refresh", status: "dropped" });
    expect(await library.getTitle(bb)).toMatchObject({ score: 8, notes: "typed during refresh" });
  });

  it("applies the refresh status rule", async () => {
    const library = await repo();
    await addTitle(library, bb, "planToWatch", { fetcher: fetcher(), now });
    await library.updateTitle(bb, { status: "caughtUp" });
    // Season 1 is aired and unwatched, so a Caught Up show goes back to Watching.
    expect((await refreshTitle(library, bb, { fetcher: fetcher(), now, today: "2026-10-29" })).status).toBe("watching");
  });

  it("remaps renumbered episodes and retains removed events through refresh", async () => {
    const library = await repo();
    const { title } = await addTitle(library, bb, "planToWatch", { fetcher: fetcher(), now });
    const service = new WatchLogService(library, { today: () => "2026-10-29" });
    await library.updateTitle(bb, { showStatus: "Returning Series" });
    await service.bulkMark(title, "all");
    const before = await library.listWatchEvents(bb);
    const moved = breakingBadSeason1.episodes[0];
    const refreshed = await refreshTitle(library, bb, {
      now, today: "2026-10-29",
      fetcher: fakeFetcher({
        "tv/1396": { ...breakingBad, status: "Returning Series", seasons: [{ season_number: 2 }] },
        "tv/1396?append_to_response=season%2F2": {
          "season/2": { ...breakingBadSeason1, season_number: 2, episodes: [{ ...moved, season_number: 2, episode_number: 1 }] },
        },
      }),
    });
    const after = await library.listWatchEvents(bb);
    expect(after).toHaveLength(before.length);
    expect(after.find((e) => e.tmdbEpisodeId === moved.id)).toEqual({
      ...before.find((e) => e.tmdbEpisodeId === moved.id), season: 2, episode: 1,
    });
    expect(after.filter((e) => e.tmdbEpisodeId !== moved.id)).toEqual(before.filter((e) => e.tmdbEpisodeId !== moved.id));
    expect(titleProgress(refreshed, after, "2026-10-29")).toMatchObject({ remaining: 0, orphanCount: before.length - 1 });
    expect(refreshed.status).toBe("caughtUp");
  });

  it("writes nothing when TMDB fails", async () => {
    const library = await repo();
    await addTitle(library, bb, "planToWatch", { fetcher: fetcher(), now });
    const before = await library.getTitle(bb);
    await expect(refreshTitle(library, bb, { fetcher: fakeFetcher({}), now })).rejects.toThrow(TMDBRequestError);
    expect(await library.getTitle(bb)).toEqual(before);
  });
});
