import { describe, expect, it } from "vitest";
import movie from "../test/fixtures/tmdb/movie-27205.json";
import breakingBad from "../test/fixtures/tmdb/tv-1396.json";
import breakingBadSeason1 from "../test/fixtures/tmdb/tv-1396-season-1.json";
import frieren from "../test/fixtures/tmdb/tv-209867.json";
import { applyMovie, applyShow, episodeMetadata, isAnime, showStatus, type TMDBSeason } from "./title-mapper";
import { SHOW_STATUSES, type Title } from "./types";

function title(overrides: Partial<Title> = {}): Title {
  return {
    tmdbId: 0,
    kind: "show",
    name: "",
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
    score: 7,
    notes: "keep me",
    addedAt: "2026-10-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyMovie", () => {
  it("maps movie details and keeps library fields", () => {
    const mapped = applyMovie(movie, title({ tmdbId: 27205, kind: "movie" }));
    expect(mapped).toMatchObject({
      name: "Inception",
      originalName: "Inception",
      posterPath: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
      releaseDate: "2010-07-15",
      runtime: 148,
      genres: ["Action", "Science Fiction", "Adventure"],
      originCountries: ["US"],
      originalLanguage: "en",
      isAnime: false,
      score: 7,
      notes: "keep me",
    });
  });

  it("falls back to production countries and empty strings", () => {
    const mapped = applyMovie(
      { ...movie, origin_country: [], original_title: null, overview: null, release_date: "" },
      title({ kind: "movie" }),
    );
    expect(mapped).toMatchObject({ originCountries: ["GB", "US"], originalName: "Inception", overview: "", releaseDate: null });
  });
});

describe("applyShow", () => {
  it("maps show details and seasons, bumping the revision", () => {
    const mapped = applyShow(breakingBad, [breakingBadSeason1], title({ tmdbId: 1396, metadataRevision: 2 }));
    expect(mapped).toMatchObject({
      name: "Breaking Bad",
      releaseDate: "2008-01-20",
      runtime: 45,
      genres: ["Drama", "Crime"],
      originCountries: ["US"],
      showStatus: "Ended",
      isAnime: false,
      metadataRevision: 3,
    });
    expect(mapped.episodes?.seasons[0]).toEqual({
      number: 1,
      name: "Season 1",
      episodes: [
        { tmdbId: 62085, season: 1, number: 1, name: "Pilot", airDate: "2008-01-20", runtime: 59 },
        { tmdbId: 62086, season: 1, number: 2, name: "Cat's in the Bag...", airDate: "2008-01-27", runtime: 49 },
      ],
    });
  });

  it("tags anime and maps unknown statuses", () => {
    const mapped = applyShow({ ...frieren, status: "Something New" }, [], title({ tmdbId: 209867 }));
    expect(mapped).toMatchObject({
      originalName: "葬送のフリーレン",
      genres: ["Animation", "Action & Adventure", "Sci-Fi & Fantasy"],
      originCountries: ["JP"],
      originalLanguage: "ja",
      runtime: null,
      isAnime: true,
      showStatus: "Unknown",
      episodes: { schemaVersion: 1, seasons: [] },
    });
  });
});

describe("showStatus", () => {
  it("keeps the TMDB statuses the schema knows and maps the rest to Unknown, like macOS", () => {
    for (const status of SHOW_STATUSES) expect(showStatus(status)).toBe(status);
    for (const status of ["Something New", "", "ended", "Returning"]) expect(showStatus(status), status).toBe("Unknown");
    expect(showStatus(null)).toBeNull();
    expect(showStatus(undefined)).toBeNull();
    expect(applyShow({ ...breakingBad, status: null }, [], title()).showStatus).toBeNull();
  });
});

describe("episodeMetadata", () => {
  const season = (season_number: number): TMDBSeason => ({
    season_number,
    episodes: [{ id: season_number * 10, season_number, episode_number: 1 }],
  });

  it("sorts seasons by number, specials first, without mutating the input", () => {
    const input = [season(2), season(0), season(10), season(1)];
    const { seasons } = episodeMetadata(input);
    expect(seasons.map((s) => s.number)).toEqual([0, 1, 2, 10]);
    expect(seasons.map((s) => s.name)).toEqual(["Specials", "Season 1", "Season 2", "Season 10"]);
    expect(seasons[3].episodes[0]).toEqual({ tmdbId: 100, season: 10, number: 1, name: "Episode 1", airDate: null, runtime: null });
    expect(input.map((s) => s.season_number)).toEqual([2, 0, 10, 1]);
  });
});

describe("isAnime", () => {
  it("requires Animation plus Japanese origin or language", () => {
    expect(isAnime([16, 10759], ["JP"], "ja")).toBe(true);
    expect(isAnime([16], [], "ja")).toBe(true);
    expect(isAnime([16], ["US"], "en")).toBe(false);
    expect(isAnime([18], ["JP"], "ja")).toBe(false);
  });
});
