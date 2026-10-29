// Use an already-running server: BASE_URL=http://localhost:3000 node scripts/screenshots-419.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/419";
const fixture = (name) => JSON.parse(readFileSync(new URL(`../test/fixtures/tmdb/${name}.json`, import.meta.url), "utf8"));
const providers = fixture("watch-providers-demo");
const catalogs = { movie: fixture("watch-providers-movie-US"), tv: fixture("watch-providers-tv-US") };
const regions = fixture("watch-providers-regions");
const metadata = fixture("tv-1396");
const season = fixture("tv-1396-season-1");
const mapProvider = (raw) => ({ id: raw.provider_id, name: raw.provider_name, logoPath: raw.logo_path, displayPriority: raw.display_priority });
const providerData = {
  region: "US", fetchedAt: "2026-10-29T12:00:00Z", providers: providers.results.US.flatrate.map(mapProvider),
  rent: providers.results.US.rent.map(mapProvider), buy: providers.results.US.buy.map(mapProvider), link: providers.results.US.link,
};
const show = {
  tmdbId: 1396, kind: "show", name: metadata.name, originalName: metadata.original_name, overview: metadata.overview,
  posterPath: metadata.poster_path, releaseDate: metadata.first_air_date, genres: metadata.genres.map((g) => g.name),
  originCountries: metadata.origin_country, originalLanguage: metadata.original_language, runtime: 47, isAnime: false,
  showStatus: "Returning Series", episodes: { schemaVersion: 1, seasons: [{ number: 1, name: season.name, episodes: season.episodes.slice(0, 1).map((episode) => ({
    tmdbId: episode.id, season: episode.season_number, number: episode.episode_number, name: episode.name, airDate: episode.air_date, runtime: episode.runtime,
  })) }] }, metadataRevision: 1, lastRefreshedAt: null, providerData, status: "caughtUp", score: 9, notes: "Watch with friends.", addedAt: "2026-01-01T00:00:00Z",
};
const titles = [show];

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
      const episode = seeded[0].episodes.seasons[0].episodes[0];
      tx.objectStore("watchEvents").put({ uid: crypto.randomUUID(), tmdbId: 1396, kind: "show", watchedAt: "2026-01-01T00:00:00Z", season: 1, episode: 1, tmdbEpisodeId: episode.tmdbId, batchId: null });
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
    let releaseMetadata;
    const metadataGate = new Promise((resolve) => { releaseMetadata = resolve; });
    await page.route("**/api/tmdb/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/tmdb/", "");
      if (path === "tv/1396") {
        await metadataGate;
        return route.fulfill({ json: url.searchParams.has("append_to_response") ? { "season/1": season } : { ...metadata, status: "Returning Series", seasons: [{ season_number: 1 }] } });
      }
      if (path === "watch/providers/regions") return route.fulfill({ json: regions });
      if (path === "watch/providers/movie" || path === "watch/providers/tv") return route.fulfill({ json: catalogs[path.split("/")[2]] });
      if (/^(tv|movie)\/\d+\/watch\/providers$/.test(path)) return route.fulfill({ json: providers });
      throw new Error(`Unexpected mocked TMDB call: ${url}`);
    });
    await page.route("https://image.tmdb.org/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><path fill="#273850" d="M0 0h342v513H0z"/><circle cx="240" cy="140" r="90" fill="#7b9b99"/><path d="M0 410 150 210 342 513H0" fill="#456562"/></svg>' }));
    const tag = `${width}-${colorScheme}`;
    // Bootstrap the origin and seed before launching the scheduler against this library.
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await seed(page);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Up Next", exact: true }).waitFor();
    // The title starts caught up; release TMDB only after the view is open.
    const documentToken = await page.evaluate(() => { window.refreshDocumentToken = crypto.randomUUID(); return window.refreshDocumentToken; });
    releaseMetadata();
    await page.getByText("Watching", { exact: true }).first().waitFor();
    await page.waitForFunction(async () => {
      const db = await new Promise((resolve) => { const request = indexedDB.open("ryuuji", 1); request.onsuccess = () => resolve(request.result); });
      const title = await new Promise((resolve) => { const request = db.transaction("titles").objectStore("titles").get([1396, "show"]); request.onsuccess = () => resolve(request.result); });
      db.close();
      return title.status === "watching" && title.notes === "Watch with friends." && title.score === 9;
    });
    assert.equal(await page.evaluate(() => window.refreshDocumentToken), documentToken, "refresh updates the open view without reloading");
    await shot(page, `up-next-${tag}`, width === 375);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const metadataSection = page.getByRole("region", { name: "Metadata", exact: true });
    await metadataSection.getByRole("button", { name: "Refresh now" }).click();
    await metadataSection.getByText("Last refreshed just now", { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-labelledby="metadata-heading"] button').disabled);
    assert.match(await metadataSection.getByRole("status").innerText(), /Refreshed/);
    await shot(page, `settings-${tag}`, width === 375);
    assert.deepEqual(pageErrors, []);
    await context.close();
  }
} finally { await browser.close(); }
