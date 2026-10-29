import { describe, expect, it } from "vitest";
import * as F from "../test/domain-fixtures";
import type { Calendar } from "./calendar";
import { batchLabel, dayHeading, episodeLabel, historyDays, rewatchNumbers, type HistoryEntry } from "./history";
import type { WatchEvent } from "./types";

const calendar: Calendar = { timeZone: "UTC", firstWeekday: 2 };
let uid = 0;

function event(tmdbId: number, watchedAt: string, fields: Partial<WatchEvent> = {}): WatchEvent {
  return { uid: `e${++uid}`, tmdbId, kind: "show", watchedAt, season: 1, episode: 1, tmdbEpisodeId: 1001, batchId: null, ...fields };
}

const entry = (e: WatchEvent): HistoryEntry => ({ event: e, title: undefined });

describe("history", () => {
  it("groups newest first by day and collapses batches", () => {
    const a = event(1, "2026-06-14T09:00:00Z");
    const b1 = event(2, "2026-06-15T08:00:00Z", { batchId: "b", episode: 1 });
    const b2 = event(2, "2026-06-15T08:00:00Z", { batchId: "b", episode: 2, tmdbEpisodeId: 1002 });
    const c = event(1, "2026-06-15T20:00:00Z");
    const lone = event(3, "2026-06-15T10:00:00Z", { batchId: "solo" });
    const days = historyDays([a, b1, b2, c, lone].map(entry), calendar);

    expect(days.map((d) => d.start.toISOString())).toEqual(["2026-06-15T00:00:00.000Z", "2026-06-14T00:00:00.000Z"]);
    expect(days[0].items.map((i) => (i.kind === "single" ? i.entry.event.uid : i.entries.map((e) => e.event.uid)))).toEqual([c.uid, lone.uid, [b1.uid, b2.uid]]);
    expect(days[1].items).toHaveLength(1);
  });

  it("numbers rewatches per episode and title", () => {
    const first = event(1, "2026-06-01T00:00:00Z");
    const second = event(1, "2026-06-02T00:00:00Z", { season: null, episode: null });
    const third = event(1, "2026-06-03T00:00:00Z");
    const otherTitle = event(2, "2026-06-04T00:00:00Z");
    const numbers = rewatchNumbers([third, otherTitle, first, second]);
    expect(numbers.get(first.uid)).toBeUndefined();
    expect(numbers.get(second.uid)).toBe(1);
    expect(numbers.get(third.uid)).toBe(2);
    expect(numbers.has(otherTitle.uid)).toBe(false);
  });

  it("labels episodes, falling back to the code, and leaves movies to the title", () => {
    const episodes = F.season(1, 3);
    const title = F.show(episodes);
    expect(episodeLabel(event(title.tmdbId, "2026-06-01T00:00:00Z", { episode: 3, tmdbEpisodeId: episodes[2].tmdbId }), title)).toBe("S1 · E3 — Episode 3");
    expect(episodeLabel(event(title.tmdbId, "2026-06-01T00:00:00Z", { season: 4, episode: 2, tmdbEpisodeId: 99 }), title)).toBe("S4 · E2");
    expect(episodeLabel(event(9, "2026-06-01T00:00:00Z", { kind: "movie", season: null, episode: null, tmdbEpisodeId: null }), undefined)).toBeNull();
  });

  it("labels batches", () => {
    expect(batchLabel([event(1, "x", { season: 2 }), event(1, "x", { season: 2 })])).toBe("Season 2 · 2 episodes");
    expect(batchLabel([event(1, "x", { season: 0 })])).toBe("Specials · 1 episode");
    expect(batchLabel([event(1, "x", { season: 1 }), event(1, "x", { season: 2 })])).toBe("2 episodes");
  });

  it("calls recent days Today and Yesterday", () => {
    const now = new Date("2026-06-15T18:00:00Z");
    expect(dayHeading(new Date("2026-06-15T00:00:00Z"), now, calendar)).toBe("Today");
    expect(dayHeading(new Date("2026-06-14T00:00:00Z"), now, calendar)).toBe("Yesterday");
    expect(dayHeading(new Date("2026-06-10T12:00:00Z"), now, calendar)).toMatch(/June 10, 2026$/);
  });
});
