import { isAired } from "./air-date";
import type { EpisodeMetadata, Title, WatchEvent } from "./types";

// Ports the macOS app's Domain/Progress.swift: progress derived from cached episodes and watch events.

export type Episode = EpisodeMetadata["seasons"][number]["episodes"][number];
/** A watch event reduced to the fields matching needs. */
export type EventRef = Pick<WatchEvent, "season" | "episode" | "tmdbEpisodeId">;

export type Progress = {
  /** Number of events per episode, keyed by TMDB episode id. */
  watchCounts: Map<number, number>;
  /** Aired regular (non-special) episodes in season/episode order. */
  airedRegular: Episode[];
  /** How many of `airedRegular` have at least one event. */
  watchedAiredRegularCount: number;
  /** The first aired, unwatched regular episode. */
  next: Episode | null;
  /** Aired regular episodes with no events. */
  remaining: number;
  /** Events that match no cached episode (kept for History, ignored for progress). */
  orphanCount: number;
  /** Every event for the title, matched or not. For movies this is the watch count. */
  eventCount: number;
};

/** A rewatch pass (LIB-293), derived purely from watch counts. See `rewatchProgress`. */
export type RewatchProgress = {
  /** 1 for the first rewatch, 2 for the second, and so on. */
  number: number;
  /** Episodes in the pass, in season/episode order. */
  episodes: Episode[];
  /** The first episode not yet watched in this pass. */
  next: Episode | null;
  /** Episodes already watched in this pass. */
  watchedCount: number;
  remaining: number;
};

/** Season 0 holds specials, which never count toward progress. */
export const isSpecial = (episode: Episode) => episode.season === 0;

export const byEpisodeOrder = (a: Episode, b: Episode) => a.season - b.season || a.number - b.number;

export const titleEpisodes = (title: Title): Episode[] => title.episodes?.seasons.flatMap((s) => s.episodes) ?? [];

/** Matches events to episodes: TMDB episode id first, then season/episode for events without an id. */
export function episodeMatcher(episodes: Episode[]): (event: EventRef) => Episode | undefined {
  const byId = new Map(episodes.map((e) => [e.tmdbId, e]));
  const byNumber = new Map(episodes.map((e) => [`${e.season}:${e.number}`, e]));
  return (event) => {
    if (event.tmdbEpisodeId != null) return byId.get(event.tmdbEpisodeId);
    if (event.season == null || event.episode == null) return undefined;
    return byNumber.get(`${event.season}:${event.episode}`);
  };
}

export function computeProgress(episodes: Episode[], events: EventRef[], today: string): Progress {
  const match = episodeMatcher(episodes);
  const watchCounts = new Map<number, number>();
  let orphanCount = 0;
  for (const event of events) {
    const episode = match(event);
    if (episode) watchCounts.set(episode.tmdbId, (watchCounts.get(episode.tmdbId) ?? 0) + 1);
    else orphanCount++;
  }

  const airedRegular = episodes.filter((e) => !isSpecial(e) && isAired(e.airDate, today)).sort(byEpisodeOrder);
  const unwatched = airedRegular.filter((e) => !watchCounts.get(e.tmdbId));
  return {
    watchCounts,
    airedRegular,
    watchedAiredRegularCount: airedRegular.length - unwatched.length,
    next: unwatched[0] ?? null,
    remaining: unwatched.length,
    orphanCount,
    eventCount: events.length,
  };
}

export const titleProgress = (title: Title, events: EventRef[], today: string) =>
  computeProgress(titleEpisodes(title), events, today);

export const watchCount = (progress: Progress, episode: Episode) => progress.watchCounts.get(episode.tmdbId) ?? 0;
export const isWatched = (progress: Progress, episode: Episode) => watchCount(progress, episode) > 0;
export const rewatchCount = (progress: Progress, episode: Episode) => Math.max(0, watchCount(progress, episode) - 1);
export const hasAiredRegular = (progress: Progress) => progress.airedRegular.length > 0;

/**
 * The current rewatch pass, or null when nothing aired is watched. The pass covers the aired
 * regular episodes watched at least once; with `n` the lowest watch count among them, the
 * current pass is rewatch #n and an episode is done in it once its count exceeds `n`. When
 * every episode is done, `n` rises: the pass is finished.
 */
export function rewatchProgress(progress: Progress): RewatchProgress | null {
  const episodes = progress.airedRegular.filter((e) => isWatched(progress, e));
  if (episodes.length === 0) return null;
  const lowest = Math.min(...episodes.map((e) => watchCount(progress, e)));
  const pending = episodes.filter((e) => watchCount(progress, e) === lowest);
  return {
    number: lowest,
    episodes,
    next: pending[0] ?? null,
    watchedCount: episodes.length - pending.length,
    remaining: pending.length,
  };
}
