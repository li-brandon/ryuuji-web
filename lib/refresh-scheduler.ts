import { refreshTitle, type Fetcher } from "./quick-add";
import { dueTitles, REFRESH_INTERVAL } from "./refresh";
import type { LibraryRepository } from "./storage";

export const LAST_REFRESH_KEY = "lastMetadataRefresh";
export type RefreshState = { running: boolean; lastRun: number | null; message: string };
type Options = {
  repository: () => Promise<LibraryRepository>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  online: () => boolean;
  locks?: Pick<LockManager, "request">;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  yield?: () => Promise<void>;
  fetcher?: Fetcher;
  changed: () => void;
};

export class RefreshScheduler {
  private readonly now;
  private readonly setTimer;
  private readonly clearTimer;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private running = false;
  private listeners = new Set<() => void>();
  private state: RefreshState = { running: false, lastRun: null, message: "" };

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    // Wrapped so browser timers aren't called with the scheduler as `this` (Illegal invocation).
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));
    this.state.lastRun = this.readLastRun();
  }
  private readLastRun() {
    try {
      const raw = this.options.storage.getItem(LAST_REFRESH_KEY);
      const value = raw === null ? NaN : Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch { return null; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(message: string) {
    this.state = { running: this.running, lastRun: this.readLastRun(), message };
    this.listeners.forEach((listener) => listener());
  }
  private wake = () => {
    if (this.options.document.visibilityState === "visible") void this.refresh(false);
  };
  private reconnect = () => { void this.refresh(false); };
  private storageChanged = () => this.publish(this.state.message);
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.options.document.addEventListener("visibilitychange", this.wake);
    this.options.window.addEventListener("online", this.reconnect);
    this.options.window.addEventListener("storage", this.storageChanged);
    void this.refresh(true).finally(() => this.schedule());
  }
  stop() {
    this.stopped = true;
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.options.document.removeEventListener("visibilitychange", this.wake);
    this.options.window.removeEventListener("online", this.reconnect);
    this.options.window.removeEventListener("storage", this.storageChanged);
  }
  private schedule() {
    if (this.stopped) return;
    const last = this.readLastRun();
    const remaining = last === null ? 0 : last + REFRESH_INTERVAL - this.now();
    // Successful cycles run daily; failed/offline cycles are retried hourly too.
    const delay = remaining > 0 ? remaining : 60 * 60 * 1000;
    this.timer = this.setTimer(() => {
      if (this.stopped) return;
      void this.refresh(false).finally(() => this.schedule());
    }, delay);
  }

  async refresh(force = true): Promise<void> {
    if (this.running) return;
    if (!this.options.online()) { this.publish("Offline. Refresh will retry when you’re online."); return; }
    const stale = () => {
      const last = this.readLastRun();
      return last === null || this.now() - last >= REFRESH_INTERVAL;
    };
    if (!force && !stale()) return;
    this.running = true;
    this.publish("Refreshing metadata…");
    try {
      const run = async () => {
        // Recheck after acquiring the cross-tab lock.
        if (!force && !stale()) return;
        const repo = await this.options.repository();
        let refreshed = 0;
        let failed = 0;
        for (const title of dueTitles(await repo.listTitles(), new Date(this.now()))) {
          if (!this.options.online()) { failed++; break; }
          try {
            await refreshTitle(repo, title, { fetcher: this.options.fetcher, now: new Date(this.now()) });
            refreshed++;
          } catch { failed++; }
          await (this.options.yield?.() ?? new Promise<void>((resolve) => this.setTimer(resolve, 0)));
        }
        // A failed cycle stays stale so reconnect/focus can retry it.
        if (failed > 0) {
          try { this.options.storage.removeItem(LAST_REFRESH_KEY); } catch { /* Storage may be unavailable. */ }
        }
        if (failed === 0) {
          try { this.options.storage.setItem(LAST_REFRESH_KEY, String(this.now())); } catch { /* Storage may be unavailable. */ }
        }
        if (refreshed) this.options.changed();
        this.publish(failed ? `Refreshed ${refreshed} titles. Some titles couldn’t refresh; we’ll retry.` : `Refreshed ${refreshed} titles.`);
      };
      if (this.options.locks) {
        await this.options.locks.request("ryuuji-refresh", { ifAvailable: true }, async (lock) => {
          if (lock) await run();
          else this.publish("Another tab is refreshing metadata.");
        });
      } else {
        // Best-effort lease for older browsers; Web Locks provides atomic exclusion.
        const key = "ryuuji-refresh-lease";
        const token = `${this.now()}:${Math.random()}`;
        const existing = this.options.storage.getItem(key);
        if (!existing || this.now() - Number(existing.split(":")[0]) >= REFRESH_INTERVAL) {
          this.options.storage.setItem(key, token);
          try {
            await (this.options.yield?.() ?? new Promise<void>((resolve) => this.setTimer(resolve, 0)));
            if (this.options.storage.getItem(key) === token) await run();
          }
          finally { if (this.options.storage.getItem(key) === token) this.options.storage.removeItem(key); }
        } else this.publish("Another tab is refreshing metadata.");
      }
    } catch { this.publish("Couldn’t refresh metadata. We’ll retry."); }
    finally { this.running = false; this.publish(this.state.message); }
  }
}
