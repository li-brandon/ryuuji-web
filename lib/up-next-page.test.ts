import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as F from "../test/domain-fixtures";
import { LibraryRepository, openLibraryDB } from "./storage";
import type { Title } from "./types";
import { UndoStack } from "./undo-stack";
import { selectUpNext } from "./up-next";
import { focusAfterLog, logButtonLabel, logEntry, msUntilNextMidnight, shouldRestoreFocus, undoLog, watchToday } from "./up-next-page";
import { WatchLogService } from "./watch-log";

async function withLibrary(name: string, run: (repo: LibraryRepository, service: WatchLogService) => Promise<void>) {
  const db = await openLibraryDB(`up-next-page-${name}`);
  try {
    const repo = new LibraryRepository(db);
    await run(repo, new WatchLogService(repo, { today: () => F.today }));
  } finally { db.close(); }
}

const load = async (repo: LibraryRepository, titles: Title[]) =>
  Promise.all(titles.map(async (t) => ({ title: (await repo.getTitle(t)) ?? t, events: await repo.listWatchEvents(t) })));

describe("Up Next page: log and undo", () => {
  it("the toast's Undo reverts only its own log, leaving a newer log intact; Cmd-Z stays LIFO", async () => {
    await withLibrary("toast-undo", async (repo, service) => {
      const a = await repo.createTitle({ ...F.show(F.season(1, 3), "watching"), name: "A" });
      const b = await repo.createTitle({ ...F.show(F.season(1, 3), "watching"), name: "B" });
      const stack = new UndoStack();
      const [entryA, entryB] = [a, b].map((title) => selectUpNext([{ title, events: [] }], F.today).active[0]);
      const stepA = await logEntry(service, entryA, stack);
      const stepB = await logEntry(service, entryB, stack);
      expect(stepA?.name).toBe("Log Episode");
      expect(stepB).toBeDefined();

      expect(await undoLog(stack, stepA)).toBe(true);
      expect(await repo.listWatchEvents(a)).toEqual([]);
      expect(await repo.listWatchEvents(b)).toHaveLength(1);
      expect(stack.size).toBe(1);
      expect(stepB?.canUndo).toBe(true);
      expect(await undoLog(stack, stepA)).toBe(false);

      expect(await undoLog(stack)).toBe(true);
      expect(await repo.listWatchEvents(b)).toEqual([]);
      expect(stepB?.canUndo).toBe(false);
      expect(await undoLog(stack)).toBe(false);
    });
  });

  it("focuses the title's new + button, else the toast's Undo, else nothing", async () => {
    await withLibrary("focus", async (repo, service) => {
      const long = await repo.createTitle({ ...F.show(F.season(1, 3), "watching"), name: "Long" });
      const short = await repo.createTitle({ ...F.show(F.season(1, 1), "watching"), name: "Short" });
      const stack = new UndoStack();
      const before = selectUpNext(await load(repo, [long, short]), F.today).active;
      for (const entry of before) await logEntry(service, entry, stack);
      const after = selectUpNext(await load(repo, [long, short]), F.today).active;

      expect(focusAfterLog(after, long, true)).toEqual({ row: "Log S1E2 of Long" });
      expect(focusAfterLog(after, long, true)).toEqual({ row: logButtonLabel(after[0]) });
      expect(focusAfterLog(after, short, true)).toBe("toast");
      expect(focusAfterLog(after, short, false)).toBeNull();
      expect(focusAfterLog(after, { tmdbId: long.tmdbId, kind: "movie" }, false)).toBeNull();
    });
  });

  it("only restores focus that was lost to <body> or is still on the log button", () => {
    const body = {}, button = {}, other = {};
    expect(shouldRestoreFocus(body, button, body)).toBe(true);
    expect(shouldRestoreFocus(null, button, body)).toBe(true);
    expect(shouldRestoreFocus(button, button, body)).toBe(true);
    expect(shouldRestoreFocus(other, button, body)).toBe(false);
  });
});

describe("Up Next page: today rollover", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("reports the new day at local midnight and stops when cancelled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 23, 59, 30));
    expect(msUntilNextMidnight(new Date())).toBe(30_000);
    const days: string[] = [];
    const cancel = watchToday((day) => days.push(day));
    expect(days).toEqual(["2026-06-15"]);
    vi.advanceTimersByTime(29_999);
    expect(days).toEqual(["2026-06-15"]);
    vi.advanceTimersByTime(1);
    expect(days).toEqual(["2026-06-15", "2026-06-16"]);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(days).toEqual(["2026-06-15", "2026-06-16", "2026-06-17"]);
    cancel();
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(days).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an episode airing at midnight moves from caught up to Up Next once the day rolls over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 23, 0));
    const watching = F.show([F.episode(1, 1), F.episode(1, 2, "2026-06-16")], "watching");
    const caughtUp = F.show([F.episode(1, 1), F.episode(1, 2, "2026-06-16")], "caughtUp");
    const library = [watching, caughtUp].map((title) => ({ title, events: [{ ...F.event(F.episode(1, 1)), tmdbId: title.tmdbId, kind: title.kind, uid: crypto.randomUUID(), batchId: null, watchedAt: "2026-06-10T00:00:00Z" }] }));
    const views: ReturnType<typeof selectUpNext>[] = [];
    const cancel = watchToday((day) => views.push(selectUpNext(library, day)));
    expect(views[0].active).toEqual([]);
    expect(views[0].caughtUp.find((e) => e.title === caughtUp)?.airDate).toBe("2026-06-16");
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(views).toHaveLength(2);
    expect(views[1].active).toEqual([{ title: watching, next: F.episode(1, 2, "2026-06-16"), remaining: 1, rewatchNumber: null }]);
    expect(views[1].caughtUp.find((e) => e.title === caughtUp)?.airDate).toBeNull();
    cancel();
  });
});
