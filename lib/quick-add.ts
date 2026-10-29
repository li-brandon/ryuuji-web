import type { LibraryRepository } from "./storage";
import { DuplicateTitleError } from "./storage";
import { applyMovie, applyShow, isAnime, type TMDBMovie, type TMDBSeason, type TMDBShow } from "./title-mapper";
import { tmdbFetch } from "./tmdb-client";
import type { Kind, ListStatus, Title, TitleKey } from "./types";

// Ports the macOS app's SearchItem (TMDB/TitleMapper.swift), TMDBClient.search/show and
// Services/TitleAdder.swift for the quick-add panel.

export type Fetcher = typeof tmdbFetch;

/** A search result reduced to what the quick-add panel shows. */
export type SearchItem = TitleKey & {
  name: string;
  year: string | null;
  posterPath: string | null;
  isAnime: boolean;
};

type TMDBSearchResult = {
  id: number;
  title?: string | null;
  name?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  genre_ids?: number[] | null;
  origin_country?: string[] | null;
  original_language?: string | null;
  popularity?: number | null;
};

type TMDBPage = { results: TMDBSearchResult[] };

/** TMDB caps append_to_response at 20 sub-requests. */
export const SEASON_BATCH_SIZE = 20;

export const itemId = ({ kind, tmdbId }: TitleKey) => `${kind}-${tmdbId}`;

export function toSearchItem(result: TMDBSearchResult, kind: Kind): SearchItem {
  const date = (kind === "movie" ? result.release_date : result.first_air_date) || null;
  return {
    tmdbId: result.id,
    kind,
    name: (kind === "movie" ? result.title : result.name) ?? result.name ?? result.title ?? "Untitled",
    year: date?.slice(0, 4) ?? null,
    posterPath: result.poster_path ?? null,
    isAnime: isAnime(result.genre_ids ?? [], result.origin_country ?? [], result.original_language),
  };
}

/** Movies and shows matching `query`, most popular first (like TMDB's multi search). */
export async function searchTitles(query: string, fetcher: Fetcher = tmdbFetch): Promise<SearchItem[]> {
  const params = { query, include_adult: false, page: 1 };
  const [movies, shows] = await Promise.all([
    fetcher<TMDBPage>("search/movie", params),
    fetcher<TMDBPage>("search/tv", params),
  ]);
  return [
    ...movies.results.map((r) => ({ r, item: toSearchItem(r, "movie") })),
    ...shows.results.map((r) => ({ r, item: toSearchItem(r, "show") })),
  ]
    .sort((a, b) => (b.r.popularity ?? 0) - (a.r.popularity ?? 0))
    .map(({ item }) => item);
}

/** Fetches full metadata (and every season, for shows) and maps it onto a new `Title`. */
export async function fetchTitle(
  item: SearchItem,
  status: ListStatus,
  { fetcher = tmdbFetch, now = new Date() }: { fetcher?: Fetcher; now?: Date } = {},
): Promise<Title> {
  const stamp = now.toISOString();
  const blank: Title = {
    tmdbId: item.tmdbId,
    kind: item.kind,
    name: item.name,
    originalName: item.name,
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
    lastRefreshedAt: stamp,
    providerData: null,
    status,
    score: null,
    notes: "",
    addedAt: stamp,
  };
  if (item.kind === "movie") return applyMovie(await fetcher<TMDBMovie>(`movie/${item.tmdbId}`), blank);

  const show = await fetcher<TMDBShow & { seasons?: { season_number: number }[] | null }>(`tv/${item.tmdbId}`);
  const numbers = (show.seasons ?? []).map((s) => s.season_number);
  const seasons: TMDBSeason[] = [];
  for (let i = 0; i < numbers.length; i += SEASON_BATCH_SIZE) {
    const keys = numbers.slice(i, i + SEASON_BATCH_SIZE).map((n) => `season/${n}`);
    const appended = await fetcher<Record<string, TMDBSeason | undefined>>(`tv/${item.tmdbId}`, {
      append_to_response: keys.join(","),
    });
    seasons.push(...keys.flatMap((key) => appended[key] ?? []));
  }
  return applyShow(show, seasons, blank);
}

export type AddOutcome = { outcome: "added" | "existing"; title: Title };

/** Adds `item` with `status` unless it's already in the library. Throws without writing if TMDB fails. */
export async function addTitle(
  repo: Pick<LibraryRepository, "getTitle" | "createTitle">,
  item: SearchItem,
  status: ListStatus = "planToWatch",
  options?: { fetcher?: Fetcher; now?: Date },
): Promise<AddOutcome> {
  const existing = await repo.getTitle(item);
  if (existing) return { outcome: "existing", title: existing };

  const title = await fetchTitle(item, status, options);
  try {
    return { outcome: "added", title: await repo.createTitle(title) };
  } catch (error) {
    // Another add may have finished while we were fetching.
    const raced = error instanceof DuplicateTitleError && (await repo.getTitle(item));
    if (raced) return { outcome: "existing", title: raced };
    throw error;
  }
}

/** The next selected index after an arrow key, clamped to the list. -1 when empty. */
export function moveSelection(current: number, delta: number, count: number): number {
  if (count === 0) return -1;
  return Math.min(Math.max(current + delta, 0), count - 1);
}

/** Cmd-K on macOS, Ctrl-K elsewhere. */
export const isQuickAddShortcut = (e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";

export const posterUrl = (path: string | null, size = "w92") => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);
