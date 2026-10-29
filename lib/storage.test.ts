import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DuplicateTitleError,
  LibraryRepository,
  openLibraryDB,
  requestPersistentStorage,
  TitleNotFoundError,
} from "./storage";
import type { Title, WatchEvent } from "./types";

let dbCount = 0;

function title(overrides: Partial<Title> = {}): Title {
  return {
    tmdbId: 1399,
    kind: "show",
    name: "Game of Thrones",
    originalName: "Game of Thrones",
    overview: "",
    posterPath: null,
    releaseDate: "2011-04-17",
    genres: ["Drama"],
    originCountries: ["US"],
    originalLanguage: "en",
    runtime: null,
    isAnime: false,
    showStatus: "Ended",
    episodes: { schemaVersion: 1, seasons: [] },
    metadataRevision: 0,
    lastRefreshedAt: null,
    providerData: null,
    status: "planToWatch",
    score: null,
    notes: "",
    addedAt: "2026-10-28T00:00:00.000Z",
    ...overrides,
  };
}

function event(uid: string, overrides: Partial<WatchEvent> = {}): WatchEvent {
  return {
    uid,
    tmdbId: 1399,
    kind: "show",
    watchedAt: "2026-10-28T12:00:00.000Z",
    season: 1,
    episode: 1,
    tmdbEpisodeId: null,
    batchId: null,
    ...overrides,
  };
}

async function setup() {
  const name = `test-${++dbCount}`;
  const db = await openLibraryDB(name);
  return { name, db, repo: new LibraryRepository(db) };
}

describe("LibraryRepository", () => {
  it("creates and reads titles", async () => {
    const { repo } = await setup();
    await repo.createTitle(title());
    expect(await repo.getTitle({ tmdbId: 1399, kind: "show" })).toEqual(title());
    expect(await repo.getTitle({ tmdbId: 1399, kind: "movie" })).toBeUndefined();
    expect(await repo.listTitles()).toEqual([title()]);
  });

  it("rejects a duplicate tmdbId + kind but allows the same id with another kind", async () => {
    const { repo } = await setup();
    await repo.createTitle(title());
    await expect(repo.createTitle(title({ name: "Other" }))).rejects.toBeInstanceOf(DuplicateTitleError);
    await repo.createTitle(title({ kind: "movie" }));
    expect(await repo.listTitles()).toHaveLength(2);
  });

  it("updates a title", async () => {
    const { repo } = await setup();
    await repo.createTitle(title());
    const updated = await repo.updateTitle(title(), { status: "watching", score: 8 });
    expect(updated).toEqual(title({ status: "watching", score: 8 }));
    expect(await repo.getTitle(title())).toEqual(updated);
    await expect(repo.updateTitle({ tmdbId: 1, kind: "movie" }, {})).rejects.toBeInstanceOf(TitleNotFoundError);
  });

  it("adds and lists watch events per title", async () => {
    const { repo } = await setup();
    await repo.createTitle(title());
    await repo.createTitle(title({ kind: "movie" }));
    await repo.addWatchEvent(event("a"));
    await repo.addWatchEvent(event("b", { kind: "movie", season: null, episode: null }));
    expect(await repo.listWatchEvents(title())).toEqual([event("a")]);
    await expect(repo.addWatchEvent(event("c", { tmdbId: 2 }))).rejects.toBeInstanceOf(TitleNotFoundError);
  });

  it("deletes a title with its watch events", async () => {
    const { repo } = await setup();
    await repo.createTitle(title());
    await repo.createTitle(title({ kind: "movie" }));
    await repo.addWatchEvent(event("a"));
    await repo.addWatchEvent(event("b"));
    await repo.addWatchEvent(event("c", { kind: "movie" }));
    await repo.deleteTitle(title());
    expect(await repo.getTitle(title())).toBeUndefined();
    expect(await repo.listWatchEvents(title())).toEqual([]);
    expect(await repo.listWatchEvents(title({ kind: "movie" }))).toHaveLength(1);
  });

  it("persists across reopening the database", async () => {
    const { name, db, repo } = await setup();
    await repo.createTitle(title());
    await repo.addWatchEvent(event("a"));
    db.close();
    const reopened = new LibraryRepository(await openLibraryDB(name));
    expect(await reopened.getTitle(title())).toEqual(title());
    expect(await reopened.listWatchEvents(title())).toEqual([event("a")]);
  });
});

describe("requestPersistentStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls navigator.storage.persist when available", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", { storage: { persist } });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("returns false when unsupported", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestPersistentStorage()).toBe(false);
  });
});

it("stores new episode metadata and fills ID-less history together without losing orphans", async () => {
  const db = await openLibraryDB(`metadata-${dbCount++}`);
  try {
    const repo = new LibraryRepository(db);
    const original = await repo.createTitle(title({ status: "watching" }));
    const watched: WatchEvent = {
      uid: "idless", tmdbId: original.tmdbId, kind: "show", season: 1, episode: 2,
      tmdbEpisodeId: null, watchedAt: "2026-01-01T00:00:00Z", batchId: "original",
    };
    const orphan = { ...watched, uid: "removed", tmdbEpisodeId: 999 };
    await repo.addWatchEvent(watched);
    await repo.addWatchEvent(orphan);
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const updated = await repo.applyMetadata(original, {
      episodes: { schemaVersion: 1, seasons: [{ number: 1, name: "Season 1", episodes: [
        { tmdbId: 12, season: 1, number: 2, name: "Episode", airDate: "2026-01-01", runtime: null },
      ] }] },
    }, "2026-06-15");
    const eventWrites = put.mock.calls.filter(([value]) => value && typeof value === "object" && "uid" in value);
    expect(eventWrites.map(([value]) => value)).toEqual([{ ...watched, tmdbEpisodeId: 12 }]);
    put.mockClear();
    await repo.applyMetadata(original, { episodes: updated.episodes }, "2026-06-15");
    expect(put.mock.calls.filter(([value]) => value && typeof value === "object" && "uid" in value)).toEqual([]);
    put.mockRestore();
    expect(updated.metadataRevision).toBe(1);
    expect(updated.status).toBe("completed");
    expect(await repo.getTitle(original)).toEqual({ ...updated, metadataRevision: 2 });
    expect(await repo.listWatchEvents(original)).toEqual([{ ...watched, tmdbEpisodeId: 12 }, orphan]);
  } finally {
    db.close();
  }
});
