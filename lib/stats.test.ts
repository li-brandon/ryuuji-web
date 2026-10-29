import { describe, expect, it } from "vitest";
import * as F from "../test/domain-fixtures";
import type { Calendar } from "./calendar";
import type { Episode, EventRef } from "./progress";
import {
  bucketStart,
  buckets,
  byGenre,
  byKind,
  byOrigin,
  byStatus,
  filterEvents,
  hours,
  rangeStart,
  scoreHistogram,
  statsTitle,
  summary,
  titleEvents,
  watches,
  type StatsEvent,
  type StatsTitle,
} from "./stats";
import type { Kind, Title, WatchEvent } from "./types";

// Ports RyuujiTests/Domain/StatsTests.swift.

/** Monday-first UTC, so bucket boundaries don't depend on the test machine. */
const calendar: Calendar = { timeZone: "UTC", firstWeekday: 2 };

const date = (year: number, month: number, day: number, hour = 12) => new Date(Date.UTC(year, month - 1, day, hour));

const at = (ref: EventRef, watchedAt = date(2026, 1, 1)) => ({ ...ref, watchedAt });

function show(episodes: Episode[], events: StatsTitle["events"], { isAnime = true, genres = ["Animation"], runtime = null as number | null } = {}): StatsTitle {
  return { kind: "show", isAnime, genres, runtime, episodes, events };
}

function event({ watchedAt, kind = "show", isAnime = false, genres = [], minutes = 30, isRewatch = false }: Partial<StatsEvent> & { watchedAt: Date; kind?: Kind }): StatsEvent {
  return { watchedAt, kind, isAnime, genres, minutes, isRewatch };
}

describe("event flattening", () => {
  it("flags later events for the same episode as rewatches", () => {
    const episodes = F.season(1, 2);
    const title = show(episodes, [
      at(F.event(episodes[0]), date(2026, 3, 3)),
      at(F.event(episodes[1]), date(2026, 3, 2)),
      at(F.event(episodes[0]), date(2026, 3, 1)),
    ]);
    const events = titleEvents(title).sort((a, b) => a.watchedAt.getTime() - b.watchedAt.getTime());
    expect(events.map((e) => e.isRewatch)).toEqual([false, false, true]);
  });

  it("matches events without an id to the same episode as id events", () => {
    const episode = F.episode(1, 1);
    const title = show([episode], [
      at(F.event(episode), date(2026, 3, 1)),
      { season: 1, episode: 1, tmdbEpisodeId: null, watchedAt: date(2026, 3, 2) },
    ]);
    expect(titleEvents(title).filter((e) => e.isRewatch)).toHaveLength(1);
  });

  it("flags movie rewatches", () => {
    const movie: StatsTitle = { kind: "movie", isAnime: false, genres: ["Drama"], runtime: 120, episodes: [], events: [
      at(F.movieEvent(), date(2026, 1, 1)),
      at(F.movieEvent(), date(2026, 2, 1)),
    ] };
    const events = titleEvents(movie);
    expect(events.map((e) => e.isRewatch)).toEqual([false, true]);
    expect(events.every((e) => e.minutes === 120)).toBe(true);
  });

  it("takes minutes from the episode, then the title, then a fallback", () => {
    const withRuntime = { ...F.episode(1, 1), runtime: 50 };
    const noRuntime = { ...F.episode(1, 2), runtime: null };

    const titled = show([withRuntime, noRuntime], [at(F.event(withRuntime)), at(F.event(noRuntime))], { runtime: 40 });
    expect(titleEvents(titled).map((e) => e.minutes).sort()).toEqual([40, 50]);

    const anime = show([noRuntime], [at(F.event(noRuntime))], { isAnime: true });
    expect(titleEvents(anime).map((e) => e.minutes)).toEqual([24]);

    const drama = show([noRuntime], [at(F.event(noRuntime))], { isAnime: false });
    expect(titleEvents(drama).map((e) => e.minutes)).toEqual([45]);

    const movie: StatsTitle = { kind: "movie", isAnime: false, genres: [], runtime: null, episodes: [], events: [at(F.movieEvent())] };
    expect(titleEvents(movie).map((e) => e.minutes)).toEqual([100]);
  });

  it("uses the title runtime for orphan events", () => {
    const title = show([], [{ season: 9, episode: 9, tmdbEpisodeId: 99_999, watchedAt: date(2026, 1, 1) }], { runtime: 30 });
    const events = titleEvents(title);
    expect(events).toHaveLength(1);
    expect(events[0].minutes).toBe(30);
    expect(events[0].isRewatch).toBe(false);
  });

  it("builds stats input from a stored title and its events", () => {
    const episodes = F.season(1, 1);
    const title: Title = { ...F.show(episodes), isAnime: true, genres: ["Animation"], runtime: 24 };
    const stored: WatchEvent = { uid: crypto.randomUUID(), tmdbId: title.tmdbId, kind: "show", watchedAt: "2026-03-01T12:00:00.000Z", season: 1, episode: 1, tmdbEpisodeId: episodes[0].tmdbId, batchId: null };
    const input = statsTitle(title, [stored]);
    expect(input.events[0].watchedAt).toEqual(date(2026, 3, 1));
    expect(input.episodes).toEqual(episodes);
    expect(titleEvents(input)).toMatchObject([{ kind: "show", isAnime: true, minutes: 24, isRewatch: false }]);
  });
});

describe("range", () => {
  it("starts each range at local midnight", () => {
    const now = date(2026, 6, 15, 18);
    expect(rangeStart("fourWeeks", now, calendar)).toEqual(date(2026, 5, 19, 0));
    expect(rangeStart("threeMonths", now, calendar)).toEqual(date(2026, 3, 15, 0));
    expect(rangeStart("twelveMonths", now, calendar)).toEqual(date(2025, 6, 15, 0));
    expect(rangeStart("allTime", now, calendar)).toBeNull();
  });

  it("clamps month arithmetic to the end of shorter months", () => {
    expect(rangeStart("threeMonths", date(2026, 5, 31), calendar)).toEqual(date(2026, 2, 28, 0));
  });

  it("keeps events inside the range", () => {
    const events = [event({ watchedAt: date(2026, 1, 1) }), event({ watchedAt: date(2026, 3, 1) }), event({ watchedAt: date(2026, 9, 1) })];
    const kept = filterEvents(events, date(2026, 2, 1), date(2026, 6, 1));
    expect(kept.map((e) => e.watchedAt)).toEqual([date(2026, 3, 1)]);
    expect(filterEvents(events, null, date(2026, 6, 1))).toHaveLength(2);
  });

  it("decides rewatch status before filtering", () => {
    const episode = F.episode(1, 1);
    const title = show([episode], [at(F.event(episode), date(2025, 1, 1)), at(F.event(episode), date(2026, 5, 1))]);
    const recent = filterEvents(titleEvents(title), date(2026, 1, 1), date(2026, 6, 1));
    expect(recent.map((e) => e.isRewatch)).toEqual([true]);
  });
});

describe("buckets", () => {
  it("splits weeks on the calendar's first weekday", () => {
    // 2026-06-07 is a Sunday; 2026-06-08 a Monday.
    const events = [
      event({ watchedAt: date(2026, 6, 7), minutes: 24 }),
      event({ watchedAt: date(2026, 6, 8), minutes: 24, isRewatch: true }),
      event({ watchedAt: date(2026, 6, 9), minutes: 30 }),
    ];
    const result = buckets(events, "week", date(2026, 6, 1), date(2026, 6, 10), calendar);
    expect(result.map((b) => b.start)).toEqual([date(2026, 6, 1, 0), date(2026, 6, 8, 0)]);
    expect(result[0].firstWatches).toBe(1);
    expect(result[1].firstWatches).toBe(1);
    expect(result[1].rewatches).toBe(1);
    expect(result[1].minutes).toBe(54);
    expect(hours(result[1])).toBe(0.9);
    expect(bucketStart("week", date(2026, 6, 7), { ...calendar, firstWeekday: 1 })).toEqual(date(2026, 6, 7, 0));
  });

  it("includes empty months", () => {
    const events = [event({ watchedAt: date(2026, 1, 31) }), event({ watchedAt: date(2026, 4, 1) })];
    const result = buckets(events, "month", null, date(2026, 4, 20), calendar);
    expect(result.map(watches)).toEqual([1, 0, 0, 1]);
    expect(result[0].start).toEqual(date(2026, 1, 1, 0));
  });

  it("has no buckets without events or a start", () => {
    expect(buckets([], "week", null, date(2026, 1, 1), calendar)).toEqual([]);
  });
});

describe("breakdowns", () => {
  it("partitions events by kind and origin", () => {
    const events = [
      event({ watchedAt: date(2026, 1, 1), kind: "show", isAnime: true, minutes: 24 }),
      event({ watchedAt: date(2026, 1, 1), kind: "show", isAnime: false, minutes: 60, isRewatch: true }),
      event({ watchedAt: date(2026, 1, 1), kind: "movie", isAnime: true, minutes: 120 }),
    ];
    const kinds = byKind(events);
    expect(kinds.map((s) => s.label)).toEqual(["Shows", "Movies"]);
    expect(kinds[0]).toMatchObject({ firstWatches: 1, rewatches: 1, minutes: 84 });
    expect(watches(kinds[1])).toBe(1);

    const origin = byOrigin(events);
    expect(origin.map((s) => s.label)).toEqual(["Anime", "Other"]);
    expect(watches(origin[0])).toBe(2);
    expect(origin[0].minutes).toBe(144);
    expect(origin[1].rewatches).toBe(1);
  });

  it("omits empty slices", () => {
    const events = [event({ watchedAt: date(2026, 1, 1), kind: "movie", isAnime: true })];
    expect(byKind(events).map((s) => s.label)).toEqual(["Movies"]);
    expect(byOrigin(events).map((s) => s.label)).toEqual(["Anime"]);
  });

  it("counts genres once per event and sorts by watches", () => {
    const events = [
      event({ watchedAt: date(2026, 1, 1), genres: ["Animation", "Comedy"] }),
      event({ watchedAt: date(2026, 1, 1), genres: ["Animation", "Drama"] }),
      event({ watchedAt: date(2026, 1, 1), genres: ["Animation", "Animation"] }),
      event({ watchedAt: date(2026, 1, 1), genres: [] }),
    ];
    const genres = byGenre(events);
    expect(genres.map((s) => s.label)).toEqual(["Animation", "Comedy", "Drama", "Unknown"]);
    expect(genres.map(watches)).toEqual([3, 1, 1, 1]);
  });

  it("summarizes episodes, movies, first watches, rewatches and minutes", () => {
    const events = [
      event({ watchedAt: date(2026, 1, 1), kind: "show", minutes: 24 }),
      event({ watchedAt: date(2026, 1, 2), kind: "show", minutes: 24, isRewatch: true }),
      event({ watchedAt: date(2026, 1, 3), kind: "movie", minutes: 102 }),
    ];
    expect(summary(events)).toEqual({ episodes: 2, movies: 1, firstWatches: 2, rewatches: 1, minutes: 150 });
    expect(hours(summary(events))).toBe(2.5);
  });

  it("counts titles per list status in status order", () => {
    expect(byStatus(["completed", "watching", "completed", "planToWatch"])).toEqual([
      { status: "planToWatch", count: 1 },
      { status: "watching", count: 1 },
      { status: "completed", count: 2 },
    ]);
  });
});

describe("scores", () => {
  it("covers one to ten", () => {
    const bins = scoreHistogram([8, 8, 10, null, 3, 0, 11]);
    expect(bins.map((b) => b.score)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(bins.find((b) => b.score === 8)?.count).toBe(2);
    expect(bins.find((b) => b.score === 10)?.count).toBe(1);
    expect(bins.find((b) => b.score === 3)?.count).toBe(1);
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(4);
  });
});
