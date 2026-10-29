import { isAired, today as localToday } from "./air-date";
import {
  byEpisodeOrder,
  episodeMatcher,
  hasAiredRegular,
  isSpecial,
  isWatched,
  rewatchProgress,
  titleEpisodes,
  titleProgress,
  type Episode,
} from "./progress";
import { statusAfter, type StatusTrigger } from "./status-engine";
import { TitleNotFoundError, type LibraryRepository } from "./storage";
import { LIST_STATUSES, type Kind, type ListStatus, type Title, type TitleKey, type WatchEvent } from "./types";
import type { UndoStack } from "./undo-stack";

// Ports the macOS app's Services/WatchLogService.swift.

/** Statuses a user can pick by hand for `kind`. Rewatching is entered with Start Rewatch (as in
 * Swift's `ListStatus.manualCases`); Caught Up means waiting on new episodes, so it's shows only. */
export function allowedStatuses(kind: Kind): ListStatus[] {
  return LIST_STATUSES.filter((s) => s !== "rewatching" && (kind === "show" || s !== "caughtUp"));
}

export class InvalidStatusError extends Error {
  constructor(readonly kind: Kind, readonly status: ListStatus) {
    super(`Status ${status} can't be set by hand on a ${kind}`);
    this.name = "InvalidStatusError";
  }
}

/** Which episodes a bulk mark covers: one season's aired, unwatched episodes (season 0 only if
 * chosen explicitly), or every aired, unwatched regular episode. */
export type BulkScope = { season: number } | "all";

type Change = { added: WatchEvent[]; removed: WatchEvent[]; status?: ListStatus };

type UndoRecord = { key: TitleKey; previousStatus: ListStatus; addedEventIds: string[]; removedEvents: WatchEvent[] };

export type WatchLogOptions = {
  /** Today as "yyyy-MM-dd", for deciding what has aired. */
  today?: () => string;
  now?: () => Date;
  newId?: () => string;
};

/**
 * Owns every write that touches watch events or list status. Each public operation updates
 * status, saves in one transaction, and registers exactly one undo step on `undo` when given.
 * Operations run one at a time so each sees the previous one's writes.
 */
export class WatchLogService {
  private readonly today: () => string;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repo: LibraryRepository,
    options: WatchLogOptions = {},
  ) {
    this.today = options.today ?? (() => localToday());
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Logs one watch of `episode` (or of the movie when null). Logging a watched episode records a rewatch. */
  log(key: TitleKey, episode: Episode | null, undo?: UndoStack): Promise<void> {
    return this.run(async () => {
      const name = episode ? "Log Episode" : "Log Movie";
      await this.perform(name, key, "log", undo, (title) => ({
        added: [this.makeEvent(title, episode, this.now(), null)],
        removed: [],
      }));
    });
  }

  /** Logs every aired, unwatched episode in `scope` with one shared timestamp and batch id. */
  bulkMark(key: TitleKey, scope: BulkScope, undo?: UndoStack): Promise<void> {
    return this.run(async () => {
      const { title, events } = await this.load(key);
      const targets = this.unwatchedAired(scope, title, events);
      if (targets.length === 0) return;
      const name = scope === "all" ? "Mark All Watched" : "Mark Season Watched";
      await this.perform(name, key, "log", undo, (title) => {
        const batchId = this.newId();
        const timestamp = this.now();
        return { added: targets.map((e) => this.makeEvent(title, e, timestamp, batchId)), removed: [] };
      });
    });
  }

  /** Changes the list status by hand. Choosing Completed also fills in missing watches (see
   * `complete`); either way it's one undo step that restores the previous status. Throws
   * `InvalidStatusError` for a status `allowedStatuses` doesn't offer for the title's kind. */
  setStatus(key: TitleKey, status: ListStatus, undo?: UndoStack): Promise<void> {
    return this.run(async () => {
      const { title } = await this.load(key);
      if (!allowedStatuses(title.kind).includes(status)) throw new InvalidStatusError(title.kind, status);
      if (status === title.status) return;
      if (status === "completed") return this.completeNow(key, undo);
      await this.perform("Change Status", key, null, undo, () => ({ added: [], removed: [], status }));
    });
  }

  /**
   * Sets the title to Completed and logs what it's missing: every aired, unwatched regular
   * episode as one batch, or one watch of a movie that has none (LIB-299). Status is then
   * recomputed like any log, so a Returning show ends up Caught Up; a show with nothing aired
   * keeps Completed.
   */
  complete(key: TitleKey, undo?: UndoStack): Promise<void> {
    return this.run(() => this.completeNow(key, undo));
  }

  /** Whether the title can start a rewatch: a Completed or Caught Up show with every aired regular episode watched. */
  canStartRewatch(key: TitleKey): Promise<boolean> {
    return this.run(async () => this.canRewatch(await this.load(key)));
  }

  /** Starts the next rewatch pass (LIB-293); the pass's last log restores Completed or Caught Up. */
  startRewatch(key: TitleKey, undo?: UndoStack): Promise<void> {
    return this.run(async () => {
      if (!this.canRewatch(await this.load(key))) return;
      await this.perform("Start Rewatch", key, null, undo, () => ({ added: [], removed: [], status: "rewatching" }));
    });
  }

  /** Ends a rewatch before the pass finishes, restoring the status progress implies. */
  stopRewatch(key: TitleKey, undo?: UndoStack): Promise<void> {
    return this.run(async () => {
      const { title } = await this.load(key);
      if (title.status !== "rewatching") return;
      await this.perform("Stop Rewatch", key, "endRewatch", undo, () => ({ added: [], removed: [] }));
    });
  }

  /** Removes every event for `episode` (or every movie event when null). */
  unmark(key: TitleKey, episode: Episode | null, undo?: UndoStack): Promise<void> {
    return this.run(async () => {
      const { title, events } = await this.load(key);
      const match = episodeMatcher(titleEpisodes(title));
      const doomed = episode ? events.filter((e) => match(e)?.tmdbId === episode.tmdbId) : events;
      if (doomed.length === 0) return;
      await this.perform("Unmark", key, "unmark", undo, () => ({ added: [], removed: doomed }));
    });
  }

  /** Deletes a single event, e.g. from History. */
  deleteEvent(uid: string, undo?: UndoStack): Promise<void> {
    return this.run(async () => {
      const event = await this.repo.getWatchEvent(uid);
      if (!event) return;
      await this.perform("Delete Watch", event, "unmark", undo, () => ({ added: [], removed: [event] }));
    });
  }

  // Core

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private async load(key: TitleKey): Promise<{ title: Title; events: WatchEvent[] }> {
    const [title, events] = await Promise.all([this.repo.getTitle(key), this.repo.listWatchEvents(key)]);
    if (!title) throw new TitleNotFoundError(key);
    return { title, events };
  }

  private canRewatch({ title, events }: { title: Title; events: WatchEvent[] }): boolean {
    if (title.kind !== "show" || (title.status !== "completed" && title.status !== "caughtUp")) return false;
    const progress = titleProgress(title, events, this.today());
    return hasAiredRegular(progress) && progress.remaining === 0;
  }

  private async completeNow(key: TitleKey, undo?: UndoStack): Promise<void> {
    const { title, events } = await this.load(key);
    const progress = titleProgress(title, events, this.today());
    const targets: (Episode | null)[] =
      title.kind === "movie" ? (progress.eventCount === 0 ? [null] : []) : this.unwatchedAired("all", title, events);
    const trigger = title.kind === "show" && !hasAiredRegular(progress) ? null : "log";

    await this.perform("Mark Completed", key, trigger, undo, (title) => {
      const batchId = title.kind === "show" ? this.newId() : null;
      const timestamp = this.now();
      return { added: targets.map((e) => this.makeEvent(title, e, timestamp, batchId)), removed: [], status: "completed" };
    });
  }

  private async perform(
    actionName: string,
    key: TitleKey,
    trigger: StatusTrigger | null,
    undo: UndoStack | undefined,
    mutate: (title: Title, events: WatchEvent[]) => Change,
  ): Promise<void> {
    const { title, events } = await this.load(key);
    const today = this.today();
    const previousStatus = title.status;
    const rewatchBefore =
      title.status === "rewatching" ? rewatchProgress(titleProgress(title, events, today))?.number : undefined;

    const { added, removed, status = title.status } = mutate(title, events);
    let newStatus = status;
    if (trigger) {
      const removedIds = new Set(removed.map((e) => e.uid));
      const after = [...events.filter((e) => !removedIds.has(e.uid)), ...added];
      const progress = titleProgress(title, after, today);
      // A log that moves the rewatch pass past its number before the change has finished the rewatch.
      const finishedRewatch =
        trigger === "log" && rewatchBefore !== undefined && (rewatchProgress(progress)?.number ?? Infinity) > rewatchBefore;
      newStatus = statusAfter(finishedRewatch ? "endRewatch" : trigger, {
        current: status,
        kind: title.kind,
        progress,
        showStatus: title.showStatus,
      });
    }
    await this.repo.commitWatchLog(key, { add: added, remove: removed.map((e) => e.uid), status: newStatus });

    const record: UndoRecord = {
      key: { tmdbId: title.tmdbId, kind: title.kind },
      previousStatus,
      addedEventIds: added.map((e) => e.uid),
      removedEvents: removed,
    };
    undo?.register(actionName, () => this.run(() => this.revert(record)));
  }

  private async revert(record: UndoRecord): Promise<void> {
    try {
      await this.repo.commitWatchLog(record.key, {
        add: record.removedEvents,
        remove: record.addedEventIds,
        status: record.previousStatus,
      });
    } catch (error) {
      // The title was removed since; its events went with it, so there's nothing to restore.
      if (!(error instanceof TitleNotFoundError)) throw error;
    }
  }

  /** Aired episodes in `scope` with no events, in season/episode order. */
  private unwatchedAired(scope: BulkScope, title: Title, events: WatchEvent[]): Episode[] {
    const today = this.today();
    const progress = titleProgress(title, events, today);
    return titleEpisodes(title)
      .filter((e) => (scope === "all" ? !isSpecial(e) : e.season === scope.season))
      .filter((e) => isAired(e.airDate, today) && !isWatched(progress, e))
      .sort(byEpisodeOrder);
  }

  private makeEvent(title: Title, episode: Episode | null, at: Date, batchId: string | null): WatchEvent {
    return {
      uid: this.newId(),
      tmdbId: title.tmdbId,
      kind: title.kind,
      watchedAt: at.toISOString(),
      season: episode?.season ?? null,
      episode: episode?.number ?? null,
      tmdbEpisodeId: episode?.tmdbId ?? null,
      batchId,
    };
  }
}
