import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Kind, ListStatus, Title, TitleKey, WatchEvent } from "./types";

// Local-only IndexedDB storage for the library.

export const DB_NAME = "ryuuji";
export const DB_VERSION = 1;

interface RyuujiDB extends DBSchema {
  titles: { key: [number, Kind]; value: Title };
  watchEvents: { key: string; value: WatchEvent; indexes: { byTitle: [number, Kind] } };
}

export class DuplicateTitleError extends Error {
  constructor(readonly key: TitleKey) {
    super(`Title ${key.kind} ${key.tmdbId} already exists`);
    this.name = "DuplicateTitleError";
  }
}

export class TitleNotFoundError extends Error {
  constructor(readonly key: TitleKey) {
    super(`Title ${key.kind} ${key.tmdbId} not found`);
    this.name = "TitleNotFoundError";
  }
}

const keyOf = ({ tmdbId, kind }: TitleKey): [number, Kind] => [tmdbId, kind];

export function openLibraryDB(name = DB_NAME): Promise<IDBPDatabase<RyuujiDB>> {
  return openDB<RyuujiDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Add a `case` per version bump; each step migrates from the previous version.
      if (oldVersion < 1) {
        db.createObjectStore("titles", { keyPath: ["tmdbId", "kind"] });
        db.createObjectStore("watchEvents", { keyPath: "uid" }).createIndex("byTitle", ["tmdbId", "kind"]);
      }
    },
  });
}

/** Titles and their watch events. One title per TMDB id + kind, like the macOS TitleRepository. */
export class LibraryRepository {
  constructor(private readonly db: IDBPDatabase<RyuujiDB>) {}

  async createTitle(title: Title): Promise<Title> {
    const tx = this.db.transaction("titles", "readwrite");
    if (await tx.store.getKey(keyOf(title))) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new DuplicateTitleError(title);
    }
    await tx.store.add(title);
    await tx.done;
    return title;
  }

  getTitle(key: TitleKey): Promise<Title | undefined> {
    return this.db.get("titles", keyOf(key));
  }

  listTitles(): Promise<Title[]> {
    return this.db.getAll("titles");
  }

  /** Applies `changes` to an existing title. The key fields can't change. */
  async updateTitle(key: TitleKey, changes: Partial<Omit<Title, "tmdbId" | "kind">>): Promise<Title> {
    const tx = this.db.transaction("titles", "readwrite");
    const existing = await tx.store.get(keyOf(key));
    if (!existing) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new TitleNotFoundError(key);
    }
    const updated = { ...existing, ...changes, tmdbId: existing.tmdbId, kind: existing.kind };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  /** Deletes the title and all its watch events in one transaction. */
  async deleteTitle(key: TitleKey): Promise<void> {
    const tx = this.db.transaction(["titles", "watchEvents"], "readwrite");
    const events = tx.objectStore("watchEvents");
    for (const uid of await events.index("byTitle").getAllKeys(keyOf(key))) {
      await events.delete(uid);
    }
    await tx.objectStore("titles").delete(keyOf(key));
    await tx.done;
  }

  async addWatchEvent(event: WatchEvent): Promise<void> {
    const tx = this.db.transaction(["titles", "watchEvents"], "readwrite");
    if (!(await tx.objectStore("titles").getKey(keyOf(event)))) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new TitleNotFoundError(event);
    }
    await tx.objectStore("watchEvents").add(event);
    await tx.done;
  }

  listWatchEvents(key: TitleKey): Promise<WatchEvent[]> {
    return this.db.getAllFromIndex("watchEvents", "byTitle", keyOf(key));
  }

  getWatchEvent(uid: string): Promise<WatchEvent | undefined> {
    return this.db.get("watchEvents", uid);
  }

  /**
   * Writes one watch-log change in a single transaction: puts `add`, deletes the `remove` uids
   * and sets the title's status. Throws `TitleNotFoundError` (writing nothing) if the title is gone.
   */
  async commitWatchLog(
    key: TitleKey,
    change: { add: WatchEvent[]; remove: string[]; status: ListStatus },
  ): Promise<Title> {
    const tx = this.db.transaction(["titles", "watchEvents"], "readwrite");
    const titles = tx.objectStore("titles");
    const existing = await titles.get(keyOf(key));
    if (!existing) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new TitleNotFoundError(key);
    }
    const events = tx.objectStore("watchEvents");
    for (const uid of change.remove) await events.delete(uid);
    for (const event of change.add) await events.put(event);
    const updated = { ...existing, status: change.status };
    await titles.put(updated);
    await tx.done;
    return updated;
  }
}

/** Asks the browser not to evict local data. Resolves false when unsupported or denied. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

let shared: Promise<LibraryRepository> | undefined;

/** The app's library, opened on first use. Browser only. */
export function libraryRepository(): Promise<LibraryRepository> {
  shared ??= openLibraryDB().then((db) => new LibraryRepository(db));
  return shared;
}
