import type { Episode, EventRef } from "../lib/progress";
import type { EpisodeMetadata, ListStatus, ShowStatus, Title } from "../lib/types";

// Builders for domain test data; mirrors the macOS RyuujiTests/Support/Fixtures.swift.

export const today = "2026-06-15";
export const past = "2026-01-01";
export const future = "2026-12-31";

/** Unique, readable TMDB ids: season * 1000 + episode number. */
export function episode(season: number, number: number, airDate: string | null = past): Episode {
  return { tmdbId: season * 1000 + number, season, number, name: `Episode ${number}`, airDate, runtime: 24 };
}

/** A season of `count` episodes (aired by default). */
export function season(number: number, count: number, airDate: string | null = past): Episode[] {
  return Array.from({ length: count }, (_, i) => episode(number, i + 1, airDate));
}

export const event = (e: Episode): EventRef => ({ season: e.season, episode: e.number, tmdbEpisodeId: e.tmdbId });
export const movieEvent = (): EventRef => ({ season: null, episode: null, tmdbEpisodeId: null });

export function metadata(episodes: Episode[]): EpisodeMetadata {
  const numbers = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
  return {
    schemaVersion: 1,
    seasons: numbers.map((n) => ({
      number: n,
      name: n === 0 ? "Specials" : `Season ${n}`,
      episodes: episodes.filter((e) => e.season === n),
    })),
  };
}

let nextId = 1;

export function show(episodes: Episode[], status: ListStatus = "planToWatch", showStatus: ShowStatus = "Returning Series"): Title {
  return { ...baseTitle(), tmdbId: nextId++, kind: "show", name: "Show", status, showStatus, episodes: metadata(episodes) };
}

export function movie(): Title {
  return { ...baseTitle(), tmdbId: nextId++, kind: "movie", name: "Movie" };
}

function baseTitle(): Omit<Title, "tmdbId" | "kind" | "name"> {
  return {
    originalName: "",
    overview: "",
    posterPath: null,
    releaseDate: null,
    genres: [],
    originCountries: [],
    originalLanguage: "",
    runtime: null,
    isAnime: false,
    showStatus: null,
    episodes: null,
    metadataRevision: 0,
    lastRefreshedAt: null,
    providerData: null,
    status: "planToWatch",
    score: null,
    notes: "",
    addedAt: "2026-06-01T00:00:00.000Z",
  };
}
