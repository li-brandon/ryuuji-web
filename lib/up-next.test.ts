import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as F from "../test/domain-fixtures";
import type { Title, WatchEvent } from "./types";
import { selectUpNext } from "./up-next";
import { LibraryRepository, openLibraryDB } from "./storage";
import { WatchLogService } from "./watch-log";
import { UndoStack } from "./undo-stack";

const eventsFor = (title: Title, episodes = F.season(1, 1), watchedAt = "2026-06-10T00:00:00Z"): WatchEvent[] =>
  episodes.map((episode) => ({ ...F.event(episode), tmdbId: title.tmdbId, kind: title.kind, uid: crypto.randomUUID(), batchId: null, watchedAt }));

describe("Up Next", () => {
  it("selects the first aired unwatched regular episode, excluding other statuses and movies", () => {
    const title = F.show([...F.season(0, 1), ...F.season(1, 3), F.episode(2, 1, F.future), F.episode(2, 2, null)], "watching");
    const result = selectUpNext([
      { title, events: eventsFor(title) },
      ...[F.movie(), F.show(F.season(1, 1), "onHold"), F.show(F.season(1, 1), "completed"), F.show([], "watching"), F.show(F.season(1, 1, F.future), "watching")].map((title) => ({ title, events: [] })),
    ], F.today);
    expect(result.active).toEqual([{ title, next: F.episode(1, 2), remaining: 2, rewatchNumber: null }]);
  });

  it("uses the current rewatch pass", () => {
    const title = F.show(F.season(1, 3), "rewatching");
    const result = selectUpNext([{ title, events: [...eventsFor(title, F.season(1, 3)), ...eventsFor(title)] }], F.today);
    expect(result.active[0]).toMatchObject({ next: F.episode(1, 2), remaining: 2, rewatchNumber: 1 });
  });

  it("orders by latest event, falling back to addedAt only when there are no events", () => {
    const a = F.show(F.season(1, 3), "watching");
    const b = { ...F.show(F.season(1, 3), "watching"), addedAt: "2026-06-11T00:00:00Z" };
    const c = F.show(F.season(1, 3), "watching");
    const result = selectUpNext([
      { title: a, events: eventsFor(a) }, { title: b, events: [] },
      { title: c, events: [...eventsFor(c, F.season(1, 1), "2026-06-12T00:00:00Z"), ...eventsFor(c, F.season(1, 1), "2026-01-01T00:00:00Z")] },
    ], F.today);
    expect(result.active.map((e) => e.title.tmdbId)).toEqual([c.tmdbId, b.tmdbId, a.tmdbId]);
  });

  it("includes caught-up shows with the earliest known upcoming regular air date", () => {
    const title = F.show([F.episode(0, 1, "2026-06-16"), F.episode(1, 2, F.future), F.episode(1, 3, "2026-06-17")], "caughtUp");
    const unknown = F.show([], "caughtUp");
    expect(selectUpNext([{ title, events: [] }, { title: unknown, events: [] }], F.today)).toEqual({ active: [], caughtUp: [{ title, airDate: "2026-06-17" }, { title: unknown, airDate: null }] });
  });

  it.each(["Returning Series", "Ended"] as const)("undo restores the last episode and Watching status for %s", async (showStatus) => {
    const db = await openLibraryDB(`up-next-${showStatus}`);
    try {
      const repo = new LibraryRepository(db);
      const title = await repo.createTitle(F.show(F.season(1, 1), "watching", showStatus));
      const undo = new UndoStack();
      const service = new WatchLogService(repo, { today: () => F.today });
      const initial = selectUpNext([{ title, events: [] }], F.today);
      await service.log(title, initial.active[0].next, undo);
      expect((await repo.getTitle(title))?.status).toBe(showStatus === "Ended" ? "completed" : "caughtUp");
      await undo.undo();
      const restored = await repo.getTitle(title);
      expect(restored).toEqual(title);
      expect(await repo.listWatchEvents(title)).toEqual([]);
      expect(selectUpNext([{ title: restored ?? title, events: await repo.listWatchEvents(title) }], F.today)).toEqual(initial);
    } finally { db.close(); }
  });
});

it("selects next in episode order and sorts both lists by the latest of unsorted events", () => {
  const episodes = [F.episode(2, 2), F.episode(1, 2), F.episode(2, 1), F.episode(1, 1)];
  const a = F.show(episodes, "watching");
  const b = F.show(episodes, "watching");
  const c = F.show([], "caughtUp");
  const d = F.show([], "caughtUp");
  const watches = (title: Title, recent: string) => [
    ...eventsFor(title, [F.episode(1, 1)], "2026-01-01T00:00:00Z"),
    ...eventsFor(title, [F.episode(1, 1)], recent),
    ...eventsFor(title, [F.episode(1, 1)], "2026-02-01T00:00:00Z"),
  ];
  const result = selectUpNext([
    { title: a, events: watches(a, "2026-06-10T00:00:00Z") },
    { title: b, events: watches(b, "2026-06-12T00:00:00Z") },
    { title: c, events: watches(c, "2026-06-10T00:00:00Z") },
    { title: d, events: watches(d, "2026-06-12T00:00:00Z") },
  ], F.today);
  expect(result.active.map((entry) => entry.title)).toEqual([b, a]);
  expect(result.active.map((entry) => entry.next)).toEqual([F.episode(1, 2), F.episode(1, 2)]);
  expect(result.caughtUp.map((entry) => entry.title)).toEqual([d, c]);
});
