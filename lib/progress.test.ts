import { describe, expect, it } from "vitest";
import { episode as e, event, future, movieEvent, past, season, today } from "../test/domain-fixtures";
import { isAired, today as todayString } from "./air-date";
import {
  computeProgress,
  hasAiredRegular,
  isWatched,
  rewatchCount,
  rewatchProgress,
  watchCount,
  type Episode,
  type EventRef,
} from "./progress";

// Ports RyuujiTests/Domain/ProgressTests.swift, RewatchProgressTests.swift and the AirDate cases of TypesTests.swift.

describe("air dates", () => {
  it("formats today in the given time zone", () => {
    // 2026-03-02 05:00 UTC is still March 1 in Los Angeles.
    const instant = new Date(1_772_427_600 * 1000);
    expect(todayString(instant, "America/Los_Angeles")).toBe("2026-03-01");
    expect(todayString(instant, "UTC")).toBe("2026-03-02");
  });

  it("treats an episode airing today as aired and a missing date as unaired", () => {
    expect(isAired(today, today)).toBe(true);
    expect(isAired(future, today)).toBe(false);
    expect(isAired(null, today)).toBe(false);
    expect(isAired("", today)).toBe(false);
  });
});

describe("computeProgress", () => {
  it("counts distinct episodes", () => {
    const episodes = season(1, 4);
    const progress = computeProgress(episodes, [event(episodes[0]), event(episodes[1]), event(episodes[1])], today);
    expect(progress.watchedAiredRegularCount).toBe(2);
    expect(progress.remaining).toBe(2);
    expect(progress.next).toEqual(episodes[2]);
  });

  it("fills gaps for the next episode", () => {
    const episodes = season(1, 3);
    const progress = computeProgress(episodes, [event(episodes[0]), event(episodes[2])], today);
    expect(progress.next).toEqual(episodes[1]);
  });

  it("crosses seasons for the next episode", () => {
    const episodes = [...season(2, 2), ...season(1, 2)];
    const progress = computeProgress(episodes, season(1, 2).map(event), today);
    expect(progress.next).toEqual(e(2, 1));
  });

  it("treats future episodes as unaired", () => {
    const episodes = [e(1, 1, past), e(1, 2, future)];
    const progress = computeProgress(episodes, [event(episodes[0])], today);
    expect(progress.next).toBeNull();
    expect(progress.remaining).toBe(0);
  });

  it("treats a missing air date as unaired", () => {
    const progress = computeProgress([e(1, 1, null)], [], today);
    expect(progress.next).toBeNull();
    expect(hasAiredRegular(progress)).toBe(false);
  });

  it("doesn't let unwatched specials block completion", () => {
    const regular = season(1, 2);
    const progress = computeProgress([...season(0, 3), ...regular], regular.map(event), today);
    expect(progress.remaining).toBe(0);
    expect(progress.next).toBeNull();
    expect(progress.airedRegular).toHaveLength(2);
  });

  it("counts watched specials for their own row only", () => {
    const special = e(0, 1);
    const progress = computeProgress([special], [event(special)], today);
    expect(isWatched(progress, special)).toBe(true);
    expect(progress.watchedAiredRegularCount).toBe(0);
  });

  it("counts rewatches as events minus one", () => {
    const episode = e(1, 1);
    const progress = computeProgress([episode], Array(3).fill(event(episode)), today);
    expect(watchCount(progress, episode)).toBe(3);
    expect(rewatchCount(progress, episode)).toBe(2);
  });

  it("matches events by TMDB id before numbers", () => {
    // TMDB renumbered: the episode with id 1013 now lives at S2E1.
    const renumbered: Episode = { tmdbId: 1013, season: 2, number: 1, name: "Moved", airDate: past, runtime: null };
    const progress = computeProgress([renumbered], [{ season: 1, episode: 13, tmdbEpisodeId: 1013 }], today);
    expect(isWatched(progress, renumbered)).toBe(true);
    expect(progress.orphanCount).toBe(0);
  });

  it("matches events without an id by numbers", () => {
    const episode = e(1, 2);
    const progress = computeProgress([episode], [{ season: 1, episode: 2, tmdbEpisodeId: null }], today);
    expect(isWatched(progress, episode)).toBe(true);
  });

  it("counts unmatched events as orphans", () => {
    const episode = e(1, 1);
    const progress = computeProgress([episode], [{ season: 1, episode: 9, tmdbEpisodeId: 99_999 }], today);
    expect(progress.orphanCount).toBe(1);
    expect(progress.eventCount).toBe(1);
    expect(isWatched(progress, episode)).toBe(false);
  });

  it("counts movie events", () => {
    expect(computeProgress([], [movieEvent(), movieEvent()], today).eventCount).toBe(2);
  });
});

describe("rewatchProgress", () => {
  const episodes = season(1, 3);

  function rewatch(counts: number[], eps: Episode[] = episodes) {
    const events: EventRef[] = eps.flatMap((ep, i) => Array<EventRef>(counts[i] ?? 0).fill(event(ep)));
    return rewatchProgress(computeProgress(eps, events, today));
  }

  it("has no rewatch when nothing is watched", () => {
    expect(rewatch([0, 0, 0])).toBeNull();
  });

  it("starts rewatch one for a freshly finished show", () => {
    expect(rewatch([1, 1, 1])).toMatchObject({ number: 1, next: episodes[0], watchedCount: 0, remaining: 3 });
  });

  it("points next at the first episode not yet watched this pass", () => {
    expect(rewatch([2, 1, 1])).toMatchObject({ number: 1, next: episodes[1], watchedCount: 1, remaining: 2 });
  });

  it("fills gaps in an out-of-order rewatch", () => {
    expect(rewatch([1, 2, 1])).toMatchObject({ next: episodes[0], watchedCount: 1 });
  });

  it("moves to the next number when a pass finishes", () => {
    expect(rewatch([2, 2, 2])).toMatchObject({ number: 2, next: episodes[0], watchedCount: 0 });
  });

  it("doesn't count extra watches twice", () => {
    expect(rewatch([4, 2, 2])).toMatchObject({ number: 2, next: episodes[1], watchedCount: 1 });
  });

  it("leaves never-watched episodes out of the pass", () => {
    expect(rewatch([1, 1, 0])).toMatchObject({ number: 1, episodes: episodes.slice(0, 2) });
  });

  it("ignores specials and unaired episodes", () => {
    const all = [e(0, 1), ...episodes, e(1, 4, future)];
    expect(rewatch([1, 2, 2, 2, 0], all)).toMatchObject({ number: 2, episodes, next: episodes[0] });
  });

  it("leaves per-episode rewatch counts unchanged", () => {
    const progress = computeProgress(episodes, [episodes[0], episodes[0], episodes[0], episodes[1]].map(event), today);
    expect(rewatchCount(progress, episodes[0])).toBe(2);
    expect(rewatchCount(progress, episodes[1])).toBe(0);
    expect(progress.remaining).toBe(1);
  });
});
