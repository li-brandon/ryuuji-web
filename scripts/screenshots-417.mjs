// Use an already-running server: BASE_URL=http://localhost:3000 node scripts/screenshots-417.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/417";
const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/tmdb/discover-tv-anime-2025-fall.json", import.meta.url), "utf8"));
const quarters = ["winter", "spring", "summer", "fall"];
const names = ["Winter", "Spring", "Summer", "Fall"];
const now = new Date();
const year = now.getFullYear();
const quarter = Math.floor(now.getMonth() / 3);
const currentSlug = `${quarters[quarter]}-${year}`;
const previousQuarter = (quarter + 3) % 4;
const previousYear = quarter === 0 ? year - 1 : year;
const previousLabel = `${names[previousQuarter]} ${previousYear}`;
const resultsFor = (start) => fixture.results.map((item, index) => ({ ...item, first_air_date: `${start.slice(0, 7)}-${String(index + 1).padStart(2, "0")}` }));
const currentResults = resultsFor(`${year}-${String(quarter * 3 + 1).padStart(2, "0")}-01`);
const saved = currentResults[0];
const added = currentResults[1];
const seededTitle = {
  tmdbId: saved.id, kind: "show", name: saved.name, originalName: saved.original_name ?? saved.name,
  overview: saved.overview ?? "", posterPath: saved.poster_path, releaseDate: saved.first_air_date,
  genres: ["Animation"], originCountries: ["JP"], originalLanguage: "ja", runtime: 24,
  isAnime: true, showStatus: "Returning Series", episodes: { schemaVersion: 1, seasons: [] },
  metadataRevision: 1, lastRefreshedAt: null, providerData: null, status: "watching", score: null,
  notes: "", addedAt: "2026-01-01T00:00:00Z",
};

async function seed(page) {
  await page.evaluate(async (title) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ryuuji", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["titles", "watchEvents"], "readwrite");
      tx.objectStore("titles").clear();
      tx.objectStore("watchEvents").clear();
      tx.objectStore("titles").put(title);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, seededTitle);
  await page.reload({ waitUntil: "networkidle" });
}
async function assertTapTargets(page) {
  for (const target of await page.locator('main a, main button').all()) {
    if (!await target.isVisible()) continue;
    const box = await target.boundingBox();
    assert(box && box.width >= 44 && box.height >= 44, `${await target.innerText()}: ${JSON.stringify(box)}`);
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no phone horizontal overflow");
}
async function shot(page, name, phone) {
  if (phone) await assertTapTargets(page);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [375, 1280]) {
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
      await context.addInitScript((theme) => localStorage.setItem("ryuuji-theme", theme), colorScheme);
      const page = await context.newPage();
      let mode = "loaded";
      const calls = [];
      await page.route("**/api/session", (route) => route.fulfill({ json: { authenticated: true } }));
      await page.route("**/api/tmdb/**", async (route) => {
        const url = new URL(route.request().url());
        calls.push(url.pathname);
        if (url.pathname.endsWith("/discover/tv")) {
          if (mode === "error") return route.fulfill({ status: 503, json: { error: "Fixture service unavailable" } });
          return route.fulfill({ json: { page: 1, total_pages: 1, results: mode === "empty" ? [] : resultsFor(url.searchParams.get("first_air_date.gte")) } });
        }
        if (url.pathname === `/api/tmdb/tv/${added.id}`) {
          return route.fulfill({ json: { ...added, genres: [{ id: 16, name: "Animation" }], seasons: [], status: "Returning Series", episode_run_time: [24] } });
        }
        throw new Error(`Unexpected TMDB call: ${url}`);
      });
      // Deterministic artwork, including in offline runs. No requests leave for TMDB images.
      await page.route("https://image.tmdb.org/**", (route) => {
        const index = Math.max(0, fixture.results.findIndex((item) => route.request().url().endsWith(item.poster_path)));
        const hue = (index * 47 + 210) % 360;
        return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue},45%,25%)"/><stop offset="1" stop-color="hsl(${hue + 50},50%,55%)"/></linearGradient></defs><path fill="url(#g)" d="M0 0h342v513H0z"/><circle cx="240" cy="140" r="90" fill="white" opacity=".15"/><path d="M0 410 150 210 342 513H0" fill="white" opacity=".12"/></svg>` });
      });
      const tag = `${width}-${colorScheme}`;
      await page.goto(`${base}/seasonal`, { waitUntil: "networkidle" });
      await page.getByRole("list", { name: `${names[quarter]} ${year} premieres` }).waitFor();
      await seed(page);
      await page.getByRole("link", { name: `${saved.name}: In library, open title`, exact: true }).waitFor();
      await page.getByText("Watching", { exact: true }).waitFor();
      await shot(page, `default-${tag}`, width === 375);

      await page.getByRole("link", { name: `Previous season: ${previousLabel}`, exact: true }).click();
      await page.getByRole("list", { name: `${previousLabel} premieres` }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("season"), `${quarters[previousQuarter]}-${previousYear}`);
      await shot(page, `previous-${tag}`, width === 375);
      await page.getByRole("link", { name: "Current season", exact: true }).click();
      await page.getByRole("list", { name: `${names[quarter]} ${year} premieres` }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("season"), currentSlug);
      await page.getByRole("button", { name: `Add ${added.name} to library`, exact: true }).click();
      const marked = page.getByRole("link", { name: `${added.name}: In library, open title`, exact: true });
      await marked.waitFor();
      await marked.getByText("Plan to Watch", { exact: true }).waitFor();
      assert.equal(await marked.getAttribute("href"), `/title/show/${added.id}`);
      assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).count(), 0, "default add does not register a status undo");
      const stored = await page.evaluate(async (id) => {
        const db = await new Promise((resolve) => { const req = indexedDB.open("ryuuji", 1); req.onsuccess = () => resolve(req.result); });
        const title = await new Promise((resolve) => { const req = db.transaction("titles").objectStore("titles").get([id, "show"]); req.onsuccess = () => resolve(req.result); });
        db.close();
        return title;
      }, added.id);
      assert.equal(stored.status, "planToWatch");
      assert.equal(calls.filter((path) => path === `/api/tmdb/tv/${added.id}`).length, 1, "one-click add fetches once");
      await shot(page, `added-${tag}`, width === 375);

      mode = "empty";
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "No anime found" }).waitFor();
      await shot(page, `empty-${tag}`, width === 375);
      mode = "error";
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: `Couldn't load ${names[quarter]} ${year}` }).waitFor();
      await shot(page, `error-${tag}`, width === 375);
      mode = "loaded";
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByRole("list", { name: `${names[quarter]} ${year} premieres` }).waitFor();
      await context.close();
    }
  }
} finally { await browser.close(); }
