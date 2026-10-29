import { describe, expect, it, vi } from "vitest";
import fixture from "../test/fixtures/tmdb/discover-tv-anime-2025-fall.json";
import { AnimeSeason } from "./anime-season";
import { type Fetcher } from "./quick-add";
import { discoverQuery, loadSeasonal } from "./seasonal";
import { TMDBRequestError } from "./tmdb-client";

const fall = new AnimeSeason(2025, "fall");
const result = (id: number, date: string, genres = [16], countries = ["JP"]) => ({ id, name: `Show ${id}`, first_air_date: date, genre_ids: genres, origin_country: countries, original_language: "ja" });
const page = (number: number, total: number, results: ReturnType<typeof result>[]) => ({ page: number, total_pages: total, results });
function mockFetcher(pages: Record<number, unknown>) {
  const request = vi.fn(async (_path: string, params: Record<string, string | number | boolean> = {}) => pages[Number(params.page)]);
  // Match the existing generic proxy signature at the mocked network boundary.
  return request as unknown as Fetcher & typeof request;
}

describe("SeasonalLoader (macOS port)", () => {
  it("discover fixture decodes", async () => {
    expect(fixture.page).toBe(1);
    expect(fixture.total_pages).toBeGreaterThanOrEqual(1);
    expect(fixture.results).toHaveLength(20);
    const items = await loadSeasonal(fall, mockFetcher({ 1: { ...fixture, total_pages: 1 } }));
    expect(items).toHaveLength(20);
    expect(items.every((item) => item.kind === "show" && item.isAnime)).toBe(true);
    expect(items.every((item) => fall.contains(item.date))).toBe(true);
    expect(items.every((item) => item.year === "2025")).toBe(true);
    expect(items.some((item) => item.posterPath !== null)).toBe(true);
    expect(items.every((item) => item.name && item.name !== "Untitled")).toBe(true);
  });
  it("discover query targets season", () => {
    expect(discoverQuery(fall, 2)).toEqual({ "first_air_date.gte": "2025-10-01", "first_air_date.lte": "2025-12-31", with_genres: "16", with_origin_country: "JP", sort_by: "popularity.desc", page: 2 });
  });
  it("loader uses fixture page", async () => {
    const fetcher = mockFetcher({ 1: { ...fixture, total_pages: 1 } });
    expect((await loadSeasonal(fall, fetcher)).map((item) => item.tmdbId)).toEqual(fixture.results.map((item) => item.id));
    expect(fetcher).toHaveBeenCalledWith("discover/tv", discoverQuery(fall, 1));
  });
  it("loader fetches up to max pages and dedupes", async () => {
    const fetcher = mockFetcher({ 1: page(1, 5, [result(1, "2025-10-01"), result(2, "2025-10-02")]), 2: page(2, 5, [result(2, "2025-10-02"), result(3, "2025-11-01")]), 3: page(3, 5, [result(4, "2025-12-31")]) });
    expect((await loadSeasonal(fall, fetcher)).map((item) => item.tmdbId)).toEqual([1, 2, 3, 4]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (let number = 1; number <= 3; number++) expect(fetcher).toHaveBeenNthCalledWith(number, "discover/tv", discoverQuery(fall, number));
  });
  it("loader stops at last page", async () => {
    const fetcher = mockFetcher({ 1: page(1, 1, [result(1, "2025-10-05")]) });
    await loadSeasonal(fall, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("loader drops non-anime and out-of-season results", async () => {
    const fetcher = mockFetcher({ 1: page(1, 1, [result(1, "2025-10-05"), result(2, "2025-10-05", [18]), result(3, "2025-09-30"), result(4, ""), { ...result(5, "2025-10-05", [16], ["US"]), original_language: "en" }]) });
    expect((await loadSeasonal(fall, fetcher)).map((item) => item.tmdbId)).toEqual([1]);
  });
  it("loader propagates failures", async () => {
    const error = new TMDBRequestError("Unavailable", 503);
    const fetcher: Fetcher = async () => { throw error; };
    await expect(loadSeasonal(fall, fetcher)).rejects.toBe(error);
  });
  it("supports a smaller page limit", async () => {
    const fetcher = mockFetcher({ 1: page(1, 5, [result(1, "2025-10-01")]) });
    await loadSeasonal(fall, fetcher, 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
