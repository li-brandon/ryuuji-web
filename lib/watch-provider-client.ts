import type { LibraryRepository } from "./storage";
import { tmdbFetch } from "./tmdb-client";
import type { TitleKey } from "./types";
import { readWatchPreferences } from "./watch-preferences";
import { mapWatchProviders, watchResponseSchema } from "./watch-providers";

export async function fetchWatchProviders(key: TitleKey, region: string, fetcher = tmdbFetch, now = new Date()) {
  const response = watchResponseSchema.parse(await fetcher<unknown>(`${key.kind === "movie" ? "movie" : "tv"}/${key.tmdbId}/watch/providers`));
  return mapWatchProviders(response, region, now);
}

/** Only provider fields are merged; an offline fetch must never undo an add or user edit. */
export async function refreshWatchProviders(repo: LibraryRepository, key: TitleKey, region = readWatchPreferences().region, fetcher = tmdbFetch, now = new Date()) {
  const providerData = await fetchWatchProviders(key, region, fetcher, now);
  // A request for a previous region must not overwrite the newest region's cache.
  if (readWatchPreferences().region !== region) return;
  await repo.updateTitle(key, { providerData });
}
