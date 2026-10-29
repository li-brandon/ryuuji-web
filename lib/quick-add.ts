import { today as localToday } from "./air-date";
import { statusAfterRefresh } from "./status-engine";
import { DuplicateTitleError, TitleNotFoundError, type LibraryRepository } from "./storage";
import { applyMovie, applyShow, isAnime, type TMDBMovie, type TMDBSeason, type TMDBShow } from "./title-mapper";
import { tmdbFetch } from "./tmdb-client";
import type { Kind, ListStatus, Title, TitleKey } from "./types";
import type { UndoStack } from "./undo-stack";
import { allowedStatuses, InvalidStatusError, WatchLogService } from "./watch-log";

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
  return fetchMetadata(blank, fetcher);
}

/** Re-fetches `title`'s TMDB metadata (every season, for shows) and maps it onto a copy. */
export async function fetchMetadata(title: Title, fetcher: Fetcher = tmdbFetch): Promise<Title> {
  if (title.kind === "movie") return applyMovie(await fetcher<TMDBMovie>(`movie/${title.tmdbId}`), title);

  const show = await fetcher<TMDBShow & { seasons?: { season_number: number }[] | null }>(`tv/${title.tmdbId}`);
  const numbers = (show.seasons ?? []).map((s) => s.season_number);
  const seasons: TMDBSeason[] = [];
  for (let i = 0; i < numbers.length; i += SEASON_BATCH_SIZE) {
    const keys = numbers.slice(i, i + SEASON_BATCH_SIZE).map((n) => `season/${n}`);
    const appended = await fetcher<Record<string, TMDBSeason | undefined>>(`tv/${title.tmdbId}`, {
      append_to_response: keys.join(","),
    });
    seasons.push(...keys.flatMap((key) => appended[key] ?? []));
  }
  return applyShow(show, seasons, title);
}

/** What a refresh replaces; history, status and user fields stay. */
const METADATA_FIELDS = [
  "name", "originalName", "overview", "posterPath", "releaseDate", "genres", "originCountries",
  "originalLanguage", "runtime", "isAnime", "showStatus", "episodes",
] as const satisfies (keyof Title)[];

/**
 * Ports MetadataRefresher.refresh for one title: re-fetches metadata, keeps history and user
 * fields, bumps `metadataRevision` and applies the refresh status rule. Throws without writing
 * if TMDB fails.
 */
export async function refreshTitle(
  repo: LibraryRepository,
  key: TitleKey,
  { fetcher = tmdbFetch, now = new Date(), today = localToday() }: { fetcher?: Fetcher; now?: Date; today?: string } = {},
): Promise<Title> {
  const title = await repo.getTitle(key);
  if (!title) throw new TitleNotFoundError(key);
  const fetched = await fetchMetadata(title, fetcher);
  const metadata = {
    ...Object.fromEntries(METADATA_FIELDS.map((field) => [field, fetched[field]])),
    metadataRevision: title.metadataRevision + 1,
    lastRefreshedAt: now.toISOString(),
  };
  const status = statusAfterRefresh({ ...title, ...metadata }, await repo.listWatchEvents(key), today);
  // Only metadata and status: score and notes may have been edited while fetching.
  return repo.updateTitle(key, { ...metadata, status });
}

export type AddOutcome = { outcome: "added" | "existing"; title: Title };

/**
 * Adds `item` unless it's already in the library. Throws without writing if TMDB fails, and
 * `InvalidStatusError` (before fetching) for a status `allowedStatuses` doesn't offer. A
 * non-default status is then set through `WatchLogService.setStatus`, so it follows the same
 * rules as a manual change (Completed logs what's aired) and registers one undo step.
 */
export async function addTitle(
  repo: LibraryRepository,
  item: SearchItem,
  status: ListStatus = "planToWatch",
  { undo, watchLog = new WatchLogService(repo), ...options }: { fetcher?: Fetcher; now?: Date; undo?: UndoStack; watchLog?: WatchLogService } = {},
): Promise<AddOutcome> {
  if (!allowedStatuses(item.kind).includes(status)) throw new InvalidStatusError(item.kind, status);
  const existing = await repo.getTitle(item);
  if (existing) return { outcome: "existing", title: existing };

  const title = await fetchTitle(item, "planToWatch", options);
  let created: Title;
  try {
    created = await repo.createTitle(title);
  } catch (error) {
    // Another add may have finished while we were fetching.
    const raced = error instanceof DuplicateTitleError && (await repo.getTitle(item));
    if (raced) return { outcome: "existing", title: raced };
    throw error;
  }
  if (status === created.status) return { outcome: "added", title: created };
  await watchLog.setStatus(item, status, undo);
  return { outcome: "added", title: (await repo.getTitle(item)) ?? created };
}

/** Cmd/Ctrl-1 to 6 in the quick-add panel, as in the macOS QuickAddPanel (Swift's
 * `ListStatus.manualCases`): Plan to Watch, Watching, Caught Up, On Hold, Dropped, Completed. */
export const STATUS_SHORTCUTS: ListStatus[] = ["planToWatch", "watching", "caughtUp", "onHold", "dropped", "completed"];

/** The status a Cmd/Ctrl-digit picks for a result of `kind`, or null when the key isn't a
 * shortcut or that status isn't allowed for `kind` (Caught Up on a movie). */
export function shortcutStatus(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  kind: Kind,
): ListStatus | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || !/^[1-6]$/.test(e.key)) return null;
  const status = STATUS_SHORTCUTS[Number(e.key) - 1];
  return allowedStatuses(kind).includes(status) ? status : null;
}

export const titleHref = ({ kind, tmdbId }: TitleKey) => `/title/${kind}/${tmdbId}`;

/** Picking a result that's already in the library opens its detail page instead of adding. */
export const existingTitleHref = (item: TitleKey, inLibrary: ReadonlySet<string>) =>
  inLibrary.has(itemId(item)) ? titleHref(item) : null;

/** The next selected index after an arrow key, clamped to the list. -1 when empty. */
export function moveSelection(current: number, delta: number, count: number): number {
  if (count === 0) return -1;
  return Math.min(Math.max(current + delta, 0), count - 1);
}

/** Cmd-K on macOS, Ctrl-K elsewhere. */
export const isQuickAddShortcut = (e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";

export const posterUrl = (path: string | null, size = "w92") => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);
