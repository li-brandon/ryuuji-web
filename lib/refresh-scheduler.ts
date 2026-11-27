import { refreshTitle, type Fetcher } from "./quick-add";
import { dueTitles, REFRESH_INTERVAL } from "./refresh";
import type { TitleKey } from "./types";
import { z } from "zod";
import { kindSchema } from "./types";
import type { LibraryRepository } from "./storage";

export const LAST_REFRESH_KEY = "lastMetadataRefresh";
export const LEASE_KEY = "ryuuji-refresh-lease";
/** Fallback lease lifetime; the holder renews it well before expiry so a closed tab frees it within minutes. */
export const LEASE_TTL = 3 * 60 * 1000;
const leaseSchema = z.object({ token: z.string().min(1), at: z.number().finite() });
type Lease = z.infer<typeof leaseSchema>;

export function refreshMessage(refreshed: number, failed: number) {
  const summary = refreshed ? `Refreshed ${refreshed} title${refreshed === 1 ? "" : "s"}.` : "";
  return failed ? [summary, "Some titles couldn’t refresh; we’ll retry."].filter(Boolean).join(" ") : summary;
}
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
    // Launch is stale-gated like wakeups; "Refresh now" and imports still force a cycle.
    void this.refresh(false).finally(() => this.schedule());
  }
  stop() {
    this.stopped = true;
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
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

  queueTitles(titles: TitleKey[]) {
    if (!titles.length) return;
    const queued = this.queuedTitles();
    for (const title of titles) queued.set(`${title.kind}:${title.tmdbId}`, title);
    this.saveQueue(queued);
    void this.refresh(true);
  }
  private queuedTitles(): Map<string, TitleKey> {
    try {
      const titles = z.array(z.object({ tmdbId: z.int(), kind: kindSchema })).parse(JSON.parse(this.options.storage.getItem("ryuuji-import-refresh") ?? "[]"));
      return new Map(titles.map((title) => [`${title.kind}:${title.tmdbId}`, title]));
    } catch { return new Map(); }
  }
  private saveQueue(queue: Map<string, TitleKey>) {
    try { this.options.storage.setItem("ryuuji-import-refresh", JSON.stringify([...queue.values()])); } catch { /* Best effort when storage is unavailable. */ }
  }
  private pause() {
    return this.options.yield?.() ?? new Promise<void>((resolve) => this.setTimer(resolve, 0));
  }
  private readLease(): Lease | null {
    try {
      const parsed = leaseSchema.safeParse(JSON.parse(this.options.storage.getItem(LEASE_KEY) ?? "null"));
      return parsed.success ? parsed.data : null;
    } catch { return null; }
  }
  private writeLease(token: string) {
    this.options.storage.setItem(LEASE_KEY, JSON.stringify({ token, at: this.now() } satisfies Lease));
  }
  /** Best-effort lease for browsers without Web Locks; Web Locks provides atomic exclusion. */
  private async withLease(run: (owns: () => boolean) => Promise<void>) {
    const current = this.readLease();
    // Garbage, expired or future-dated (clock change) leases can be taken over.
    if (current && Math.abs(this.now() - current.at) < LEASE_TTL) { this.publish("Another tab is refreshing metadata."); return; }
    const token = globalThis.crypto?.randomUUID?.() ?? `${this.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const owner = () => this.readLease()?.token === token;
    let lost = false;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    // Renews only while this tab still holds the lease; once another tab overwrites it, stay out.
    const owns = () => {
      if (lost || !owner()) lost = true;
      else try { this.writeLease(token); } catch { /* Storage may be unavailable; the lease simply ages. */ }
      return !lost;
    };
    const beat = () => { heartbeat = this.setTimer(() => { if (owns()) beat(); }, LEASE_TTL / 3); };
    this.writeLease(token);
    try {
      // Two tabs may claim at once; only the last writer still reads its own token.
      await this.pause();
      if (!owner()) { this.publish("Another tab is refreshing metadata."); return; }
      beat();
      await run(owns);
    } finally {
      if (heartbeat !== undefined) this.clearTimer(heartbeat);
      if (owner()) this.options.storage.removeItem(LEASE_KEY);
    }
  }

  async refresh(force = true): Promise<void> {
    if (this.running) return;
    if (!this.options.online()) { this.publish("Offline. Refresh will retry when you’re online."); return; }
    const stale = () => {
      const last = this.readLastRun();
      return last === null || this.now() - last >= REFRESH_INTERVAL;
    };
    if (!force && !stale() && !this.queuedTitles().size) return;
    this.running = true;
    this.publish("Refreshing metadata…");
    try {
      const run = async (owns: () => boolean = () => true) => {
        // Recheck after acquiring the cross-tab lock: another tab may have just finished.
        if (!force && !stale() && !this.queuedTitles().size) { this.publish(""); return; }
        const repo = await this.options.repository();
        let refreshed = 0;
        let failed = 0;
        const all = await repo.listTitles();
        const queued = this.queuedTitles();
        const due = new Map(dueTitles(all, new Date(this.now())).map((title) => [`${title.kind}:${title.tmdbId}`, title]));
        for (const title of all) if (queued.has(`${title.kind}:${title.tmdbId}`)) due.set(`${title.kind}:${title.tmdbId}`, title);
        for (const title of due.values()) {
          if (!owns()) break;
          if (!this.options.online()) { failed++; break; }
          try {
            await refreshTitle(repo, title, { fetcher: this.options.fetcher, now: new Date(this.now()) });
            refreshed++;
            const pending = this.queuedTitles();
            pending.delete(`${title.kind}:${title.tmdbId}`);
            this.saveQueue(pending);
          } catch { failed++; }
          await this.pause();
        }
        if (refreshed) this.options.changed();
        // Another tab took over the lease; it owns the rest of the cycle and the last-run time.
        if (!owns()) { this.publish("Another tab is refreshing metadata."); return; }
        // A failed cycle stays stale so reconnect/focus can retry it.
        if (failed > 0) {
          try { this.options.storage.removeItem(LAST_REFRESH_KEY); } catch { /* Storage may be unavailable. */ }
        }
        if (failed === 0) {
          try { this.options.storage.setItem(LAST_REFRESH_KEY, String(this.now())); } catch { /* Storage may be unavailable. */ }
        }
        this.publish(refreshMessage(refreshed, failed));
      };
      if (this.options.locks) {
        await this.options.locks.request("ryuuji-refresh", { ifAvailable: true }, async (lock) => {
          if (lock) await run();
          else this.publish("Another tab is refreshing metadata.");
        });
      } else await this.withLease(run);
    } catch { this.publish("Couldn’t refresh metadata. We’ll retry."); }
    finally { this.running = false; this.publish(this.state.message); }
  }
}
