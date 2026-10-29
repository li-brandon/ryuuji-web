import { setTheme } from "./theme";
import { saveWatchPreferences } from "./watch-preferences";
import { planLibraryImport, readLibraryFile, type ImportPlan } from "./library-import";
import { withWatchLogLock } from "./watch-log-lock";
import { notifyLibraryChanged } from "./library-changes";
import { remapEvents, titleEpisodes } from "./progress";
import { statusAfterRefresh } from "./status-engine";
import { openDB, type DBSchema, type IDBPTransaction, type IDBPDatabase } from "idb";
import { titleSchema, watchEventSchema } from "./types";
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
  const connection = openDB<RyuujiDB>(name, DB_VERSION, {
    blocking() {
      void connection.then((db) => db.close());
    },
    upgrade(db, oldVersion) {
      // Add a `case` per version bump; each step migrates from the previous version.
      if (oldVersion < 1) {
        db.createObjectStore("titles", { keyPath: ["tmdbId", "kind"] });
        db.createObjectStore("watchEvents", { keyPath: "uid" }).createIndex("byTitle", ["tmdbId", "kind"]);
      }
    },
  });
  return connection;
}

/** Titles and their watch events. One title per TMDB id + kind, like the macOS TitleRepository. */
export class LibraryRepository {
  constructor(private readonly db: IDBPDatabase<RyuujiDB>) {}

  /** Observe request and transaction failures together, including failures before the final write. */
  private async write<T>(operation: (tx: IDBPTransaction<RyuujiDB, ["titles", "watchEvents"], "readwrite">) => Promise<T>): Promise<T> {
    const tx = this.db.transaction(["titles", "watchEvents"], "readwrite");
    const result = (async () => {
      try {
        return await operation(tx);
      } catch (error) {
        // Validation or a synchronous request error must roll back earlier requests too.
        try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
        throw error;
      }
    })();
    const [value] = await Promise.all([result, tx.done]).catch(async (error: unknown) => {
      // Prefer the request/validation error over the transaction's generic AbortError.
      await result;
      throw error;
    });
    return value;
  }

  async librarySnapshot(): Promise<{ titles: Title[]; events: WatchEvent[] }> {
    const tx = this.db.transaction(["titles", "watchEvents"], "readonly");
    const [titles, events] = await Promise.all([tx.objectStore("titles").getAll(), tx.objectStore("watchEvents").getAll()]);
    await tx.done;
    return { titles, events };
  }

  async importLibrary(plan: Pick<ImportPlan, "file">): Promise<ImportPlan> {
    const file = readLibraryFile(plan.file);
    return withWatchLogLock(async () => {
      const result = await this.write(async (tx) => {
        const titles = tx.objectStore("titles");
        const events = tx.objectStore("watchEvents");
        const current = planLibraryImport(file, await titles.getAll(), await events.getAll());
        for (const title of current.titles) await titles.put(titleSchema.parse(title));
        for (const event of current.events) await events.add(watchEventSchema.parse(event));
        return current;
      });
      if (file.settings?.theme !== undefined) setTheme(file.settings.theme);
      if (file.settings?.watch !== undefined) saveWatchPreferences(file.settings.watch);
      if (result.titles.length || result.events.length) notifyLibraryChanged();
      return result;
    });
  }

  async createTitle(title: Title): Promise<Title> {
    const validated = titleSchema.parse(title);
    return this.write(async (tx) => {
      const store = tx.objectStore("titles");
      if (await store.getKey(keyOf(validated))) throw new DuplicateTitleError(validated);
      await store.add(validated);
      return validated;
    });
  }

  getTitle(key: TitleKey): Promise<Title | undefined> {
    return this.db.get("titles", keyOf(key));
  }

  listTitles(): Promise<Title[]> {
    return this.db.getAll("titles");
  }

  /** Applies `changes` to an existing title. The key fields can't change. */
  async updateTitle(key: TitleKey, changes: Partial<Omit<Title, "tmdbId" | "kind">>): Promise<Title> {
    return this.write(async (tx) => {
      const existing = await tx.objectStore("titles").get(keyOf(key));
      if (!existing) {
        throw new TitleNotFoundError(key);
      }
      const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
      const updated = titleSchema.parse({ ...existing, ...defined, tmdbId: existing.tmdbId, kind: existing.kind });
      await tx.objectStore("titles").put(updated);
      return updated;
    });
  }

  /** Saves metadata, remaps history, and derives status from the latest state in one transaction. */
  async applyMetadata(
    key: TitleKey,
    metadata: Partial<Pick<Title,
      "name" | "originalName" | "overview" | "posterPath" | "releaseDate" | "genres" | "originCountries" |
      "originalLanguage" | "runtime" | "isAnime" | "showStatus" | "episodes" | "providerData" | "lastRefreshedAt"
    >>,
    today: string,
  ): Promise<Title> {
    return this.write(async (tx) => {
      const titles = tx.objectStore("titles");
      const existing = await titles.get(keyOf(key));
      if (!existing) {
        throw new TitleNotFoundError(key);
      }
      const updated = titleSchema.parse({ ...existing, ...metadata, metadataRevision: existing.metadataRevision + 1 });
      const store = tx.objectStore("watchEvents");
      const originals = await store.index("byTitle").getAll(keyOf(key));
      const events = remapEvents(originals, titleEpisodes(updated));
      for (const [index, event] of events.entries()) {
        const original = originals[index];
        // Remapping preserves order and only changes these episode identity fields.
        if (event.season !== original.season || event.episode !== original.episode ||
            event.tmdbEpisodeId !== original.tmdbEpisodeId) {
          await store.put(watchEventSchema.parse(event));
        }
      }
      updated.status = statusAfterRefresh(updated, events, today);
      await titles.put(updated);
      return updated;
    });
  }

  /** Deletes the title and all its watch events in one transaction. */
  async deleteTitle(key: TitleKey): Promise<void> {
    return this.write(async (tx) => {
      const events = tx.objectStore("watchEvents");
      for (const uid of await events.index("byTitle").getAllKeys(keyOf(key))) {
        await events.delete(uid);
      }
      await tx.objectStore("titles").delete(keyOf(key));
    });
  }

  async addWatchEvent(event: WatchEvent): Promise<void> {
    event = watchEventSchema.parse(event);
    return this.write(async (tx) => {
      if (!(await tx.objectStore("titles").getKey(keyOf(event)))) {
        throw new TitleNotFoundError(event);
      }
      await tx.objectStore("watchEvents").add(event);
    });
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
    return this.write(async (tx) => {
      const titles = tx.objectStore("titles");
      const existing = await titles.get(keyOf(key));
      if (!existing) {
        throw new TitleNotFoundError(key);
      }
      const events = tx.objectStore("watchEvents");
      const validated = change.add.map((event) => watchEventSchema.parse(event));
      const updated = titleSchema.parse({ ...existing, status: change.status });
      for (const uid of change.remove) await events.delete(uid);
      for (const event of validated) await events.put(event);
      await titles.put(updated);
      return updated;
    });
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
