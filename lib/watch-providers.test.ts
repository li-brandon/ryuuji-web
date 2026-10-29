import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import showResponse from "../test/fixtures/tmdb/tv-120089-watch-providers.json";
import movieResponse from "../test/fixtures/tmdb/movie-372058-watch-providers.json";
import movieCatalog from "../test/fixtures/tmdb/watch-providers-movie-US.json";
import tvCatalog from "../test/fixtures/tmdb/watch-providers-tv-US.json";
import movieMetadata from "../test/fixtures/tmdb/movie-27205.json";
import { movie } from "../test/domain-fixtures";
import { addTitle, refreshTitle } from "./quick-add";
import { LibraryRepository, openLibraryDB } from "./storage";
import { titleSchema, watchProviderDataSchema, type WatchProviderData } from "./types";
import { fetchWatchProviders, refreshWatchProviders } from "./watch-provider-client";
import { loadProviderCatalog, saveProviderCatalog, parsePreferences, WATCH_PREFERENCES_KEY } from "./watch-preferences";
import { decodeServices, encodeServices, mapWatchProviders, mergeProviderCatalog, providerBadges, providerListSchema, watchLink, watchResponseSchema } from "./watch-providers";

const now = new Date("2026-05-28T20:26:40Z");
const show = watchResponseSchema.parse(showResponse);
const data = (ids: number[], region = "US"): WatchProviderData => ({ region, fetchedAt: now.toISOString(), link: null, rent: [], buy: [], providers: ids.map((id, displayPriority) => ({ id, name: `P${id}`, displayPriority, logoPath: null })) });
const badges = (cached: WatchProviderData | null, ids: number[], region = "US") => providerBadges(cached, region, new Set(ids));
let dbCount = 0;
const databases: Awaited<ReturnType<typeof openLibraryDB>>[] = [];
async function repository() {
  const db = await openLibraryDB(`watch-providers-${dbCount++}`);
  databases.push(db);
  return new LibraryRepository(db);
}
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
});
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.unstubAllGlobals(); });

describe("WatchProviderTests port", () => {
  it("show providers keep flatrate only in priority order, with separate buy options", () => {
    expect(show.id).toBe(120089);
    expect(Object.keys(show.results).sort()).toEqual(["GB", "JP", "US"]);
    const result = mapWatchProviders(show, "US", now);
    expect(result).toMatchObject({ region: "US", fetchedAt: now.toISOString() });
    expect(result.link).toContain("120089");
    expect(result.providers.length).toBeGreaterThan(0);
    expect(result.providers.map((p) => p.displayPriority)).toEqual(result.providers.map((p) => p.displayPriority).sort((a, b) => a - b));
    expect(result.providers.every((p) => p.logoPath !== null)).toBe(true);
    expect(result.providers.map((p) => p.name)).toContain("Crunchyroll");
    expect(result.providers.map((p) => p.name)).not.toContain("Amazon Video");
    expect(result.providers.map((p) => p.name)).not.toContain("Apple TV Store");
    expect(result.buy.map((p) => p.name)).toContain("Amazon Video");
  });
  it("movie providers decode for US and JP", () => {
    const response = watchResponseSchema.parse(movieResponse);
    expect(response.id).toBe(372058);
    expect(mapWatchProviders(response, "JP", now).providers.length).toBeGreaterThan(0);
    expect(mapWatchProviders(response, "US", now).providers.every((p) => p.name.length > 0)).toBe(true);
  });
  it("region without an entry has no providers or link", () => {
    expect(mapWatchProviders(show, "ZZ", now)).toEqual({ ...data([], "ZZ"), link: null });
  });
  it("cached data round trips on a title and old version 1 caches gain empty rent/buy", () => {
    const title = movie();
    expect(title.providerData).toBeNull();
    const providerData = mapWatchProviders(show, "GB", now);
    expect(titleSchema.parse(JSON.parse(JSON.stringify({ ...title, providerData }))).providerData).toEqual(providerData);
    const legacy = { region: providerData.region, fetchedAt: providerData.fetchedAt, providers: providerData.providers, link: providerData.link };
    expect(watchProviderDataSchema.parse(legacy)).toEqual({ ...legacy, rent: [], buy: [] });
  });
  it("catalog merges movie and TV lists by id, sorted by region priority", () => {
    const lists = [movieCatalog, tvCatalog].map((list) => providerListSchema.parse(list));
    const catalog = mergeProviderCatalog(lists, "US");
    const ids = catalog.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(lists.flatMap((list) => list.results.map((p) => p.provider_id))));
    expect(catalog[0].name).toBe("Netflix");
    expect(catalog.map((p) => p.displayPriority)).toEqual(catalog.map((p) => p.displayPriority).sort((a, b) => a - b));
  });
  it("catalog cache round trips separately by region", () => {
    expect(loadProviderCatalog("US")).toEqual([]);
    const catalog = data([8]).providers;
    saveProviderCatalog("US", catalog);
    expect(loadProviderCatalog("US")).toEqual(catalog);
    expect(loadProviderCatalog("GB")).toEqual([]);
  });
  it("badges show only my services", () => {
    expect(badges(data([8, 15]), [8])).toEqual({ shown: data([8]).providers, overflow: 0 });
  });
  it("no match shows nothing", () => {
    for (const cached of [data([15]), null, data([])]) expect(badges(cached, [8]).shown).toEqual([]);
  });
  it("empty my services shows nothing", () => { expect(badges(data([8, 15]), []).shown).toEqual([]); });
  it("other region data is hidden", () => { expect(badges(data([8]), [8], "GB").shown).toEqual([]); });
  it("at most five badges then overflow", () => {
    const ids = [1, 2, 3, 4, 5, 6];
    expect(badges(data(ids), ids)).toEqual({ shown: data(ids).providers.slice(0, 5), overflow: 1 });
  });
  it("my services storage format", () => {
    expect(decodeServices("")).toEqual(new Set());
    expect(decodeServices("8, 15,x,283")).toEqual(new Set([8, 15, 283]));
    expect(encodeServices(new Set([283, 8, 15]))).toBe("8,15,283");
  });
});

describe("web provider behavior", () => {
  it("does not match rent or buy services and sorts ties by name", () => {
    const cached = { ...data([8]), rent: data([15]).providers, buy: data([283]).providers };
    expect(badges(cached, [15, 283]).shown).toEqual([]);
    const tied = { ...data([2, 1]), providers: data([2, 1]).providers.map((p) => ({ ...p, displayPriority: 1 })) };
    expect(badges(tied, [1, 2]).shown.map((p) => p.id)).toEqual([1, 2]);
  });
  it("prefers lowest regional priority when catalog entries duplicate", () => {
    const raw = (priority: number) => providerListSchema.parse({ results: [{ provider_id: 8, provider_name: "Netflix", display_priority: 9, display_priorities: { US: priority } }] });
    expect(mergeProviderCatalog([raw(3), raw(1), raw(5)], "US")[0].displayPriority).toBe(1);
    expect(mergeProviderCatalog([raw(3)], "GB")[0].displayPriority).toBe(9);
  });
  it("parses preferences defensively and rejects unsafe links", () => {
    expect(parsePreferences("broken")).toEqual({ region: "US", services: [] });
    expect(parsePreferences('{"region":"us","services":[8]}')).toEqual({ region: "US", services: [] });
    expect(parsePreferences('{"region":"JP","services":[8]}')).toEqual({ region: "JP", services: [8] });
    expect(watchLink("javascript:alert(1)")).toBe("https://www.justwatch.com");
    expect(watchLink(show.results.US.link)).toBe(show.results.US.link);
  });
  it("switches region and refuses late results from a previous region", async () => {
    const repo = await repository();
    const title = await repo.createTitle(movie());
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(movieResponse)));
    const us = await fetchWatchProviders(title, "US");
    await repo.updateTitle(title, { providerData: us });
    localStorage.setItem(WATCH_PREFERENCES_KEY, JSON.stringify({ region: "JP", services: [8] }));
    expect(badges(us, [8], "JP").shown).toEqual([]);
    await refreshWatchProviders(repo, title, "JP");
    const jp = (await repo.getTitle(title))?.providerData;
    expect(jp?.region).toBe("JP");
    expect(jp?.providers.length).toBeGreaterThan(0);
    await refreshWatchProviders(repo, title, "US");
    expect((await repo.getTitle(title))?.providerData).toEqual(jp);
  });
  it("add triggers fetch without waiting, then merges cache preserving edits", async () => {
    const repo = await repository();
    let finish: (response: Response) => void = () => { throw new Error("Request not started"); };
    const fetch = vi.fn(async (url: string) => url.endsWith("watch/providers") ? new Promise<Response>((resolve) => { finish = resolve; }) : Response.json(movieMetadata));
    vi.stubGlobal("fetch", fetch);
    const item = { tmdbId: 27205, kind: "movie", name: "Inception", year: "2010", posterPath: null, isAnime: false } satisfies Parameters<typeof addTitle>[1];
    const result = await addTitle(repo, item);
    expect(result.outcome).toBe("added");
    expect(result.title.providerData).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url)).toContain("/api/tmdb/movie/27205/watch/providers");
    await repo.updateTitle(item, { notes: "typed after add", score: 8 });
    finish(Response.json(movieResponse));
    await vi.waitFor(async () => expect((await repo.getTitle(item))?.providerData?.region).toBe("US"));
    expect(await repo.getTitle(item)).toMatchObject({ notes: "typed after add", score: 8 });
    fetch.mockClear();
    expect((await addTitle(repo, item)).outcome).toBe("existing");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("provider failure is silent and does not undo an add", async () => {
    const repo = await repository();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("watch/providers") ? Response.json({ error: "offline" }, { status: 503 }) : Response.json(movieMetadata)));
    const item = { tmdbId: 27205, kind: "movie", name: "Inception", year: null, posterPath: null, isAnime: false } satisfies Parameters<typeof addTitle>[1];
    expect((await addTitle(repo, item)).outcome).toBe("added");
    expect(await repo.listTitles()).toHaveLength(1);
    expect((await repo.getTitle(item))?.providerData).toBeNull();
  });
  it("refresh fetches providers and keeps notes/score changed while fetching", async () => {
    const repo = await repository();
    const title = await repo.createTitle({ ...movie(), tmdbId: 27205, notes: "before", score: 5 });
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("watch/providers")) {
        await repo.updateTitle(title, { notes: "edited during refresh", score: 9 });
        return Response.json(movieResponse);
      }
      return Response.json(movieMetadata);
    });
    vi.stubGlobal("fetch", fetch);
    const refreshed = await refreshTitle(repo, title, { now });
    expect(refreshed).toMatchObject({ notes: "edited during refresh", score: 9, providerData: { region: "US", fetchedAt: now.toISOString() } });
    const before = refreshed.providerData;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("watch/providers") ? Response.json({}, { status: 503 }) : Response.json(movieMetadata)));
    expect((await refreshTitle(repo, title)).providerData).toEqual(before);
  });
});
