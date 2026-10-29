import { describe, expect, it } from "vitest";
import { episode, event, movieEvent, season, show, today } from "../test/domain-fixtures";
import { computeProgress, type Episode } from "./progress";
import { statusAfter, statusAfterRefresh, type StatusTrigger } from "./status-engine";
import { LIST_STATUSES, type ListStatus, type ShowStatus, type WatchEvent } from "./types";

// Ports RyuujiTests/Domain/StatusEngineTests.swift (one test per list-status spec scenario)
// and the status cases of MetadataRefresherTests.swift.

const episodes = season(1, 3);

function progress(watched: number, eps: Episode[] = episodes) {
  return computeProgress(eps, eps.slice(0, watched).map(event), today);
}

function showStatus(trigger: StatusTrigger, current: ListStatus, watched: number, tmdb: ShowStatus = "Returning Series") {
  return statusAfter(trigger, { current, kind: "show", progress: progress(watched), showStatus: tmdb });
}

function movieStatus(trigger: StatusTrigger, current: ListStatus, events: number) {
  const p = computeProgress([], Array.from({ length: events }, movieEvent), today);
  return statusAfter(trigger, { current, kind: "movie", progress: p, showStatus: null });
}

describe("StatusEngine", () => {
  it("has seven statuses", () => {
    expect(LIST_STATUSES).toHaveLength(7);
  });

  describe("logging", () => {
    it("makes the first logged episode Watching", () => {
      expect(showStatus("log", "planToWatch", 1)).toBe("watching");
    });

    it.each(["onHold", "dropped"] as const)("reactivates a paused show (%s)", (current) => {
      expect(showStatus("log", current, 2)).toBe("watching");
    });

    it("is Caught Up on a returning show", () => {
      expect(showStatus("log", "watching", 3, "Returning Series")).toBe("caughtUp");
    });

    it("completes a finished ended or canceled show", () => {
      expect(showStatus("log", "watching", 3, "Ended")).toBe("completed");
      expect(showStatus("log", "watching", 3, "Canceled")).toBe("completed");
    });

    it("completes a watched movie", () => {
      expect(movieStatus("log", "planToWatch", 1)).toBe("completed");
    });

    it("keeps a completed ended show Completed when rewatching an episode", () => {
      const p = computeProgress(episodes, [...episodes.map(event), event(episodes[0])], today);
      expect(statusAfter("log", { current: "completed", kind: "show", progress: p, showStatus: "Ended" })).toBe("completed");
    });
  });

  describe("refresh", () => {
    it("moves Caught Up to Watching when a new episode airs", () => {
      expect(showStatus("refresh", "caughtUp", 2)).toBe("watching");
    });

    it("moves Caught Up to Completed when the show ends", () => {
      expect(showStatus("refresh", "caughtUp", 3, "Ended")).toBe("completed");
    });

    it.each(["onHold", "dropped", "planToWatch", "completed"] as const)("leaves %s alone", (current) => {
      expect(showStatus("refresh", current, 2)).toBe(current);
    });

    it("keeps a manual Completed", () => {
      expect(showStatus("refresh", "completed", 1)).toBe("completed");
    });
  });

  describe("unmarking", () => {
    it("reopens Caught Up or Completed as Watching", () => {
      expect(showStatus("unmark", "caughtUp", 2)).toBe("watching");
      expect(showStatus("unmark", "completed", 2, "Ended")).toBe("watching");
    });

    it.each(["onHold", "dropped", "watching", "planToWatch"] as const)("leaves %s alone", (current) => {
      expect(showStatus("unmark", current, 0)).toBe(current);
    });

    it("returns a movie to Plan to Watch only when its last event is gone", () => {
      expect(movieStatus("unmark", "completed", 0)).toBe("planToWatch");
      expect(movieStatus("unmark", "completed", 1)).toBe("completed");
    });
  });

  it("respects a manual Dropped until the next log", () => {
    expect(showStatus("refresh", "dropped", 1)).toBe("dropped");
    expect(showStatus("log", "dropped", 1)).toBe("watching");
  });

  describe("setting Completed (LIB-299)", () => {
    it("keeps Completed for a fully logged ended show", () => {
      expect(showStatus("log", "completed", 3, "Ended")).toBe("completed");
    });

    it("makes a fully logged returning show Caught Up", () => {
      expect(showStatus("log", "completed", 3, "Returning Series")).toBe("caughtUp");
    });
  });

  describe("rewatching (LIB-293)", () => {
    it("keeps Rewatching when logging", () => {
      expect(showStatus("log", "rewatching", 3, "Ended")).toBe("rewatching");
    });

    it.each(["refresh", "unmark"] as const)("keeps Rewatching on %s", (trigger) => {
      expect(showStatus(trigger, "rewatching", 2)).toBe("rewatching");
    });

    it("restores the status from progress when the rewatch ends", () => {
      expect(showStatus("endRewatch", "rewatching", 3, "Ended")).toBe("completed");
      expect(showStatus("endRewatch", "rewatching", 3, "Returning Series")).toBe("caughtUp");
      expect(showStatus("endRewatch", "rewatching", 2, "Returning Series")).toBe("watching");
    });
  });
});

describe("statusAfterRefresh", () => {
  const watched = (eps: Episode[]): WatchEvent[] =>
    eps.map((e, i) => ({ ...event(e), uid: `e${i}`, tmdbId: 0, kind: "show", watchedAt: "2026-06-01T00:00:00.000Z", batchId: null }));
  const original = season(1, 2);

  it("moves Caught Up to Watching when refreshed metadata adds an aired episode", () => {
    const refreshed = show([...original, episode(1, 3)], "caughtUp");
    expect(statusAfterRefresh(refreshed, watched(original), today)).toBe("watching");
  });

  it("completes a Caught Up show that has ended", () => {
    const refreshed = show(original, "caughtUp", "Ended");
    expect(statusAfterRefresh(refreshed, watched(original), today)).toBe("completed");
  });

  it("leaves a paused show untouched", () => {
    const refreshed = show([...original, episode(1, 3)], "onHold");
    expect(statusAfterRefresh(refreshed, watched(original), today)).toBe("onHold");
  });
});
