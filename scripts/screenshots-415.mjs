// Run against npm run dev: BASE_URL=http://localhost:3000 node scripts/screenshots-415.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/415";
mkdirSync(out, { recursive: true });

const NAMES = ["The Journey’s End", "It Didn’t Have to Be Magic", "Killing Magic", "Fern’s Birthday", "Phantoms of the Dead"];
const episode = (season, number, airDate = "2026-01-0" + number) => ({ tmdbId: season * 100 + number, season, number, name: NAMES[number - 1] ?? `Episode ${number}`, airDate, runtime: 24 });
const seasons = [
  { number: 1, name: "Season 1", episodes: [1, 2, 3, 4, 5].map((n) => episode(1, n)) },
  { number: 2, name: "Season 2", episodes: [episode(2, 1, "2026-10-01"), episode(2, 2, "2027-01-10"), episode(2, 3, null)] },
  { number: 0, name: "Specials", episodes: [episode(0, 1, "2026-03-01")] },
];
const base415 = {
  originCountries: ["JP"], originalLanguage: "ja", runtime: 24, metadataRevision: 1, lastRefreshedAt: null, providerData: null,
  score: null, notes: "", addedAt: "2026-10-01T00:00:00Z",
};
const titles = [
  { ...base415, tmdbId: 1, kind: "show", name: "Frieren: Beyond Journey’s End", originalName: "葬送のフリーレン", posterPath: "/415-1.jpg", releaseDate: "2023-09-29",
    overview: "After the party of heroes defeated the Demon King, they restored peace to the land and returned to lives of solitude. Elf mage Frieren outlives her companions and sets out to understand people.",
    genres: ["Animation", "Action & Adventure", "Drama"], isAnime: true, showStatus: "Returning Series", episodes: { schemaVersion: 1, seasons }, status: "watching", score: 9, notes: "Watch with subtitles." },
  { ...base415, tmdbId: 2, kind: "show", name: "Samurai Champloo", originalName: "サムライチャンプルー", posterPath: "/415-2.jpg", releaseDate: "2004-05-20",
    overview: "Mugen and Jin, two very different swordsmen, are pulled along by Fuu on her search for the samurai who smells of sunflowers.",
    genres: ["Animation", "Action & Adventure"], isAnime: true, showStatus: "Ended", episodes: { schemaVersion: 1, seasons: [{ number: 1, name: "Season 1", episodes: [1, 2, 3].map((n) => episode(1, n)) }] }, status: "completed" },
  { ...base415, tmdbId: 3, kind: "movie", name: "Arrival", originalName: "Arrival", posterPath: "/415-3.jpg", releaseDate: "2016-11-10",
    overview: "Taking place after alien crafts land around the world, an expert linguist is recruited by the military to determine whether they come in peace or are a threat.",
    genres: ["Drama", "Science Fiction", "Mystery"], originCountries: ["US"], originalLanguage: "en", runtime: 116, isAnime: false, showStatus: null, episodes: null, status: "completed", score: 8 },
];
const event = (tmdbId, season, number, watchedAt = "2026-10-20T12:00:00Z") => ({ uid: crypto.randomUUID(), tmdbId, kind: "show", season, episode: number, tmdbEpisodeId: season * 100 + number, batchId: null, watchedAt });
const events = [
  event(1, 1, 1), event(1, 1, 2),
  event(2, 1, 1), event(2, 1, 2), event(2, 1, 3),
  { uid: crypto.randomUUID(), tmdbId: 3, kind: "movie", season: null, episode: null, tmdbEpisodeId: null, batchId: null, watchedAt: "2026-10-10T12:00:00Z" },
];

// /api/tmdb mock: refresh of show 1 (with a new episode title) and a search hitting show 1 and a new movie.
const tvSeason = (s) => ({ season_number: s.number, name: s.name, episodes: s.episodes.map((e) => ({ id: e.tmdbId, season_number: e.season, episode_number: e.number, name: e.number === 3 && e.season === 1 ? "Killing Magic (refreshed)" : e.name, air_date: e.airDate, runtime: 24 })) });
const tv1 = { id: 1, name: titles[0].name, original_name: titles[0].originalName, overview: titles[0].overview, poster_path: "/415-1.jpg", first_air_date: "2023-09-29", status: "Returning Series", genres: [{ id: 16, name: "Animation" }, { id: 10759, name: "Action & Adventure" }, { id: 18, name: "Drama" }], origin_country: ["JP"], original_language: "ja", episode_run_time: [24], seasons: seasons.map((s) => ({ season_number: s.number })) };
function tmdb(url) {
  const path = url.pathname.replace("/api/tmdb/", "");
  if (path === "tv/1") {
    const append = url.searchParams.get("append_to_response");
    if (!append) return tv1;
    return { ...tv1, ...Object.fromEntries(append.split(",").map((key) => [key, tvSeason(seasons.find((s) => `season/${s.number}` === key))])) };
  }
  if (path === "search/tv") return { results: [{ id: 1, name: titles[0].name, first_air_date: "2023-09-29", poster_path: "/415-1.jpg", genre_ids: [16], origin_country: ["JP"], original_language: "ja", popularity: 90 }] };
  if (path === "search/movie") return { results: [{ id: 129, title: "Spirited Away", release_date: "2001-07-20", poster_path: "/415-4.jpg", genre_ids: [16], origin_country: ["JP"], original_language: "ja", popularity: 80 }] };
  return null;
}

async function seed(page) {
  await page.evaluate(async ({ titles, events }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ryuuji", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["titles", "watchEvents"], "readwrite");
      tx.objectStore("titles").clear();
      tx.objectStore("watchEvents").clear();
      for (const title of titles) tx.objectStore("titles").put(title);
      for (const event of events) tx.objectStore("watchEvents").put(event);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { titles, events });
  await page.reload({ waitUntil: "networkidle" });
}
const eventCount = (page, tmdbId) => page.evaluate(async (tmdbId) => {
  const db = await new Promise((resolve) => { const req = indexedDB.open("ryuuji", 1); req.onsuccess = () => resolve(req.result); });
  const all = await new Promise((resolve) => { const req = db.transaction("watchEvents").objectStore("watchEvents").getAll(); req.onsuccess = () => resolve(req.result); });
  db.close();
  return all.filter((e) => e.tmdbId === tmdbId).length;
}, tmdbId);
async function shot(page, name, fullPage = true) {
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), `${name}: horizontal scroll`);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage });
  console.log(`ok ${name}`);
}

const browser = await chromium.launch();
try {
  for (const width of [375, 1280]) {
    for (const colorScheme of ["light", "dark"]) {
      const tag = `${width}-${colorScheme}`;
      const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 800 }, colorScheme, isMobile: width === 375, hasTouch: width === 375 });
      await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
        document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal { display: none; }" }));
      }));
      await page.route("https://image.tmdb.org/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="92" height="138"><rect width="92" height="138" fill="#4f6d9a"/><circle cx="46" cy="52" r="24" fill="#a7bacd"/></svg>' }));
      let tmdbFails = false;
      await page.route("**/api/tmdb/**", (route) => {
        if (tmdbFails) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TMDB_TOKEN is not set" }) });
        const body = tmdb(new URL(route.request().url()));
        return route.fulfill(body ? { contentType: "application/json", body: JSON.stringify(body) } : { status: 404, contentType: "application/json", body: '{"error":"Not found"}' });
      });

      // Show detail
      await page.goto(`${base}/title/show/1`, { waitUntil: "networkidle" });
      await page.getByText("Title removed").waitFor();
      await seed(page);
      const heading = page.getByRole("heading", { name: titles[0].name });
      await heading.waitFor();
      await page.getByText("2/6 episodes watched").waitFor();
      for (const text of ["2023 · Show · Returning Series", "Anime", "Animation, Action & Adventure, Drama"]) await page.getByText(text).first().waitFor();
      assert(await page.getByRole("checkbox", { name: /^Watched S2E2 / }).isDisabled(), "unaired episode is disabled");
      await shot(page, `show-top-${tag}`, false);
      await page.getByRole("button", { name: "Season 2" }).click();
      assert.equal(await page.getByRole("checkbox", { name: /^Watched S2E1 / }).count(), 0, "season collapses");
      await page.getByRole("button", { name: "Season 2" }).click();
      await page.getByRole("button", { name: "Season 1" }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 72));
      await shot(page, `show-checklist-${tag}`, false);

      // Status menu: allowed statuses only, current ticked and disabled.
      await page.getByRole("button", { name: /^Status: Watching/ }).click();
      const dialog = page.getByRole("dialog", { name: "Change status" });
      await dialog.waitFor();
      assert(await dialog.getByRole("button", { name: "Watching" }).isDisabled());
      assert.equal(await dialog.getByRole("button", { name: "Rewatching" }).count(), 0);
      await dialog.getByRole("button", { name: "Close" }).click();
      await dialog.waitFor({ state: "hidden" });

      // Toggle an episode: one log, Cmd/Ctrl-Z undoes it.
      await page.getByRole("checkbox", { name: /^Watched S1E3 / }).click();
      await page.getByText("3/6 episodes watched").waitFor();
      assert.equal(await eventCount(page, 1), 3);
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press("ControlOrMeta+z");
      await page.getByText("2/6 episodes watched").waitFor();

      // Bulk mark menu, then a season mark with its Undo toast.
      await page.getByRole("button", { name: "Mark watched…" }).click();
      await page.getByRole("dialog", { name: "Mark watched" }).waitFor();
      await shot(page, `bulk-menu-${tag}`, false);
      await page.getByRole("button", { name: "Season 1 (3 left)" }).click();
      await page.getByText("Marked Season 1 watched").waitFor();
      await page.getByText("5/6 episodes watched").waitFor();
      await shot(page, `bulk-undo-toast-${tag}`, false);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await page.getByText("2/6 episodes watched").waitFor();
      assert.equal(await eventCount(page, 1), 2, "undo removes the whole batch");

      // Mark up to an episode (across seasons).
      await page.getByRole("button", { name: "More for S2E1" }).click();
      await page.getByRole("button", { name: "Mark up to here" }).click();
      await page.getByText("6/6 episodes watched").waitFor();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await page.getByText("2/6 episodes watched").waitFor();

      // Notes and score save without undo.
      await page.getByLabel("Score").selectOption("7");
      await page.getByRole("textbox", { name: /Notes/ }).fill("Watch with subtitles. Season 2 is great.");
      await page.getByText("Saved", { exact: true }).waitFor();

      // Refresh: failure toast, then success keeps history and user fields.
      tmdbFails = true;
      await page.getByRole("button", { name: "Refresh" }).click();
      await page.getByText(/TMDB isn’t configured on this server/).waitFor();
      tmdbFails = false;
      await page.getByRole("button", { name: "Refresh" }).click();
      await page.getByText("Refreshed from TMDB").waitFor();
      await page.getByText("Killing Magic (refreshed)").waitFor();
      assert.equal(await eventCount(page, 1), 2);
      assert.equal(await page.getByLabel("Score").inputValue(), "7");
      assert.equal(await page.getByRole("textbox", { name: /Notes/ }).inputValue(), "Watch with subtitles. Season 2 is great.");

      // Rewatch
      await page.goto(`${base}/title/show/2`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Start rewatch" }).click();
      await page.getByText("Rewatch #1 · 0/3").waitFor();
      await page.getByRole("button", { name: "Log S1E1" }).click();
      await page.getByText("Rewatch #1 · 1/3").waitFor();
      assert.equal(await eventCount(page, 2), 4, "rewatch keeps earlier history");
      await shot(page, `rewatch-${tag}`);

      // Movie
      await page.goto(`${base}/title/movie/3`, { waitUntil: "networkidle" });
      await page.getByText("Watched once").waitFor();
      await page.getByRole("button", { name: "Log rewatch" }).click();
      await page.getByText("Watched 2 times").waitFor();
      await shot(page, `movie-${tag}`);

      // Quick add with status hints; picking a title in the library opens it.
      await page.getByRole("button", { name: "Search (⌘K)" }).click();
      await page.getByRole("combobox", { name: "Search movies and shows" }).fill("fri");
      await page.getByRole("option", { name: /Spirited Away/ }).waitFor();
      await page.getByRole("combobox", { name: "Search movies and shows" }).press("ArrowDown");
      const shortcuts = page.getByRole("group", { name: /^Add “Spirited Away” as/ });
      await shortcuts.waitFor();
      assert(await shortcuts.getByRole("button", { name: /Caught Up/ }).isDisabled(), "Caught Up is shows only");
      await shot(page, `quick-add-${tag}`, false);
      await page.getByRole("option", { name: /Frieren/ }).click();
      await page.waitForURL("**/title/show/1");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await heading.waitFor();
      await page.close();
    }
  }
} finally { await browser.close(); }
