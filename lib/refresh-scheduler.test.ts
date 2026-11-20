import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { show } from "../test/fixtures/refresh";
import { LibraryRepository, openLibraryDB } from "./storage";
import { LAST_REFRESH_KEY, LEASE_KEY, LEASE_TTL, RefreshScheduler, refreshMessage } from "./refresh-scheduler";
import { REFRESH_INTERVAL } from "./refresh";

type SchedulerOptions = ConstructorParameters<typeof RefreshScheduler>[0];
let count = 0;
afterEach(() => vi.useRealTimers());
async function setup(overrides: Partial<SchedulerOptions> = {}) {
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
  const fetcher = vi.fn(async () => ({ id: 1, name: "Refreshed", title: "Refreshed movie", status: "Returning Series", genres: [], seasons: [], results: {} }));
  const repository = vi.fn(async () => repo);
  const options: SchedulerOptions = { repository, storage, document, window, online: () => online, changed, fetcher: async <T>() => JSON.parse(JSON.stringify(await fetcher())) as T, yield: async () => {}, ...overrides };
  const scheduler = new RefreshScheduler(options);
  return { scheduler, options, repo, repository, db, storage, document, window, changed, fetcher, offline: () => { online = false; }, online: () => { online = true; } };
}
const lease = (token: string, at = Date.now()) => JSON.stringify({ token, at });
// refreshTitle fetches metadata and watch providers, so each refreshed title costs two fetcher calls.
/** A Web Lock stand-in that always grants, so only the scheduler's own guards prevent overlap. */
function grantingLocks(beforeGrant?: () => void) {
  const request = vi.fn(async (_name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    beforeGrant?.();
    return callback({ name: "ryuuji-refresh", mode: "exclusive" });
  });
  return { request: request as unknown as LockManager["request"], calls: request.mock.calls };
}
async function settled(scheduler: RefreshScheduler) {
  await vi.waitFor(() => expect(scheduler.getSnapshot().running).toBe(false));
}
describe("refresh scheduler", () => {
  it("runs on launch when never refreshed, skips fresh wakeups, refreshes at 24h, cleans up", async () => {
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
    s.storage.setItem(LEASE_KEY, lease("other"));
    await s.scheduler.refresh();
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.storage.getItem(LEASE_KEY)).toBe(lease("other"));
    s.storage.removeItem(LEASE_KEY);
    await Promise.all([s.scheduler.refresh(), s.scheduler.refresh()]);
    expect(s.changed).toHaveBeenCalledOnce();
    s.db.close();
  });
  it("requests the named Web Lock without waiting and skips when unavailable", async () => {
    // Assertions inside the callback would be swallowed by refresh()'s catch, so check the recorded args afterwards.
    const request = vi.fn(async <T>(_name: string, _options: LockOptions | LockGrantedCallback<T>, callback?: LockGrantedCallback<T>): Promise<T> => {
      if (!callback) throw new Error("Expected callback");
      return callback(null);
    });
    const s = await setup({ locks: { request } });
    await s.scheduler.refresh();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe("ryuuji-refresh");
    expect(request.mock.calls[0][1]).toStrictEqual({ ifAvailable: true });
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.scheduler.getSnapshot().message).toBe("Another tab is refreshing metadata.");
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
    // refresh() flips `running` synchronously, so a hidden wakeup must leave it untouched.
    expect(s.scheduler.getSnapshot().running).toBe(false);
    await settled(s.scheduler);
    expect(s.repository).toHaveBeenCalledTimes(1);
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
        fetcher: async <T>() => ({ id: 1, name: "Refreshed", title: "Refreshed movie", status: "Returning Series", genres: [], seasons: [], results: {} }) as T,
      });
      await scheduler.refresh(true);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(scheduler.getSnapshot().message).toBe("Refreshed 1 title.");
      scheduler.stop();
      db.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it("queues imported movies and fresh ended shows without changing cached data offline, then retries", async () => {
  const s = await setup();
  const movie = { ...show, tmdbId: 129, kind: "movie" as const, episodes: null };
  const ended = { ...show, showStatus: "Ended" as const, lastRefreshedAt: new Date().toISOString() };
  await s.repo.createTitle(movie);
  await s.repo.updateTitle(show, ended);
  s.storage.setItem(LAST_REFRESH_KEY, String(Date.now()));
  s.offline();
  s.scheduler.queueTitles([movie, ended]);
  expect(s.fetcher).not.toHaveBeenCalled();
  expect(await s.repo.getTitle(movie)).toEqual(movie);
  expect(await s.repo.getTitle(show)).toEqual(ended);
  expect(JSON.parse(s.storage.getItem("ryuuji-import-refresh") ?? "[]")).toHaveLength(2);
  s.online();
  await s.scheduler.refresh(false);
  expect((await s.repo.getTitle(movie))?.metadataRevision).toBe(movie.metadataRevision + 1);
  expect((await s.repo.getTitle(show))?.metadataRevision).toBe(ended.metadataRevision + 1);
  expect(s.storage.getItem("ryuuji-import-refresh")).toBe("[]");
  s.db.close();
});

describe("launch gating", () => {
  it("does not fetch on launch when the last run is fresh", async () => {
    const s = await setup();
    s.storage.setItem(LAST_REFRESH_KEY, String(Date.now() - REFRESH_INTERVAL + 60_000));
    s.scheduler.start();
    expect(s.scheduler.getSnapshot().running).toBe(false);
    await settled(s.scheduler);
    expect(s.repository).not.toHaveBeenCalled();
    expect(s.fetcher).not.toHaveBeenCalled();
    s.scheduler.stop(); s.db.close();
  });
  it("refreshes on launch when the last run is stale", async () => {
    const s = await setup();
    const launchedAt = Date.now();
    s.storage.setItem(LAST_REFRESH_KEY, String(launchedAt - REFRESH_INTERVAL));
    s.scheduler.start();
    await settled(s.scheduler);
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    expect(Number(s.storage.getItem(LAST_REFRESH_KEY))).toBeGreaterThanOrEqual(launchedAt);
    s.scheduler.stop(); s.db.close();
  });
  it("refreshes queued import titles on launch even when fresh", async () => {
    const s = await setup();
    s.storage.setItem(LAST_REFRESH_KEY, String(Date.now()));
    s.storage.setItem("ryuuji-import-refresh", JSON.stringify([{ tmdbId: show.tmdbId, kind: show.kind }]));
    s.scheduler.start();
    await settled(s.scheduler);
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    expect(s.storage.getItem("ryuuji-import-refresh")).toBe("[]");
    s.scheduler.stop(); s.db.close();
  });
  it("clears the pending timer on stop", async () => {
    const locks = grantingLocks();
    const ids: ReturnType<typeof setTimeout>[] = [];
    const setTimer = vi.fn((callback: () => void, delay: number) => { const id = setTimeout(callback, delay); ids.push(id); return id; });
    const clearTimer = vi.fn((id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    const s = await setup({ locks, setTimer, clearTimer });
    s.scheduler.start();
    await settled(s.scheduler);
    await vi.waitFor(() => expect(setTimer).toHaveBeenCalledOnce());
    expect(setTimer.mock.calls[0][1]).toBe(REFRESH_INTERVAL);
    s.scheduler.stop();
    expect(clearTimer).toHaveBeenCalledExactlyOnceWith(ids[0]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * REFRESH_INTERVAL);
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    s.db.close();
  });
});

describe("lifecycle", () => {
  it("does not re-arm the timer when stopped during an in-flight launch refresh", async () => {
    const s = await setup({ locks: grantingLocks() });
    s.scheduler.start();
    expect(s.scheduler.getSnapshot().running).toBe(true);
    s.scheduler.stop();
    await settled(s.scheduler);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    s.db.close();
  });
  it("starts once, retries a failed cycle hourly and does not force on reconnect", async () => {
    const setTimer = vi.fn((callback: () => void, delay: number) => setTimeout(callback, delay));
    const s = await setup({ locks: grantingLocks(), setTimer });
    const listener = vi.fn();
    s.scheduler.subscribe(listener);
    s.fetcher.mockRejectedValueOnce(new Error("offline"));
    s.scheduler.start();
    s.scheduler.start();
    await settled(s.scheduler);
    await vi.waitFor(() => expect(setTimer).toHaveBeenCalledOnce());
    expect(setTimer.mock.calls[0][1]).toBe(60 * 60 * 1000);
    expect(s.repository).toHaveBeenCalledOnce();
    // Another tab finishing a cycle shows up through the storage event.
    s.storage.setItem(LAST_REFRESH_KEY, String(Date.now()));
    listener.mockClear();
    s.window.dispatchEvent(new Event("storage"));
    expect(listener).toHaveBeenCalledOnce();
    expect(s.scheduler.getSnapshot().lastRun).toBe(Date.now());
    s.window.dispatchEvent(new Event("online"));
    expect(s.scheduler.getSnapshot().running).toBe(false);
    s.scheduler.stop();
    s.document.dispatchEvent(new Event("visibilitychange"));
    s.storage.removeItem(LAST_REFRESH_KEY);
    s.window.dispatchEvent(new Event("online"));
    expect(s.scheduler.getSnapshot().running).toBe(false);
    s.db.close();
  });
  it("publishes an offline message without touching the repository", async () => {
    const s = await setup();
    s.offline();
    await s.scheduler.refresh();
    expect(s.scheduler.getSnapshot().message).toBe("Offline. Refresh will retry when you’re online.");
    expect(s.repository).not.toHaveBeenCalled();
    s.db.close();
  });
});

describe("refresh gating", () => {
  it("skips a non-forced refresh with a fresh last run before taking the lock", async () => {
    const locks = grantingLocks();
    const s = await setup({ locks });
    s.storage.setItem(LAST_REFRESH_KEY, String(Date.now()));
    const listener = vi.fn();
    s.scheduler.subscribe(listener);
    await s.scheduler.refresh(false);
    expect(locks.calls).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    expect(s.repository).not.toHaveBeenCalled();
    s.db.close();
  });
  it("rechecks staleness after taking the lock when another tab just finished", async () => {
    const locks = grantingLocks(() => storage.setItem(LAST_REFRESH_KEY, String(Date.now())));
    const s = await setup({ locks });
    const storage = s.storage;
    s.storage.setItem(LAST_REFRESH_KEY, String(Date.now() - REFRESH_INTERVAL));
    await s.scheduler.refresh(false);
    expect(locks.calls).toHaveLength(1);
    expect(s.repository).not.toHaveBeenCalled();
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.scheduler.getSnapshot()).toMatchObject({ running: false, message: "" });
    s.db.close();
  });
  it("clears a fresh last-run time when a title fails so the next wakeup retries", async () => {
    const s = await setup();
    const hourAgo = Date.now() - 60 * 60 * 1000;
    s.storage.setItem(LAST_REFRESH_KEY, String(hourAgo));
    s.fetcher.mockRejectedValueOnce(new Error("offline"));
    await s.scheduler.refresh();
    expect(s.storage.getItem(LAST_REFRESH_KEY)).toBeNull();
    expect(s.scheduler.getSnapshot()).toMatchObject({ lastRun: null, message: "Some titles couldn’t refresh; we’ll retry." });
    await s.scheduler.refresh(false);
    expect(s.fetcher).toHaveBeenCalledTimes(4);
    expect((await s.repo.getTitle(show))?.name).toBe("Refreshed");
    s.db.close();
  });
  it("runs one cycle for concurrent refresh() calls even when the lock does not exclude them", async () => {
    const locks = grantingLocks();
    const s = await setup({ locks });
    await Promise.all([s.scheduler.refresh(), s.scheduler.refresh()]);
    expect(locks.calls).toHaveLength(1);
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    s.db.close();
  });
});

describe("status message", () => {
  it("pluralises and hides a zero count", () => {
    expect(refreshMessage(1, 0)).toBe("Refreshed 1 title.");
    expect(refreshMessage(3, 0)).toBe("Refreshed 3 titles.");
    expect(refreshMessage(0, 0)).toBe("");
    expect(refreshMessage(0, 2)).toBe("Some titles couldn’t refresh; we’ll retry.");
    expect(refreshMessage(1, 1)).toBe("Refreshed 1 title. Some titles couldn’t refresh; we’ll retry.");
    expect(refreshMessage(2, 1)).toBe("Refreshed 2 titles. Some titles couldn’t refresh; we’ll retry.");
  });
  it("publishes the count from a real cycle", async () => {
    const s = await setup();
    await s.repo.createTitle({ ...show, tmdbId: 2 });
    await s.scheduler.refresh();
    expect(s.scheduler.getSnapshot().message).toBe("Refreshed 2 titles.");
    const finished = { showStatus: "Ended" as const, lastRefreshedAt: new Date().toISOString() };
    await s.repo.updateTitle(show, finished);
    await s.repo.updateTitle({ ...show, tmdbId: 2 }, finished);
    s.changed.mockClear();
    await s.scheduler.refresh();
    expect(s.scheduler.getSnapshot().message).toBe("");
    expect(s.changed).not.toHaveBeenCalled();
    s.db.close();
  });
});

describe("fallback lease", () => {
  it("lasts minutes, not a day", () => {
    expect(LEASE_TTL).toBeGreaterThanOrEqual(2 * 60 * 1000);
    expect(LEASE_TTL).toBeLessThanOrEqual(5 * 60 * 1000);
  });
  it("respects a live lease and takes over an expired, future-dated or garbage one", async () => {
    const s = await setup();
    s.storage.setItem(LEASE_KEY, lease("other", Date.now() - LEASE_TTL + 1));
    await s.scheduler.refresh();
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.scheduler.getSnapshot().message).toBe("Another tab is refreshing metadata.");
    for (const stale of [lease("other", Date.now() - LEASE_TTL), lease("other", Date.now() + LEASE_TTL), "garbage", "{\"token\":\"\",\"at\":1}", `${Date.now()}:legacy`]) {
      s.fetcher.mockClear();
      s.storage.setItem(LEASE_KEY, stale);
      await s.scheduler.refresh();
      expect(s.fetcher).toHaveBeenCalledTimes(2);
      expect(s.storage.getItem(LEASE_KEY)).toBeNull();
    }
    s.db.close();
  });
  it("backs off when another tab overwrites the lease during the claim yield", async () => {
    const tab: { storage?: Pick<Storage, "setItem"> } = {};
    const s = await setup({ yield: vi.fn(async () => { tab.storage?.setItem(LEASE_KEY, lease("other")); }) });
    tab.storage = s.storage;
    await s.scheduler.refresh();
    expect(s.repository).not.toHaveBeenCalled();
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.storage.getItem(LEASE_KEY)).toBe(lease("other"));
    expect(s.scheduler.getSnapshot().message).toBe("Another tab is refreshing metadata.");
    s.db.close();
  });
  it("lets only the last of two simultaneous claimants run", async () => {
    const s = await setup();
    let staleView = true;
    // Tab B read the lease before tab A's write landed (cross-process race).
    const viewB = { ...s.storage, getItem: (key: string) => key === LEASE_KEY && staleView ? (staleView = false, null) : s.storage.getItem(key) };
    const tabB = new RefreshScheduler({ ...s.options, storage: viewB });
    const tabA = new RefreshScheduler({ ...s.options, yield: async () => { await tabB.refresh(); } });
    await tabA.refresh();
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    expect(tabB.getSnapshot().message).toBe("Refreshed 1 title.");
    expect(tabA.getSnapshot().message).toBe("Another tab is refreshing metadata.");
    expect(s.storage.getItem(LEASE_KEY)).toBeNull();
    s.db.close();
  });
  it("renews the lease while running and releases it afterwards", async () => {
    const s = await setup();
    let release!: () => void;
    s.fetcher.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ id: 1, name: "Refreshed", title: "", status: "Returning Series", genres: [], seasons: [], results: {} }); }));
    const run = s.scheduler.refresh();
    await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalled());
    const claimed = JSON.parse(s.storage.getItem(LEASE_KEY)!) as { token: string; at: number };
    for (let beat = 1; beat <= 4; beat++) {
      await vi.advanceTimersByTimeAsync(LEASE_TTL / 3);
      // Without renewal the lease would have expired by the fourth beat and another tab could take over.
      expect(JSON.parse(s.storage.getItem(LEASE_KEY)!)).toEqual({ token: claimed.token, at: claimed.at + beat * LEASE_TTL / 3 });
    }
    release();
    await run;
    expect(s.storage.getItem(LEASE_KEY)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    s.db.close();
  });
  it("stops renewing and aborts the remaining titles once another tab takes over", async () => {
    const s = await setup();
    await s.repo.createTitle({ ...show, tmdbId: 2 });
    s.fetcher.mockImplementationOnce(async () => {
      s.storage.setItem(LEASE_KEY, lease("other"));
      return { id: 1, name: "Refreshed", title: "", status: "Returning Series", genres: [], seasons: [], results: {} };
    });
    await s.scheduler.refresh();
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    expect(s.changed).toHaveBeenCalledOnce();
    expect(s.storage.getItem(LEASE_KEY)).toBe(lease("other"));
    expect(s.storage.getItem(LAST_REFRESH_KEY)).toBeNull();
    expect(s.scheduler.getSnapshot().message).toBe("Another tab is refreshing metadata.");
    expect(vi.getTimerCount()).toBe(0);
    s.db.close();
  });
});
