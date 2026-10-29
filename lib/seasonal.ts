import { z } from "zod";
import { AnimeSeason } from "./anime-season";
import { toSearchItem, type Fetcher, type SearchItem } from "./quick-add";
import { tmdbFetch } from "./tmdb-client";

const discoverPage = z.object({
  page: z.number().int().positive(),
  total_pages: z.number().int().nonnegative(),
  results: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string().nullish(),
    first_air_date: z.string().nullish(),
    poster_path: z.string().nullish(),
    genre_ids: z.array(z.number()).nullish(),
    origin_country: z.array(z.string()).nullish(),
    original_language: z.string().nullish(),
  })),
});

export type SeasonalItem = SearchItem & { date: string };
export const MAX_SEASONAL_PAGES = 3;

export function discoverQuery(season: AnimeSeason, page: number) {
  return {
    "first_air_date.gte": season.firstDay,
    "first_air_date.lte": season.lastDay,
    with_genres: "16",
    with_origin_country: "JP",
    sort_by: "popularity.desc",
    page,
  };
}

/** Popular TV anime premieres, deduplicated and checked against our anime and season rules. */
export async function loadSeasonal(season: AnimeSeason, fetcher: Fetcher = tmdbFetch, maxPages = MAX_SEASONAL_PAGES): Promise<SeasonalItem[]> {
  const items: SeasonalItem[] = [];
  const seen = new Set<number>();
  let page = 1;
  let totalPages = 1;
  do {
    const response = discoverPage.parse(await fetcher<unknown>("discover/tv", discoverQuery(season, page)));
    totalPages = response.total_pages;
    for (const result of response.results) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      const item = toSearchItem(result, "show");
      if (item.isAnime && result.first_air_date && season.contains(result.first_air_date)) items.push({ ...item, date: result.first_air_date });
    }
    page++;
  } while (page <= Math.min(totalPages, maxPages));
  return items;
}
