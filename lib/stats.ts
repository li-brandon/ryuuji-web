import { addDays, addMonths, localCalendar, startOfDay, startOfMonth, startOfWeek, type Calendar } from "./calendar";
import { episodeMatcher, titleEpisodes, type Episode, type EventRef } from "./progress";
import { LIST_STATUSES, type Kind, type ListStatus, type Title, type WatchEvent } from "./types";

// Ports the macOS app's Domain/Stats.swift (LIB-291): viewing statistics derived from watch
// events and title metadata.

export const STATS_RANGES = ["fourWeeks", "threeMonths", "twelveMonths", "allTime"] as const;
/** How far back the Stats view looks. */
export type StatsRange = (typeof STATS_RANGES)[number];

export const STATS_RANGE_LABELS: Record<StatsRange, string> = {
  fourWeeks: "Last 4 Weeks",
  threeMonths: "Last 3 Months",
  twelveMonths: "Last 12 Months",
  allTime: "All Time",
};

/** The earliest instant included in `range`, or null for all time. */
export function rangeStart(range: StatsRange, now: Date, calendar: Calendar = localCalendar()): Date | null {
  const today = startOfDay(calendar, now);
  switch (range) {
    case "fourWeeks":
      return addDays(calendar, today, -27);
    case "threeMonths":
      return addMonths(calendar, today, -3);
    case "twelveMonths":
      return addMonths(calendar, today, -12);
    case "allTime":
      return null;
  }
}

export const BUCKET_SIZES = ["week", "month"] as const;
/** Chart bucket width. */
export type BucketSize = (typeof BUCKET_SIZES)[number];

/** Start of the bucket containing `date`. */
export const bucketStart = (size: BucketSize, date: Date, calendar: Calendar = localCalendar()) =>
  size === "week" ? startOfWeek(calendar, date) : startOfMonth(calendar, date);

const nextBucket = (size: BucketSize, start: Date, calendar: Calendar) =>
  size === "week" ? addDays(calendar, start, 7) : addMonths(calendar, start, 1);

/** What the aggregation needs from one title. */
export type StatsTitle = {
  kind: Kind;
  isAnime: boolean;
  genres: string[];
  /** Movie runtime, or the show's typical episode runtime. */
  runtime: number | null;
  episodes: Episode[];
  events: (EventRef & { watchedAt: Date })[];
};

/** One watch event with everything the charts group by. */
export type StatsEvent = {
  watchedAt: Date;
  kind: Kind;
  isAnime: boolean;
  genres: string[];
  minutes: number;
  /** True for any event that isn't the earliest for its episode (or movie). */
  isRewatch: boolean;
};

/** Totals for one week or month, or one slice of a breakdown (a kind, anime vs. other, a genre). */
export type Totals = { firstWatches: number; rewatches: number; minutes: number };
export type StatsBucket = Totals & { start: Date };
export type StatsSlice = Totals & { label: string };

export const watches = (t: Totals) => t.firstWatches + t.rewatches;
export const hours = (t: Totals) => t.minutes / 60;

/** Number of titles with one score. */
export type ScoreBin = { score: number; count: number };

export function statsTitle(title: Title, events: WatchEvent[]): StatsTitle {
  return {
    kind: title.kind,
    isAnime: title.isAnime,
    genres: title.genres,
    runtime: title.runtime,
    episodes: titleEpisodes(title),
    events: events.map((e) => ({ season: e.season, episode: e.episode, tmdbEpisodeId: e.tmdbEpisodeId, watchedAt: new Date(e.watchedAt) })),
  };
}

/** Runtime used when neither the episode nor the title has one. */
export const fallbackMinutes = (kind: Kind, isAnime: boolean) => (kind === "movie" ? 100 : isAnime ? 24 : 45);

/** Flattens one title's events, flagging rewatches and estimating minutes. */
export function titleEvents(title: StatsTitle): StatsEvent[] {
  const match = episodeMatcher(title.episodes);
  const seen = new Set<string>();
  return [...title.events]
    .sort((a, b) => a.watchedAt.getTime() - b.watchedAt.getTime())
    .map((ref) => {
      const episode = match(ref);
      const key = episode
        ? `id-${episode.tmdbId}`
        : ref.tmdbEpisodeId != null
          ? `id-${ref.tmdbEpisodeId}`
          : `${ref.season ?? -1}x${ref.episode ?? -1}`;
      const isRewatch = seen.has(key);
      seen.add(key);
      return {
        watchedAt: ref.watchedAt,
        kind: title.kind,
        isAnime: title.isAnime,
        genres: title.genres,
        minutes: episode?.runtime ?? title.runtime ?? fallbackMinutes(title.kind, title.isAnime),
        isRewatch,
      };
    });
}

export const allEvents = (titles: StatsTitle[]) => titles.flatMap(titleEvents);

/** Events on or after `start` and no later than `now`. */
export const filterEvents = (events: StatsEvent[], start: Date | null, now: Date) =>
  events.filter((e) => e.watchedAt <= now && (start === null || e.watchedAt >= start));

/** Episode and movie counts, first watches vs. rewatches and minutes for the summary tiles. */
export function summary(events: StatsEvent[]): Totals & { episodes: number; movies: number } {
  return {
    ...total(events),
    episodes: events.filter((e) => e.kind === "show").length,
    movies: events.filter((e) => e.kind === "movie").length,
  };
}

function total(events: StatsEvent[]): Totals {
  const totals: Totals = { firstWatches: 0, rewatches: 0, minutes: 0 };
  for (const event of events) add(totals, event);
  return totals;
}

function add(totals: Totals, event: StatsEvent) {
  if (event.isRewatch) totals.rewatches++;
  else totals.firstWatches++;
  totals.minutes += event.minutes;
}

/**
 * One bucket per week or month from the range start (or the earliest event) through `now`,
 * including empty ones so the chart's time axis has no gaps.
 */
export function buckets(
  events: StatsEvent[],
  size: BucketSize,
  start: Date | null,
  now: Date,
  calendar: Calendar = localCalendar(),
): StatsBucket[] {
  const first = start ?? (events.length ? new Date(Math.min(...events.map((e) => e.watchedAt.getTime()))) : null);
  if (!first) return [];

  const byStart = new Map<number, StatsBucket>();
  const last = bucketStart(size, now, calendar);
  for (let cursor = bucketStart(size, first, calendar); cursor <= last; cursor = nextBucket(size, cursor, calendar)) {
    byStart.set(cursor.getTime(), { start: cursor, firstWatches: 0, rewatches: 0, minutes: 0 });
  }

  for (const event of events) {
    const key = bucketStart(size, event.watchedAt, calendar);
    let bucket = byStart.get(key.getTime());
    if (!bucket) byStart.set(key.getTime(), (bucket = { start: key, firstWatches: 0, rewatches: 0, minutes: 0 }));
    add(bucket, event);
  }
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

function slices(events: StatsEvent[], labels: (event: StatsEvent) => string[]): Map<string, StatsSlice> {
  const byLabel = new Map<string, StatsSlice>();
  for (const event of events) {
    for (const label of new Set(labels(event))) {
      let slice = byLabel.get(label);
      if (!slice) byLabel.set(label, (slice = { label, firstWatches: 0, rewatches: 0, minutes: 0 }));
      add(slice, event);
    }
  }
  return byLabel;
}

const inOrder = (byLabel: Map<string, StatsSlice>, order: string[]) =>
  order.flatMap((label) => byLabel.get(label) ?? []);

/** Totals per kind, shows first, omitting kinds with no events. */
export const byKind = (events: StatsEvent[]) =>
  inOrder(slices(events, (e) => [e.kind === "show" ? "Shows" : "Movies"]), ["Shows", "Movies"]);

/** Anime vs. everything else, omitting an empty side. */
export const byOrigin = (events: StatsEvent[]) =>
  inOrder(slices(events, (e) => [e.isAnime ? "Anime" : "Other"]), ["Anime", "Other"]);

/**
 * Totals per genre, most watched first, then by name. An event counts once for each of its
 * title's genres; titles without genres are grouped under "Unknown".
 */
export const byGenre = (events: StatsEvent[]) =>
  [...slices(events, (e) => (e.genres.length ? e.genres : ["Unknown"])).values()].sort(
    (a, b) => watches(b) - watches(a) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );

/** Titles per score 1–10, with empty scores included. Unscored titles are ignored. */
export function scoreHistogram(scores: (number | null)[]): ScoreBin[] {
  const counts = new Map<number, number>();
  for (const score of scores) {
    if (score !== null && Number.isInteger(score) && score >= 1 && score <= 10) counts.set(score, (counts.get(score) ?? 0) + 1);
  }
  return Array.from({ length: 10 }, (_, i) => ({ score: i + 1, count: counts.get(i + 1) ?? 0 }));
}

/** Titles per list status, in `LIST_STATUSES` order, omitting statuses no title has. */
export function byStatus(statuses: ListStatus[]): { status: ListStatus; count: number }[] {
  return LIST_STATUSES.map((status) => ({ status, count: statuses.filter((s) => s === status).length })).filter((s) => s.count > 0);
}
