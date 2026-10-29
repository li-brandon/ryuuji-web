import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { show } from "../test/fixtures/refresh";
import { LibraryRepository, openLibraryDB } from "./storage";
import { LAST_REFRESH_KEY, RefreshScheduler } from "./refresh-scheduler";
import { REFRESH_INTERVAL } from "./refresh";

let count = 0;
afterEach(() => vi.useRealTimers());
async function setup(locks?: Pick<LockManager, "request">) {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
  const db = await openLibraryDB(`refresh-${count++}`);
  const repo = new LibraryRepository(db);
  await repo.createTitle(show);
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  const window = new EventTarget();
  let online = true;
  const changed = vi.fn();
  // Empty show response is valid mapper input; no external requests.
  const fetcher = vi.fn(async () => ({ id: 1, name: "Refreshed", status: "Returning Series", genres: [], seasons: [], results: {} }));
  const scheduler = new RefreshScheduler({ repository: async () => repo, storage, document, window, online: () => online, changed, locks, fetcher: async <T>() => JSON.parse(JSON.stringify(await fetcher())) as T, yield: async () => {} });
  return { scheduler, repo, db, storage, document, window, changed, fetcher, offline: () => { online = false; }, online: () => { online = true; } };
}
async function settled(scheduler: RefreshScheduler) {
  await vi.waitFor(() => expect(scheduler.getSnapshot().running).toBe(false));
}
describe("refresh scheduler", () => {
  it("runs on launch, skips fresh wakeups, refreshes at 24h, cleans up", async () => {
    const s = await setup();
    s.scheduler.start();
    await settled(s.scheduler);
    expect(s.changed).toHaveBeenCalledTimes(1);
    expect(Date.now() - Number(s.storage.getItem(LAST_REFRESH_KEY))).toBeLessThan(1000);
    s.document.dispatchEvent(new Event("visibilitychange"));
    await settled(s.scheduler);
    expect(s.changed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL);
    await settled(s.scheduler);
    expect(s.changed).toHaveBeenCalledTimes(2);
    s.scheduler.stop();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL);
    s.window.dispatchEvent(new Event("online"));
    expect(s.changed).toHaveBeenCalledTimes(2);
    s.db.close();
  });
  it("keeps cached data offline and retries on online", async () => {
    const s = await setup();
    s.offline();
    s.scheduler.start();
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(await s.repo.getTitle(show)).toEqual(show);
    expect(s.storage.getItem(LAST_REFRESH_KEY)).toBeNull();
    s.online();
    s.window.dispatchEvent(new Event("online"));
    await settled(s.scheduler);
    expect(s.changed).toHaveBeenCalledOnce();
    s.scheduler.stop(); s.db.close();
  });
  it("skips failed titles without writing, continues sequentially and retries", async () => {
    const s = await setup();
    await s.repo.createTitle({ ...show, tmdbId: 2 });
    s.fetcher.mockRejectedValueOnce(new Error("offline"));
    await s.scheduler.refresh();
    expect(await s.repo.getTitle(show)).toEqual(show);
    expect((await s.repo.getTitle({ ...show, tmdbId: 2 }))?.name).toBe("Refreshed");
    expect(s.storage.getItem(LAST_REFRESH_KEY)).toBeNull();
    await s.scheduler.refresh(false);
    expect((await s.repo.getTitle(show))?.name).toBe("Refreshed");
    s.db.close();
  });
  it("prevents overlapping runs and respects a fallback lease held by another tab", async () => {
    const s = await setup();
    s.storage.setItem("ryuuji-refresh-lease", `${Date.now()}:other`);
    await s.scheduler.refresh();
    expect(s.fetcher).not.toHaveBeenCalled();
    s.storage.removeItem("ryuuji-refresh-lease");
    await Promise.all([s.scheduler.refresh(), s.scheduler.refresh()]);
    expect(s.changed).toHaveBeenCalledOnce();
    s.db.close();
  });
  it("requests the named Web Lock without waiting and skips when unavailable", async () => {
    const request = vi.fn(async <T>(name: string, options: LockOptions | LockGrantedCallback<T>, callback?: LockGrantedCallback<T>): Promise<T> => {
      expect(name).toBe("ryuuji-refresh");
      expect(options).toEqual({ ifAvailable: true });
      if (!callback) throw new Error("Expected callback");
      return callback(null);
    });
    const s = await setup({ request });
    await s.scheduler.refresh();
    expect(request).toHaveBeenCalledOnce();
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.scheduler.getSnapshot().running).toBe(false);
    expect(s.storage.getItem(LAST_REFRESH_KEY)).toBeNull();
    s.db.close();
  });

  it("only refreshes on visible focus when stale", async () => {
    const s = await setup();
    s.scheduler.start();
    await settled(s.scheduler);
    s.storage.setItem(LAST_REFRESH_KEY, String(Date.now() - REFRESH_INTERVAL));
    Object.assign(s.document, { visibilityState: "hidden" });
    s.document.dispatchEvent(new Event("visibilitychange"));
    expect(s.changed).toHaveBeenCalledTimes(1);
    Object.assign(s.document, { visibilityState: "visible" });
    s.document.dispatchEvent(new Event("visibilitychange"));
    await settled(s.scheduler);
    expect(s.changed).toHaveBeenCalledTimes(2);
    s.scheduler.stop(); s.db.close();
  });


  it("calls the default browser timers without binding them to the scheduler (Illegal invocation)", async () => {
    const real = globalThis.setTimeout;
    const strict = function (this: unknown, callback: () => void, delay?: number) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return real(callback, delay);
    } as unknown as typeof setTimeout;
    vi.stubGlobal("setTimeout", strict);
    try {
      const db = await openLibraryDB(`refresh-${count++}`);
      const repo = new LibraryRepository(db);
      await repo.createTitle(show);
      const data = new Map<string, string>();
      const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
      const changed = vi.fn();
      // No `yield` or `setTimer` injected, so the scheduler uses the global setTimeout.
      const scheduler = new RefreshScheduler({
        repository: async () => repo, storage, document: Object.assign(new EventTarget(), { visibilityState: "visible" as const }), window: new EventTarget(),
        online: () => true, changed,
        fetcher: async <T>() => ({ id: 1, name: "Refreshed", status: "Returning Series", genres: [], seasons: [], results: {} }) as T,
      });
      await scheduler.refresh(true);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(scheduler.getSnapshot().message).toBe("Refreshed 1 titles.");
      scheduler.stop();
      db.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
