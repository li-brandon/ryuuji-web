import { addDays, isSameDay, localCalendar, startOfDay, type Calendar } from "./calendar";
import { episodeMatcher, titleEpisodes } from "./progress";
import type { Title, WatchEvent } from "./types";

// Ports the HistoryModel in the macOS app's Views/History/HistoryView.swift: every watch event,
// newest first, grouped by local day with bulk batches collapsed.

export type HistoryEntry = { event: WatchEvent; title: Title | undefined };
export type HistoryItem = { kind: "single"; entry: HistoryEntry } | { kind: "batch"; id: string; entries: HistoryEntry[] };
export type HistoryDay = { start: Date; items: HistoryItem[] };

const time = (e: WatchEvent) => new Date(e.watchedAt).getTime();

/**
 * Entries newest first, grouped by day; events sharing a batch id form one item. A batch that
 * spans midnight stays whole under the day of its newest event.
 */
export function historyDays(entries: HistoryEntry[], calendar: Calendar = localCalendar()): HistoryDay[] {
  const sorted = [...entries].sort((a, b) => time(b.event) - time(a.event));
  const days: HistoryDay[] = [];
  const batches = new Map<string, HistoryEntry[]>();
  for (const entry of sorted) {
    const batchId = entry.event.batchId;
    const existing = batchId ? batches.get(batchId) : undefined;
    if (existing) {
      existing.push(entry);
      continue;
    }
    const start = startOfDay(calendar, new Date(entry.event.watchedAt));
    let day = days.at(-1);
    if (!day || day.start.getTime() !== start.getTime()) days.push((day = { start, items: [] }));
    if (!batchId) {
      day.items.push({ kind: "single", entry });
    } else {
      const batch: HistoryEntry[] = [entry];
      batches.set(batchId, batch);
      day.items.push({ kind: "batch", id: batchId, entries: batch });
    }
  }
  // A batch of one reads better as a plain row.
  for (const day of days) {
    day.items = day.items.map((item) => (item.kind === "batch" && item.entries.length === 1 ? { kind: "single", entry: item.entries[0] } : item));
  }
  return days;
}

/**
 * Rewatch number per event uid: 1 for an episode's (or movie's) second watch, 2 for its third…
 * First watches are absent.
 */
export function rewatchNumbers(events: WatchEvent[]): Map<string, number> {
  const byEpisode = new Map<string, WatchEvent[]>();
  for (const event of events) {
    const episode = event.tmdbEpisodeId != null ? String(event.tmdbEpisodeId) : `${event.season ?? -1}x${event.episode ?? -1}`;
    const key = `${event.kind}:${event.tmdbId}:${episode}`;
    byEpisode.set(key, [...(byEpisode.get(key) ?? []), event]);
  }
  const numbers = new Map<string, number>();
  for (const group of byEpisode.values()) {
    [...group].sort((a, b) => time(a) - time(b)).forEach((event, index) => {
      if (index > 0) numbers.set(event.uid, index);
    });
  }
  return numbers;
}

/** "S1 · E3 — Name", or "S1 · E3" when the episode is no longer cached; null for a movie. */
export function episodeLabel(event: WatchEvent, title: Title | undefined): string | null {
  if (event.kind === "movie") return null;
  const code = `S${event.season ?? 0} · E${event.episode ?? 0}`;
  const episode = title && episodeMatcher(titleEpisodes(title))(event);
  return episode ? `S${episode.season} · E${episode.number} — ${episode.name}` : code;
}

/** "Season 1 · 12 episodes" for a batch. */
export function batchLabel(events: WatchEvent[]): string {
  const seasons = new Set(events.flatMap((e) => (e.season === null ? [] : [e.season])));
  const count = `${events.length} episode${events.length === 1 ? "" : "s"}`;
  if (seasons.size === 1) {
    const [season] = seasons;
    return season === 0 ? `Specials · ${count}` : `Season ${season} · ${count}`;
  }
  return count;
}

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** "Today", "Yesterday" or e.g. "Wednesday, October 28, 2026". */
export function dayHeading(start: Date, now: Date, calendar: Calendar = localCalendar()): string {
  if (isSameDay(calendar, start, now)) return "Today";
  if (isSameDay(calendar, start, addDays(calendar, now, -1))) return "Yesterday";
  return dayFormat.format(start);
}
