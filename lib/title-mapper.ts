import { SHOW_STATUSES, type EpisodeMetadata, type ShowStatus, type Title } from "./types";

// Ports the macOS app's TMDB/TitleMapper.swift and Domain/AnimeClassifier.swift.
// TMDB v3 response shapes, reduced to the fields mapped here.

export type TMDBGenre = { id: number; name: string };

export type TMDBMovie = {
  id: number;
  title: string;
  original_title?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  release_date?: string | null;
  runtime?: number | null;
  genres: TMDBGenre[];
  origin_country?: string[] | null;
  production_countries?: { iso_3166_1: string }[] | null;
  original_language?: string | null;
};

export type TMDBShow = {
  id: number;
  name: string;
  original_name?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  first_air_date?: string | null;
  status?: string | null;
  genres: TMDBGenre[];
  origin_country?: string[] | null;
  original_language?: string | null;
  episode_run_time?: number[] | null;
};

export type TMDBSeason = {
  season_number: number;
  name?: string | null;
  episodes: {
    id: number;
    season_number: number;
    episode_number: number;
    name?: string | null;
    air_date?: string | null;
    runtime?: number | null;
  }[];
};

/** TMDB's genre id for Animation (same id for movies and TV). */
export const ANIMATION_GENRE_ID = 16;

/** Anime = Animation genre and (Japanese origin country or Japanese original language). */
export function isAnime(genreIds: number[], originCountries: string[], originalLanguage?: string | null) {
  if (!genreIds.includes(ANIMATION_GENRE_ID)) return false;
  return originCountries.includes("JP") || originalLanguage === "ja";
}

const nonEmpty = (s?: string | null) => (s ? s : null);

/** `origin_country` when present, else production countries. */
const movieCountries = (movie: TMDBMovie) =>
  movie.origin_country?.length ? movie.origin_country : (movie.production_countries ?? []).map((c) => c.iso_3166_1);

export function applyMovie(movie: TMDBMovie, title: Title): Title {
  const originCountries = movieCountries(movie);
  return {
    ...title,
    name: movie.title,
    originalName: movie.original_title ?? movie.title,
    overview: movie.overview ?? "",
    posterPath: movie.poster_path ?? null,
    releaseDate: nonEmpty(movie.release_date),
    runtime: movie.runtime ?? null,
    genres: movie.genres.map((g) => g.name),
    originCountries,
    originalLanguage: movie.original_language ?? "",
    isAnime: isAnime(movie.genres.map((g) => g.id), originCountries, movie.original_language),
  };
}

/**
 * TMDB's status string as a `ShowStatus`; unrecognized values become `Unknown`, matching the
 * macOS exporter's `ShowStatus(tmdb:)`, so exported files always hold a schema enum value.
 */
export const showStatus = (status?: string | null): ShowStatus | null =>
  status == null ? null : (SHOW_STATUSES as readonly string[]).includes(status) ? (status as ShowStatus) : "Unknown";

/** Applies show details and replaces the cached seasons, bumping `metadataRevision`. */
export function applyShow(show: TMDBShow, seasons: TMDBSeason[], title: Title): Title {
  const originCountries = show.origin_country ?? [];
  return {
    ...title,
    name: show.name,
    originalName: show.original_name ?? show.name,
    overview: show.overview ?? "",
    posterPath: show.poster_path ?? null,
    releaseDate: nonEmpty(show.first_air_date),
    runtime: show.episode_run_time?.[0] ?? null,
    genres: show.genres.map((g) => g.name),
    originCountries,
    originalLanguage: show.original_language ?? "",
    showStatus: showStatus(show.status),
    isAnime: isAnime(show.genres.map((g) => g.id), originCountries, show.original_language),
    episodes: episodeMetadata(seasons),
    metadataRevision: title.metadataRevision + 1,
  };
}

export function episodeMetadata(seasons: TMDBSeason[]): EpisodeMetadata {
  return {
    schemaVersion: 1,
    seasons: [...seasons]
      .sort((a, b) => a.season_number - b.season_number)
      .map((season) => ({
        number: season.season_number,
        name: season.name ?? (season.season_number === 0 ? "Specials" : `Season ${season.season_number}`),
        episodes: season.episodes.map((e) => ({
          tmdbId: e.id,
          season: e.season_number,
          number: e.episode_number,
          name: e.name ?? `Episode ${e.episode_number}`,
          airDate: nonEmpty(e.air_date),
          runtime: e.runtime ?? null,
        })),
      })),
  };
}
