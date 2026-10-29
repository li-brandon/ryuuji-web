import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as F from "../test/domain-fixtures";
import { isWatched, rewatchCount, rewatchProgress, titleProgress, type Episode } from "./progress";
import { LibraryRepository, openLibraryDB } from "./storage";
import type { ShowStatus, ListStatus, Title, TitleKey } from "./types";
import { UndoStack } from "./undo-stack";
import { allowedStatuses, canStartRewatch, InvalidStatusError, WatchLogService } from "./watch-log";

// Ports RyuujiTests/Services/WatchLogServiceTests.swift (specs/watch-log), against fake-indexeddb.

const clock = new Date(1_780_000_000 * 1000);
let dbCount = 0;
let repo: LibraryRepository;
let service: WatchLogService;

beforeEach(async () => {
  repo = new LibraryRepository(await openLibraryDB(`watch-log-${++dbCount}`));
  service = new WatchLogService(repo, { today: () => F.today, now: () => clock });
});

async function makeShow(episodes: Episode[], status: ListStatus = "planToWatch", showStatus: ShowStatus = "Returning Series") {
  return repo.createTitle(F.show(episodes, status, showStatus));
}

const makeMovie = () => repo.createTitle(F.movie());
const events = (key: TitleKey) => repo.listWatchEvents(key);
const status = async (key: TitleKey) => (await repo.getTitle(key))?.status;

async function progress(key: TitleKey) {
  const title = (await repo.getTitle(key)) as Title;
  return titleProgress(title, await events(key), F.today);
}

/** Total events across every title. */
async function eventCount() {
  const titles = await repo.listTitles();
  const counts = await Promise.all(titles.map(async (t) => (await events(t)).length));
  return counts.reduce((a, b) => a + b, 0);
}

describe("watch events are the source of truth", () => {
  it("derives progress from events", async () => {
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes);
    await service.log(show, episodes[0]);
    await service.log(show, episodes[1]);
    await service.log(show, episodes[1]);
    expect((await progress(show)).watchedAiredRegularCount).toBe(2);
  });
});

describe("logging", () => {
  it("records a single episode at now", async () => {
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes);
    await service.log(show, episodes[2]);

    const [event] = await events(show);
    expect(event).toMatchObject({
      season: 1,
      episode: 3,
      tmdbEpisodeId: episodes[2].tmdbId,
      watchedAt: clock.toISOString(),
      batchId: null,
    });
    expect(await status(show)).toBe("watching");
  });

  it("records a movie without an episode", async () => {
    const movie = await makeMovie();
    await service.log(movie, null);
    const [event] = await events(movie);
    expect(event).toMatchObject({ season: null, episode: null, tmdbEpisodeId: null });
    expect(await status(movie)).toBe("completed");
  });

  it("adds a rewatch when logging again", async () => {
    const episodes = F.season(1, 2);
    const show = await makeShow(episodes);
    await service.log(show, episodes[0]);
    await service.log(show, episodes[0]);
    expect(rewatchCount(await progress(show), episodes[0])).toBe(1);
  });
});

describe("bulk marking", () => {
  it("marks a season, skipping watched and unaired episodes, as one batch", async () => {
    const aired = F.season(2, 10);
    const unaired = [F.episode(2, 11, F.future), F.episode(2, 12, F.future)];
    const show = await makeShow([...F.season(1, 2), ...aired, ...unaired]);
    for (const episode of aired.slice(0, 3)) await service.log(show, episode);

    await service.bulkMark(show, { season: 2 });

    const batch = (await events(show)).filter((e) => e.batchId !== null);
    expect(batch).toHaveLength(7);
    expect(new Set(batch.map((e) => e.batchId)).size).toBe(1);
    expect(new Set(batch.map((e) => e.watchedAt)).size).toBe(1);
    expect(batch.every((e) => e.season === 2 && e.episode! > 3 && e.episode! <= 10)).toBe(true);
  });

  it("skips specials when marking all", async () => {
    const show = await makeShow([...F.season(0, 2), ...F.season(1, 3), ...F.season(2, 2)]);
    await service.bulkMark(show, "all");
    const all = await events(show);
    expect(all).toHaveLength(5);
    expect(all.every((e) => e.season !== 0)).toBe(true);
    expect(await status(show)).toBe("caughtUp");
  });

  it("completes an ended show when marking all", async () => {
    const show = await makeShow(F.season(1, 3), "planToWatch", "Ended");
    await service.bulkMark(show, "all");
    expect(await status(show)).toBe("completed");
  });

  it("does nothing and registers no undo when nothing is left to mark", async () => {
    const undo = new UndoStack();
    const show = await makeShow(F.season(1, 2, F.future));
    await service.bulkMark(show, "all", undo);
    expect(await eventCount()).toBe(0);
    expect(undo.canUndo).toBe(false);
  });
});

describe("unmarking", () => {
  it("removes every event for the episode", async () => {
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes);
    await service.log(show, episodes[2]);
    await service.log(show, episodes[2]);
    await service.log(show, episodes[0]);

    await service.unmark(show, episodes[2]);

    expect(await eventCount()).toBe(1);
    expect(isWatched(await progress(show), episodes[2])).toBe(false);
  });

  it("returns Caught Up to Watching", async () => {
    const episodes = F.season(1, 2);
    const show = await makeShow(episodes);
    await service.bulkMark(show, "all");
    expect(await status(show)).toBe("caughtUp");
    await service.unmark(show, episodes[1]);
    expect(await status(show)).toBe("watching");
  });

  it("returns a movie to Plan to Watch", async () => {
    const movie = await makeMovie();
    await service.log(movie, null);
    await service.unmark(movie, null);
    expect(await eventCount()).toBe(0);
    expect(await status(movie)).toBe("planToWatch");
  });

  it("marks the episode unwatched when its single event is deleted", async () => {
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes);
    await service.log(show, episodes[2]);
    const [event] = await events(show);
    await service.deleteEvent(event.uid);
    expect(isWatched(await progress(show), episodes[2])).toBe(false);
  });
});

describe("undo", () => {
  it("restores events and status after a single log", async () => {
    const undo = new UndoStack();
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes, "planToWatch");

    await service.log(show, episodes[0], undo);
    expect(await status(show)).toBe("watching");
    expect(undo.canUndo).toBe(true);
    expect(undo.undoActionName).toBe("Log Episode");

    await undo.undo();

    expect(await eventCount()).toBe(0);
    expect(await status(show)).toBe("planToWatch");
    expect(undo.canUndo).toBe(false);
  });

  it("undoes a bulk mark in one step", async () => {
    const undo = new UndoStack();
    const episodes = F.season(1, 5);
    const show = await makeShow(episodes, "watching");
    await service.log(show, episodes[0], undo);

    await service.bulkMark(show, { season: 1 }, undo);
    expect(await eventCount()).toBe(5);
    expect(await status(show)).toBe("caughtUp");

    await undo.undo();

    expect(await eventCount()).toBe(1);
    expect(await status(show)).toBe("watching");
  });

  it("registers exactly one step per action", async () => {
    const undo = new UndoStack();
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes);
    await service.log(show, episodes[0], undo);
    await service.bulkMark(show, "all", undo);
    await service.unmark(show, episodes[1], undo);
    await service.setStatus(show, "onHold", undo);
    const steps: (string | undefined)[] = [];
    while (undo.canUndo) {
      steps.push(undo.undoActionName);
      await undo.undo();
    }
    expect(steps).toEqual(["Change Status", "Unmark", "Mark All Watched", "Log Episode"]);
    expect(await eventCount()).toBe(0);
    expect(await status(show)).toBe("planToWatch");
  });

  it("restores unmarked events with their original values", async () => {
    const undo = new UndoStack();
    const episodes = F.season(1, 2);
    const show = await makeShow(episodes);
    await service.bulkMark(show, "all");
    const original = await events(show);

    await service.unmark(show, episodes[1], undo);
    expect(await status(show)).toBe("watching");
    await undo.undo();

    expect(await status(show)).toBe("caughtUp");
    const sortByUid = (list: typeof original) => [...list].sort((a, b) => a.uid.localeCompare(b.uid));
    expect(sortByUid(await events(show))).toEqual(sortByUid(original));
  });

  it("is harmless after the title was removed", async () => {
    const undo = new UndoStack();
    const episodes = F.season(1, 2);
    const show = await makeShow(episodes);
    await service.log(show, episodes[0], undo);
    await repo.deleteTitle(show);
    await undo.undo();
    expect(await repo.listTitles()).toHaveLength(0);
    expect(await eventCount()).toBe(0);
  });
});

describe("setting Completed (LIB-299)", () => {
  it("marks aired regular episodes as one batch", async () => {
    const aired = F.season(1, 10);
    const unaired = [F.episode(1, 11, F.future), F.episode(1, 12, F.future)];
    const show = await makeShow([...F.season(0, 2), ...aired, ...unaired], "watching", "Ended");

    await service.setStatus(show, "completed");

    const all = await events(show);
    expect(all).toHaveLength(10);
    expect(all.every((e) => e.season === 1 && e.episode! <= 10)).toBe(true);
    expect(new Set(all.map((e) => e.batchId)).size).toBe(1);
    expect(all[0].batchId).not.toBeNull();
    expect(await status(show)).toBe("completed");
  });

  it("fills only missing episodes", async () => {
    const episodes = F.season(1, 5);
    const show = await makeShow(episodes, "watching", "Ended");
    await service.log(show, episodes[0]);
    await service.log(show, episodes[1]);

    await service.setStatus(show, "completed");

    expect(await eventCount()).toBe(5);
    expect(new Set((await events(show)).map((e) => e.episode))).toEqual(new Set([1, 2, 3, 4, 5]));
    const p = await progress(show);
    expect(episodes.every((e) => rewatchCount(p, e) === 0)).toBe(true);
  });

  it("makes a returning show Caught Up", async () => {
    // Completed is reserved for finished shows; a Returning show the user has caught up on is Caught Up.
    const show = await makeShow(F.season(1, 3), "watching", "Returning Series");
    await service.setStatus(show, "completed");
    expect(await eventCount()).toBe(3);
    expect(await status(show)).toBe("caughtUp");
  });

  it("keeps Completed on a show with nothing aired", async () => {
    const show = await makeShow(F.season(1, 3, F.future), "planToWatch");
    await service.setStatus(show, "completed");
    expect(await eventCount()).toBe(0);
    expect(await status(show)).toBe("completed");
  });

  it("undoes events and status in one step", async () => {
    const undo = new UndoStack();
    const episodes = F.season(1, 5);
    const show = await makeShow(episodes, "planToWatch", "Ended");
    await service.log(show, episodes[0]);
    expect(await status(show)).toBe("watching");

    await service.setStatus(show, "completed", undo);
    expect(await eventCount()).toBe(5);
    expect(await status(show)).toBe("completed");

    await undo.undo();

    expect(await eventCount()).toBe(1);
    expect(isWatched(await progress(show), episodes[0])).toBe(true);
    expect(await status(show)).toBe("watching");
    expect(undo.canUndo).toBe(false);
  });

  it("undoes another status change", async () => {
    const undo = new UndoStack();
    const show = await makeShow(F.season(1, 3), "watching");
    await service.setStatus(show, "onHold", undo);
    expect(await status(show)).toBe("onHold");
    expect(await eventCount()).toBe(0);
    await undo.undo();
    expect(await status(show)).toBe("watching");
  });

  it("logs one event for an unwatched movie", async () => {
    const movie = await makeMovie();
    await service.setStatus(movie, "completed");
    const all = await events(movie);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ season: null, episode: null, tmdbEpisodeId: null, batchId: null });
    expect(await status(movie)).toBe("completed");
  });

  it("adds no event for a watched movie", async () => {
    const movie = await makeMovie();
    await service.log(movie, null);
    await service.setStatus(movie, "dropped");
    await service.setStatus(movie, "completed");
    expect(await events(movie)).toHaveLength(1);
    expect(await status(movie)).toBe("completed");
  });

  it("respects a manual override until the next log", async () => {
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes);
    await service.log(show, episodes[0]);
    await service.setStatus(show, "dropped");
    expect(await status(show)).toBe("dropped");
    await service.log(show, episodes[1]);
    expect(await status(show)).toBe("watching");
  });
});

describe("Library status menu (LIB-414)", () => {
  it("registers exactly one undo step for Completed and undo restores status and removes the batch", async () => {
    const undo = new UndoStack();
    const episodes = F.season(1, 4);
    const show = await makeShow(episodes, "watching", "Ended");
    await service.log(show, episodes[0]);
    const before = await events(show);

    await service.setStatus(show, "completed", undo);
    const added = (await events(show)).filter((e) => e.batchId !== null);
    expect(added).toHaveLength(3);
    expect(new Set(added.map((e) => e.batchId)).size).toBe(1);
    expect(await status(show)).toBe("completed");
    expect(undo.undoActionName).toBe("Mark Completed");

    await undo.undo();

    expect(undo.canUndo).toBe(false);
    expect(await events(show)).toEqual(before);
    expect(await status(show)).toBe("watching");
  });

  it("offers statuses by kind, never Rewatching", () => {
    expect(allowedStatuses("show")).toEqual(["planToWatch", "watching", "caughtUp", "onHold", "dropped", "completed"]);
    expect(allowedStatuses("movie")).toEqual(["planToWatch", "watching", "onHold", "dropped", "completed"]);
  });

  it("rejects a status not allowed for the kind with a typed error and no undo step", async () => {
    const undo = new UndoStack();
    const movie = await makeMovie();
    const show = await makeShow(F.season(1, 2), "watching");

    const error = await service.setStatus(movie, "caughtUp", undo).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidStatusError);
    expect(error).toMatchObject({ kind: "movie", status: "caughtUp" });
    await expect(service.setStatus(show, "rewatching", undo)).rejects.toBeInstanceOf(InvalidStatusError);

    expect(await status(movie)).toBe("planToWatch");
    expect(await status(show)).toBe("watching");
    expect(undo.canUndo).toBe(false);
  });
});

describe("guided rewatch (LIB-293)", () => {
  async function finishedShow(count = 3, showStatus: ShowStatus = "Ended") {
    const episodes = F.season(1, count);
    const show = await makeShow(episodes, "planToWatch", showStatus);
    await service.bulkMark(show, "all");
    return { show, episodes };
  }

  it("starts only for fully watched shows", async () => {
    const { show: done } = await finishedShow();
    expect(await status(done)).toBe("completed");
    expect(await service.canStartRewatch(done)).toBe(true);

    const episodes = F.season(1, 3);
    const partial = await makeShow(episodes);
    await service.log(partial, episodes[0]);
    expect(await service.canStartRewatch(partial)).toBe(false);
    await service.startRewatch(partial);
    expect(await status(partial)).toBe("watching");

    expect(await service.canStartRewatch(await makeMovie())).toBe(false);
  });

  it("sets Rewatching and undoes", async () => {
    const { show } = await finishedShow();
    const undo = new UndoStack();
    await service.startRewatch(show, undo);
    expect(await status(show)).toBe("rewatching");
    expect(rewatchProgress(await progress(show))?.number).toBe(1);
    await undo.undo();
    expect(await status(show)).toBe("completed");
  });

  it("keeps Rewatching until the pass ends", async () => {
    const { show, episodes } = await finishedShow(3, "Ended");
    await service.startRewatch(show);

    await service.log(show, episodes[0]);
    await service.log(show, episodes[1]);
    expect(await status(show)).toBe("rewatching");
    expect(rewatchProgress(await progress(show))?.next).toEqual(episodes[2]);

    await service.log(show, episodes[2]);
    expect(await status(show)).toBe("completed");
    expect(rewatchCount(await progress(show), episodes[2])).toBe(1);
  });

  it("restores Caught Up after rewatching a returning show", async () => {
    const { show, episodes } = await finishedShow(2, "Returning Series");
    expect(await status(show)).toBe("caughtUp");
    await service.startRewatch(show);
    for (const episode of episodes) await service.log(show, episode);
    expect(await status(show)).toBe("caughtUp");
  });

  it("numbers the second rewatch 2", async () => {
    const { show, episodes } = await finishedShow(2);
    await service.startRewatch(show);
    for (const episode of episodes) await service.log(show, episode);
    await service.startRewatch(show);
    expect(await status(show)).toBe("rewatching");
    expect(rewatchProgress(await progress(show))?.number).toBe(2);
  });

  it("resumes the rewatch when its final log is undone", async () => {
    const { show, episodes } = await finishedShow(2);
    await service.startRewatch(show);
    await service.log(show, episodes[0]);
    const undo = new UndoStack();
    await service.log(show, episodes[1], undo);
    expect(await status(show)).toBe("completed");
    await undo.undo();
    expect(await status(show)).toBe("rewatching");
    expect(rewatchProgress(await progress(show))?.next).toEqual(episodes[1]);
  });

  it("restores the status but keeps events when stopped", async () => {
    const { show, episodes } = await finishedShow();
    await service.startRewatch(show);
    await service.log(show, episodes[0]);
    const before = await eventCount();
    await service.stopRewatch(show);
    expect(await status(show)).toBe("completed");
    expect(await eventCount()).toBe(before);
  });

  it("keeps Rewatching when unmarking", async () => {
    const { show, episodes } = await finishedShow();
    await service.startRewatch(show);
    await service.unmark(show, episodes[2]);
    expect(await status(show)).toBe("rewatching");
  });
});

describe("deleting from History (LIB-416)", () => {
  it("updates progress and recomputes status within the kind's allowed statuses", async () => {
    const episodes = F.season(1, 2);
    const show = await makeShow(episodes, "watching", "Ended");
    await service.bulkMark(show, "all");
    expect(await status(show)).toBe("completed");

    const doomed = (await events(show)).find((e) => e.episode === 2)!;
    await service.deleteEvent(doomed.uid);

    expect(isWatched(await progress(show), episodes[1])).toBe(false);
    expect((await progress(show)).remaining).toBe(1);
    expect(await status(show)).toBe("watching");
    expect(allowedStatuses("show")).toContain(await status(show));

    const movie = await makeMovie();
    await service.log(movie, null);
    const [watch] = await events(movie);
    await service.deleteEvent(watch.uid);
    expect(await events(movie)).toHaveLength(0);
    expect(await status(movie)).toBe("planToWatch");
    expect(allowedStatuses("movie")).toContain(await status(movie));
  });

  it("keeps the episode watched when only a rewatch is deleted", async () => {
    const episodes = F.season(1, 2);
    const show = await makeShow(episodes, "watching", "Ended");
    await service.log(show, episodes[0]);
    await service.log(show, episodes[1]);
    await service.log(show, episodes[1]);
    const rewatch = (await events(show)).find((e) => e.episode === 2)!;
    await service.deleteEvent(rewatch.uid);
    expect(isWatched(await progress(show), episodes[1])).toBe(true);
    expect(rewatchCount(await progress(show), episodes[1])).toBe(0);
    expect(await status(show)).toBe("completed");
  });

  it("registers exactly one undo step that restores the event and status", async () => {
    const undo = new UndoStack();
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes, "watching", "Returning Series");
    await service.bulkMark(show, "all");
    expect(await status(show)).toBe("caughtUp");
    const before = await events(show);

    await service.deleteEvent(before[0].uid, undo);
    expect(await events(show)).toHaveLength(2);
    expect(await status(show)).toBe("watching");
    expect(undo.size).toBe(1);
    expect(undo.undoActionName).toBe("Delete Watch");

    await undo.undo();

    expect(undo.canUndo).toBe(false);
    const sortByUid = (list: typeof before) => [...list].sort((a, b) => a.uid.localeCompare(b.uid));
    expect(sortByUid(await events(show))).toEqual(sortByUid(before));
    expect(await status(show)).toBe("caughtUp");
  });

  it("does nothing and registers no undo for an unknown event", async () => {
    const undo = new UndoStack();
    await service.deleteEvent(crypto.randomUUID(), undo);
    expect(undo.canUndo).toBe(false);
  });
});

describe("title detail (LIB-415)", () => {
  it("marks up to an episode across seasons, skipping specials, as one undo step with a shared batch id", async () => {
    const episodes = [...F.season(0, 2), ...F.season(1, 3), ...F.season(2, 3)];
    const show = await makeShow(episodes, "watching");
    const undo = new UndoStack();
    await service.log(show, episodes[3]);
    await service.bulkMark(show, { upTo: episodes[6] }, undo);

    const added = (await events(show)).filter((e) => e.batchId);
    expect(added.map((e) => `${e.season}:${e.episode}`).sort()).toEqual(["1:1", "1:3", "2:1", "2:2"]);
    expect(new Set(added.map((e) => e.batchId)).size).toBe(1);
    expect(undo.size).toBe(1);
    expect(undo.undoActionName).toBe("Mark Up To Episode");

    await undo.undo();
    expect(await events(show)).toHaveLength(1);
  });

  it("marks up to a special within specials only", async () => {
    const episodes = [...F.season(0, 3), ...F.season(1, 2)];
    const show = await makeShow(episodes);
    await service.bulkMark(show, { upTo: episodes[1] });
    expect((await events(show)).map((e) => `${e.season}:${e.episode}`).sort()).toEqual(["0:1", "0:2"]);
  });

  it("registers one undo step per bulk action, each reverting only itself", async () => {
    const episodes = [...F.season(1, 2), ...F.season(2, 2), ...F.season(3, 2)];
    const show = await makeShow(episodes, "watching");
    const undo = new UndoStack();
    await service.bulkMark(show, { season: 1 }, undo);
    await service.bulkMark(show, { upTo: episodes[2] }, undo);
    await service.bulkMark(show, "all", undo);
    expect(undo.size).toBe(3);
    expect(await events(show)).toHaveLength(6);

    await undo.undo();
    expect(await events(show)).toHaveLength(3);
    await undo.undo();
    expect(await events(show)).toHaveLength(2);
    await undo.undo();
    expect(await events(show)).toHaveLength(0);
    expect(await status(show)).toBe("watching");
  });

  it("toggles an episode on and off with one undo step each", async () => {
    const episodes = F.season(1, 2);
    const show = await makeShow(episodes, "watching", "Ended");
    const undo = new UndoStack();
    await service.log(show, episodes[0], undo);
    await service.log(show, episodes[1], undo);
    expect(await status(show)).toBe("completed");
    await service.unmark(show, episodes[1], undo);
    expect(undo.size).toBe(3);
    expect(await status(show)).toBe("watching");
    expect(await events(show)).toHaveLength(1);

    await undo.undo();
    expect(await status(show)).toBe("completed");
    expect(await events(show)).toHaveLength(2);
  });

  it("starts a rewatch that restarts progress from the log and keeps earlier history", async () => {
    const episodes = F.season(1, 3);
    const show = await makeShow(episodes, "watching", "Ended");
    await service.bulkMark(show, "all");
    const history = await events(show);
    const undo = new UndoStack();
    await service.startRewatch(show, undo);
    expect(await status(show)).toBe("rewatching");
    expect(undo.size).toBe(1);

    expect(rewatchProgress(await progress(show))).toMatchObject({ number: 1, watchedCount: 0, next: episodes[0] });
    await service.log(show, episodes[0], undo);
    const after = await events(show);
    expect(after).toHaveLength(4);
    expect(after).toEqual(expect.arrayContaining(history));
    expect(rewatchProgress(await progress(show))).toMatchObject({ number: 1, watchedCount: 1, next: episodes[1] });
  });

  it("checks rewatch eligibility from progress", async () => {
    const episodes = F.season(1, 1);
    const show = await makeShow(episodes, "completed");
    const title = (await repo.getTitle(show)) as Title;
    expect(canStartRewatch(title, await progress(show))).toBe(false);
    await service.log(show, episodes[0]);
    expect(canStartRewatch((await repo.getTitle(show)) as Title, await progress(show))).toBe(true);
  });
});


afterEach(() => vi.unstubAllGlobals());

describe("LIB-426 write hardening", () => {
  it("serializes separate services sharing a cross-tab lock and reloads state inside it", async () => {
    const names: string[] = [];
    let tail: Promise<unknown> = Promise.resolve();
    const locks = {
      request<T>(name: string, callback: () => Promise<T>): Promise<T> {
        names.push(name);
        const result = tail.then(callback);
        tail = result.catch(() => {});
        return result;
      },
    };
    vi.stubGlobal("navigator", { locks });
    const otherRepo = new LibraryRepository(await openLibraryDB(`watch-log-${dbCount}`));
    const other = new WatchLogService(otherRepo, { today: () => F.today });
    const show = await makeShow(F.season(1, 4));
    const undo = new UndoStack();
    await Promise.all([service.bulkMark(show, { season: 1 }, undo), other.bulkMark(show, "all", undo)]);
    expect(await events(show)).toHaveLength(4);
    expect(new Set((await events(show)).map((e) => e.tmdbEpisodeId)).size).toBe(4);
    expect(await status(show)).toBe("caughtUp");
    expect(undo.size).toBe(1);
    await undo.undo();
    expect(await events(show)).toEqual([]);
    expect(await status(show)).toBe("planToWatch");
    expect(names).toEqual(Array(3).fill("ryuuji-watch-log"));
  });

  it("keeps the in-tab queue when Web Locks is missing", async () => {
    vi.stubGlobal("navigator", {});
    const show = await makeShow(F.season(1, 2));
    await Promise.all([service.bulkMark(show, "all"), service.bulkMark(show, "all")]);
    expect(await events(show)).toHaveLength(2);
    expect(await status(show)).toBe("caughtUp");
  });

  it.each(["completed", "caughtUp"] as const)("reopens %s after the last episode is unmarked", async (initial) => {
    const episodes = F.season(1, 1);
    const show = await makeShow(episodes, "watching", initial === "completed" ? "Ended" : "Returning Series");
    await service.bulkMark(show, "all");
    await service.unmark(show, episodes[0]);
    expect(await events(show)).toEqual([]);
    expect(await status(show)).toBe("watching");
  });

  it.each(["watching", "completed"] as const)("setting the same %s status adds no undo step or events", async (initial) => {
    const show = await makeShow(F.season(1, 2), initial);
    const undo = new UndoStack();
    await service.setStatus(show, initial, undo);
    expect(await events(show)).toEqual([]);
    expect(await status(show)).toBe(initial);
    expect(undo.size).toBe(0);
  });

  it("consumes undo of removed events after deletion without restoring orphan records", async () => {
    const episodes = F.season(1, 1);
    const show = await makeShow(episodes);
    await service.bulkMark(show, "all");
    const undo = new UndoStack();
    await service.unmark(show, episodes[0], undo);
    await repo.deleteTitle(show);
    await expect(undo.undo()).resolves.toBeUndefined();
    expect(await repo.getTitle(show)).toBeUndefined();
    expect(await events(show)).toEqual([]);
    expect(undo.size).toBe(0);
  });
});
