// Use an already-running server: BASE_URL=http://localhost:3000 node scripts/screenshots-418.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/418";
const fixture = (name) => JSON.parse(readFileSync(new URL(`../test/fixtures/tmdb/${name}.json`, import.meta.url), "utf8"));
const providers = fixture("watch-providers-demo");
const catalogs = { movie: fixture("watch-providers-movie-US"), tv: fixture("watch-providers-tv-US") };
const regions = fixture("watch-providers-regions");
const metadata = fixture("tv-1396");
const season = fixture("tv-1396-season-1");
const movie = fixture("movie-27205");
const mapProvider = (raw) => ({ id: raw.provider_id, name: raw.provider_name, logoPath: raw.logo_path, displayPriority: raw.display_priority });
const providerData = {
  region: "US", fetchedAt: "2026-10-29T12:00:00Z", providers: providers.results.US.flatrate.map(mapProvider),
  rent: providers.results.US.rent.map(mapProvider), buy: providers.results.US.buy.map(mapProvider), link: providers.results.US.link,
};
const show = {
  tmdbId: 1396, kind: "show", name: metadata.name, originalName: metadata.original_name, overview: metadata.overview,
  posterPath: metadata.poster_path, releaseDate: metadata.first_air_date, genres: metadata.genres.map((g) => g.name),
  originCountries: metadata.origin_country, originalLanguage: metadata.original_language, runtime: 47, isAnime: false,
  showStatus: "Ended", episodes: { schemaVersion: 1, seasons: [{ number: 1, name: season.name, episodes: season.episodes.map((episode) => ({
    tmdbId: episode.id, season: episode.season_number, number: episode.episode_number, name: episode.name, airDate: episode.air_date, runtime: episode.runtime,
  })) }] }, metadataRevision: 1, lastRefreshedAt: null, providerData, status: "watching", score: 9, notes: "Watch with friends.", addedAt: "2026-01-01T00:00:00Z",
};
const titles = [show, { ...show, tmdbId: 27205, kind: "movie", name: movie.title, originalName: movie.original_title, overview: movie.overview,
  posterPath: movie.poster_path, episodes: null, showStatus: null, status: "planToWatch", score: null, notes: "", providerData: { ...providerData, providers: [], rent: [], buy: [], link: null } }];

async function seed(page) {
  await page.evaluate(async (seeded) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ryuuji", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("titles", { keyPath: ["tmdbId", "kind"] });
        db.createObjectStore("watchEvents", { keyPath: "uid" }).createIndex("byTitle", ["tmdbId", "kind"]);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["titles", "watchEvents"], "readwrite");
      tx.objectStore("titles").clear();
      tx.objectStore("watchEvents").clear();
      for (const title of seeded) tx.objectStore("titles").put(title);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, titles);
}
async function assertTapTargets(page) {
  for (const control of await page.locator('main a, main button, main select, main textarea, main input').all()) {
    if (!await control.isVisible()) continue;
    const type = await control.getAttribute("type");
    const target = type === "checkbox" || type === "radio" ? control.locator("xpath=ancestor::label[1]") : control;
    const box = await target.boundingBox();
    // Count a documented ::after hit-area extension (e.g. the theme toggle's 38px segment + 3px insets).
    const grow = await target.evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      if (after.content === "none" || after.position !== "absolute") return { x: 0, y: 0 };
      const px = (v) => Math.max(0, -(parseFloat(v) || 0));
      return { x: px(after.left) + px(after.right), y: px(after.top) + px(after.bottom) };
    });
    if (box) { box.width += grow.x; box.height += grow.y; }
    assert(box && box.width >= 44 && box.height >= 44, `Small target ${await target.innerText()}: ${JSON.stringify(box)}`);
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no phone horizontal overflow");
}
async function shot(page, name, phone) {
  const attribution = page.getByRole("link", { name: "Streaming data by JustWatch", exact: true });
  await attribution.scrollIntoViewIfNeeded();
  assert(await attribution.isVisible(), "JustWatch attribution visible on every page");
  assert.equal(await attribution.getAttribute("href"), "https://www.justwatch.com");
  if (phone) await assertTapTargets(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [375, 1280]) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
    await context.addInitScript((theme) => {
      localStorage.setItem("ryuuji-theme", theme);
      if (!localStorage.getItem("ryuuji-watch-preferences")) localStorage.setItem("ryuuji-watch-preferences", JSON.stringify({ region: "US", services: [8] }));
    }, colorScheme);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/api/session", (route) => route.fulfill({ json: { authenticated: true } }));
    await page.route("**/api/tmdb/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/tmdb/", "");
      if (path === "watch/providers/regions") return route.fulfill({ json: regions });
      if (path === "watch/providers/movie" || path === "watch/providers/tv") return route.fulfill({ json: catalogs[path.split("/")[2]] });
      if (/^(tv|movie)\/\d+\/watch\/providers$/.test(path)) return route.fulfill({ json: providers });
      throw new Error(`Unexpected mocked TMDB call: ${url}`);
    });
    await page.route("https://image.tmdb.org/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><path fill="#273850" d="M0 0h342v513H0z"/><circle cx="240" cy="140" r="90" fill="#7b9b99"/><path d="M0 410 150 210 342 513H0" fill="#456562"/></svg>' }));
    const tag = `${width}-${colorScheme}`;
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await seed(page);
    await page.getByRole("checkbox", { name: "Netflix", exact: true }).waitFor();
    assert(await page.getByRole("checkbox", { name: "Netflix", exact: true }).isChecked());
    assert.equal(await page.getByRole("combobox", { name: "Region", exact: true }).inputValue(), "US");
    // Exercise the accessible toggle and ensure preferences survive navigation/reload.
    await page.getByRole("checkbox", { name: "Netflix", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Netflix", exact: true }).check();
    await page.reload({ waitUntil: "networkidle" });
    assert(await page.getByRole("checkbox", { name: "Netflix", exact: true }).isChecked());
    await shot(page, `settings-${tag}`, width === 375);

    await page.goto(`${base}/title/show/1396`, { waitUntil: "networkidle" });
    const section = page.getByRole("region", { name: "Where to watch US", exact: true });
    await section.getByRole("heading", { name: "Stream", exact: true }).waitFor();
    await section.getByRole("heading", { name: "Rent", exact: true }).waitFor();
    await section.getByRole("heading", { name: "Buy", exact: true }).waitFor();
    assert.equal(await section.getByText("My service", { exact: true }).count(), 1);
    await shot(page, `detail-${tag}`, width === 375);

    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByLabel("On Netflix", { exact: true }).waitFor();
    await shot(page, `up-next-${tag}`, width === 375);
    await page.goto(`${base}/library`, { waitUntil: "networkidle" });
    await page.getByLabel("On Netflix", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("On Netflix", { exact: true }).count(), 1);
    await shot(page, `library-${tag}`, width === 375);
    assert.deepEqual(pageErrors, []);
    await context.close();
  }
} finally { await browser.close(); }
