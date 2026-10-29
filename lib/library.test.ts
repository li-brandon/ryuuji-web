import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as F from "../test/domain-fixtures";
import { libraryFiltersSchema, selectLibrary } from "./library";
import { LibraryRepository, openLibraryDB } from "./storage";

const a = { ...F.show(F.season(1, 2), "watching"), name: "Alpha", isAnime: true, score: 8, addedAt: "2026-01-01T00:00:00Z" };
const b = { ...F.movie(), name: "Beta", isAnime: false, score: 10, addedAt: "2026-02-01T00:00:00Z" };
const entries = [{ title: b, events: [] }, { title: a, events: [{ ...F.event(F.episode(1, 1)), tmdbId: a.tmdbId, kind: a.kind, uid: "00000000-0000-4000-8000-000000000001", batchId: null, watchedAt: "2026-03-01T00:00:00Z" }] }];
const filters = (changes = {}) => libraryFiltersSchema.parse({ ...changes });
describe("Library selection", () => {
  it("groups by status and counts before status filtering", () => {
    const result = selectLibrary(entries, filters({ status: "watching" }));
    expect(result.visible.map(({ title }) => title.name)).toEqual(["Alpha"]);
    expect(result.total).toBe(2);
    expect(result.counts.watching).toBe(1);
    expect(result.groups).toEqual([{ status: "watching", entries: [entries[1]] }]);
  });
  it("combines kind and anime filters and supports no matches", () => {
    expect(selectLibrary(entries, filters({ kind: "show", anime: "1" })).total).toBe(1);
    expect(selectLibrary(entries, filters({ kind: "movie", anime: "1" })).visible).toEqual([]);
    expect(selectLibrary([], filters()).groups).toEqual([]);
  });
  it.each([ ["name", ["Alpha", "Beta"]], ["added", ["Beta", "Alpha"]], ["watched", ["Alpha", "Beta"]], ["score", ["Beta", "Alpha"]] ])("sorts by %s without mutating input", (sort, expected) => {
    expect(selectLibrary(entries, filters({ sort })).visible.map(({ title }) => title.name)).toEqual(expected);
    expect(entries[0].title.name).toBe("Beta");
  });
  it("puts unwatched and unscored titles last and breaks ties by name", () => {
    const unscored = { title: { ...b, score: null }, events: [] };
    expect(selectLibrary([unscored, entries[1]], filters({ sort: "score" })).visible[1]).toEqual(unscored);
    expect(selectLibrary(entries.map((entry) => ({ ...entry, events: [] })), filters()).visible.map(({ title }) => title.name)).toEqual(["Alpha", "Beta"]);
    expect(filters({ kind: "bad", status: "bad", sort: "bad", anime: "bad" })).toEqual({ kind: "all", status: "all", sort: "watched", anime: "0" });
  });
  it("counts statuses after the kind and anime filters but before the status filter", () => {
    const anime = selectLibrary(entries, filters({ anime: "1", status: "planToWatch" }));
    expect(anime.total).toBe(1);
    expect(anime.counts).toMatchObject({ watching: 1, planToWatch: 0 });
    expect(anime.visible).toEqual([]);
    const movies = selectLibrary(entries, filters({ kind: "movie" }));
    expect(movies.total).toBe(1);
    expect(movies.counts).toMatchObject({ watching: 0, planToWatch: 1 });
  });
  it("breaks name ties by kind, then id", () => {
    const show = (tmdbId: number) => ({ title: { ...a, name: "Same", tmdbId }, events: [] });
    const movie = { title: { ...b, name: "Same", tmdbId: 1 }, events: [] };
    expect(selectLibrary([show(9), show(3), movie], filters({ sort: "name" })).visible).toEqual([movie, show(3), show(9)]);
  });
  it("sorts names case-insensitively", () => {
    const names = ["beta", "Alpha", "Charlie", "alpha2"].map((name, i) => ({ title: { ...b, name, tmdbId: 100 + i }, events: [] }));
    expect(selectLibrary(names, filters({ sort: "name" })).visible.map(({ title }) => title.name)).toEqual(["Alpha", "alpha2", "beta", "Charlie"]);
  });
  it("sorts unscored titles after every scored one, including a score of 0", () => {
    const scored = (name: string, score: number | null) => ({ title: { ...b, name, score, tmdbId: name.charCodeAt(0) }, events: [] });
    const list = [scored("Ada", null), scored("Bob", 0), scored("Cy", null), scored("Di", 5)];
    expect(selectLibrary(list, filters({ sort: "score" })).visible.map(({ title }) => title.name)).toEqual(["Di", "Bob", "Ada", "Cy"]);
  });
  it("breaks equal scores by name, then kind and id", () => {
    const scored = (name: string, kind: "movie" | "show", tmdbId: number) => ({ title: { ...(kind === "show" ? a : b), name, score: 7, tmdbId }, events: [] });
    const list = [scored("Zed", "movie", 1), scored("Mid", "show", 2), scored("Mid", "movie", 5), scored("Mid", "movie", 3)];
    expect(selectLibrary(list, filters({ sort: "score" })).visible.map(({ title }) => `${title.name}-${title.kind}-${title.tmdbId}`)).toEqual(["Mid-movie-3", "Mid-movie-5", "Mid-show-2", "Zed-movie-1"]);
  });
  it("removal cascades watch events and preserves the other kind with the same id", async () => {
    const db = await openLibraryDB("library-removal");
    try {
      const repo = new LibraryRepository(db);
      await repo.createTitle(a);
      const other = { ...b, tmdbId: a.tmdbId };
      await repo.createTitle(other);
      await repo.addWatchEvent(entries[1].events[0]);
      await repo.addWatchEvent({ ...entries[1].events[0], uid: "00000000-0000-4000-8000-000000000002", kind: "movie" });
      await repo.deleteTitle(a);
      expect(await repo.getTitle(a)).toBeUndefined();
      expect(await repo.getWatchEvent("watch")).toBeUndefined();
      expect(await repo.getTitle(other)).toEqual(other);
      expect(await repo.listWatchEvents(other)).toHaveLength(1);
    } finally { db.close(); }
  });
});
