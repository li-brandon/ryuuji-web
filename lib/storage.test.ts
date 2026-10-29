import "fake-indexeddb/auto";
import { openDB } from "idb";
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
    uid: `00000000-0000-4000-8000-${uid.charCodeAt(0).toString().padStart(12, "0")}`,
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
      uid: "00000000-0000-4000-8000-000000000001", tmdbId: original.tmdbId, kind: "show", season: 1, episode: 2,
      tmdbEpisodeId: null, watchedAt: "2026-01-01T00:00:00Z", batchId: "00000000-0000-4000-8000-000000000003",
    };
    const orphan = { ...watched, uid: "00000000-0000-4000-8000-000000000002", tmdbEpisodeId: 999 };
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

it("closes an old connection when another tab upgrades", async () => {
  const { name, db } = await setup();
  const close = vi.spyOn(db, "close");
  const upgraded = await openDB(name, 2);
  expect(close).toHaveBeenCalledOnce();
  expect(upgraded.version).toBe(2);
  upgraded.close();
});

it("validates all write paths and preserves undefined update fields", async () => {
  const { repo } = await setup();
  await expect(repo.createTitle(title({ addedAt: "bad" }))).rejects.toThrow();
  expect(await repo.listTitles()).toEqual([]);
  await repo.createTitle(title({ notes: "Keep me" }));
  await repo.updateTitle(title(), { notes: undefined });
  const before = await repo.getTitle(title());
  expect(before?.notes).toBe("Keep me");
  await expect(repo.updateTitle(title(), { score: 1.5 })).rejects.toThrow();
  await expect(repo.applyMetadata(title(), { providerData: { region: "US", fetchedAt: "bad", providers: [], rent: [], buy: [], link: null } }, "2026-10-29")).rejects.toThrow();
  await expect(repo.addWatchEvent(event("a", { watchedAt: "bad" }))).rejects.toThrow();
  await repo.addWatchEvent(event("a"));
  await expect(repo.commitWatchLog(title(), { add: [event("b", { batchId: "bad" })], remove: [event("a").uid], status: "completed" })).rejects.toThrow();
  expect(await repo.getTitle(title())).toEqual(before);
  expect(await repo.listWatchEvents(title())).toEqual([event("a")]);
});

it("handles a failed IndexedDB request and its transaction rejection together", async () => {
  const { repo } = await setup();
  await repo.createTitle(title());
  await repo.addWatchEvent(event("a"));
  await expect(repo.addWatchEvent(event("a"))).rejects.toMatchObject({ name: "ConstraintError" });
  expect(await repo.listWatchEvents(title())).toEqual([event("a")]);
  await repo.addWatchEvent(event("b"));
  expect(await repo.listWatchEvents(title())).toHaveLength(2);
});
