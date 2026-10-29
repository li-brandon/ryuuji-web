// Run against npm run dev: BASE_URL=http://localhost:3000 node scripts/screenshots-416.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/416";
mkdirSync(out, { recursive: true });

// Event times are relative to now so every stats range has data.
const DAY = 86_400_000;
const ago = (days, hour = 20) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, 15, 0, 0);
  if (d > new Date()) d.setTime(Date.now() - 60_000);
  return d.toISOString();
};

const NAMES = ["The Journey’s End", "It Didn’t Have to Be Magic", "Killing Magic", "Fern’s Birthday", "Phantoms of the Dead", "A Well-Earned Rest"];
const episode = (show, season, number, runtime = 24) => ({ tmdbId: show * 1000 + season * 100 + number, season, number, name: NAMES[number - 1] ?? `Episode ${number}`, airDate: "2025-01-0" + Math.min(number, 9), runtime });
const meta = (show, count, runtime) => ({ schemaVersion: 1, seasons: [{ number: 1, name: "Season 1", episodes: Array.from({ length: count }, (_, i) => episode(show, 1, i + 1, runtime)) }] });
const common = { originalName: "", overview: "", originCountries: ["JP"], originalLanguage: "ja", metadataRevision: 1, lastRefreshedAt: null, providerData: null, notes: "", addedAt: "2025-01-01T00:00:00Z" };
const titles = [
  { ...common, tmdbId: 1, kind: "show", name: "Frieren: Beyond Journey’s End", posterPath: "/416-1.jpg", releaseDate: "2023-09-29", genres: ["Animation", "Action & Adventure", "Drama"], runtime: 24, isAnime: true, showStatus: "Returning Series", episodes: meta(1, 6, 24), status: "watching", score: 10 },
  { ...common, tmdbId: 2, kind: "show", name: "Samurai Champloo", posterPath: "/416-2.jpg", releaseDate: "2004-05-20", genres: ["Animation", "Action & Adventure", "Comedy"], runtime: 24, isAnime: true, showStatus: "Ended", episodes: meta(2, 4, 24), status: "completed", score: 9 },
  { ...common, tmdbId: 3, kind: "show", name: "Severance", posterPath: "/416-3.jpg", releaseDate: "2022-02-17", genres: ["Drama", "Mystery", "Sci-Fi & Fantasy"], originCountries: ["US"], originalLanguage: "en", runtime: 50, isAnime: false, showStatus: "Ended", episodes: meta(3, 3, 55), status: "completed", score: 8 },
  { ...common, tmdbId: 4, kind: "movie", name: "Arrival", posterPath: "/416-4.jpg", releaseDate: "2016-11-10", genres: ["Drama", "Science Fiction", "Mystery"], originCountries: ["US"], originalLanguage: "en", runtime: 116, isAnime: false, showStatus: null, episodes: null, status: "completed", score: 8 },
  { ...common, tmdbId: 5, kind: "movie", name: "Spirited Away", posterPath: "/416-5.jpg", releaseDate: "2001-07-20", genres: ["Animation", "Family", "Fantasy"], runtime: 125, isAnime: true, showStatus: null, episodes: null, status: "completed", score: 10 },
  { ...common, tmdbId: 6, kind: "movie", name: "Dune: Part Two", posterPath: "/416-6.jpg", releaseDate: "2024-02-27", genres: ["Science Fiction", "Adventure"], originCountries: ["US"], originalLanguage: "en", runtime: 167, isAnime: false, showStatus: null, episodes: null, status: "planToWatch", score: null },
  { ...common, tmdbId: 7, kind: "show", name: "Mushishi", posterPath: "/416-7.jpg", releaseDate: "2005-10-23", genres: ["Animation", "Mystery"], runtime: 24, isAnime: true, showStatus: "Ended", episodes: meta(7, 4, 24), status: "onHold", score: 7 },
];
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const show = (tmdbId, number, watchedAt, batchId = null) => ({ uid: uid(), tmdbId, kind: "show", season: 1, episode: number, tmdbEpisodeId: tmdbId * 1000 + 100 + number, batchId, watchedAt });
const movie = (tmdbId, watchedAt) => ({ uid: uid(), tmdbId, kind: "movie", season: null, episode: null, tmdbEpisodeId: null, batchId: null, watchedAt });
const batch = "11111111-1111-4111-8111-111111111111";
const events = [
  show(1, 1, ago(0, 9)), show(1, 2, ago(0, 9)), show(1, 3, ago(1)),
  show(1, 1, ago(200)), // first watch long ago: today's S1E1 is a rewatch
  ...[1, 2, 3, 4].map((e) => show(2, e, ago(3, 21), batch)),
  show(2, 1, ago(2)), // rewatch
  show(3, 1, ago(40)), show(3, 2, ago(12)), show(3, 3, ago(5)),
  movie(4, ago(70)), movie(4, ago(6)), // rewatch
  movie(5, ago(150)),
  show(7, 1, ago(300)), show(7, 2, ago(299)),
];

async function seed(page, data) {
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
  }, data);
  await page.reload({ waitUntil: "networkidle" });
}
const readDB = (page) => page.evaluate(async () => {
  const db = await new Promise((resolve) => { const req = indexedDB.open("ryuuji", 1); req.onsuccess = () => resolve(req.result); });
  const all = (store) => new Promise((resolve) => { const req = db.transaction(store).objectStore(store).getAll(); req.onsuccess = () => resolve(req.result); });
  const result = { titles: await all("titles"), events: await all("watchEvents") };
  db.close();
  return result;
});
const statusOf = async (page, tmdbId, kind) => (await readDB(page)).titles.find((t) => t.tmdbId === tmdbId && t.kind === kind).status;
async function shot(page, name, fullPage = true) {
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), `${name}: horizontal scroll`);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage });
  console.log(`ok ${name}`);
}
/** Every visible control in main is at least 44px tall and wide on phones. */
async function assertTapTargets(page, name) {
  const small = await page.locator("main").evaluate((main) => [...main.querySelectorAll("button, a, summary, label:has(input)")]
    .filter((el) => el.checkVisibility())
    .map((el) => ({ el, box: el.getBoundingClientRect() }))
    .filter(({ el, box }) => {
      // A stretched link's hit area is its row.
      const hit = getComputedStyle(el, "::after").position === "absolute" ? el.closest("li").getBoundingClientRect() : box;
      return hit.height < 44 || hit.width < 44;
    })
    .map(({ el, box }) => `${el.tagName} "${el.textContent.trim().slice(0, 30)}" ${Math.round(box.width)}×${Math.round(box.height)}`));
  assert.deepEqual(small, [], `${name}: tap targets under 44px`);
}

const browser = await chromium.launch();
try {
  for (const width of [375, 1280]) {
    for (const colorScheme of ["light", "dark"]) {
      const tag = `${width}-${colorScheme}`;
      const phone = width === 375;
      const page = await browser.newPage({ viewport: { width, height: phone ? 812 : 800 }, colorScheme, isMobile: phone, hasTouch: phone });
      await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
        document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal { display: none; }" }));
      }));
      await page.route("https://image.tmdb.org/**", (route) => {
        const hue = (Number(route.request().url().match(/416-(\d)/)?.[1] ?? 0) * 47) % 360;
        return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="92" height="138"><rect width="92" height="138" fill="hsl(${hue} 35% 45%)"/><circle cx="46" cy="52" r="24" fill="hsl(${hue} 30% 75%)"/></svg>` });
      });
      await page.route("**/api/tmdb/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Not found"}' }));

      // Empty states
      await page.goto(`${base}/history`, { waitUntil: "networkidle" });
      await seed(page, { titles: [], events: [] });
      await page.getByText("No watches logged yet").waitFor();
      await shot(page, `history-empty-${tag}`, false);
      await page.goto(`${base}/stats`, { waitUntil: "networkidle" });
      await page.getByText("Stats need a few logs").waitFor();
      await shot(page, `stats-empty-${tag}`, false);

      // History: newest first, grouped by day, episode labels, movies by title only.
      await page.goto(`${base}/history`, { waitUntil: "networkidle" });
      await seed(page, { titles, events });
      const headings = page.getByRole("main").getByRole("heading", { level: 2 });
      await headings.first().waitFor();
      const days = await headings.allTextContents();
      assert.deepEqual(days.slice(0, 2), ["Today", "Yesterday"]);
      await page.getByRole("link", { name: "Frieren: Beyond Journey’s End" }).first().waitFor();
      await page.getByText("S1 · E2 — It Didn’t Have to Be Magic").first().waitFor();
      await page.getByText("Rewatch #1").first().waitFor();
      assert.equal(await page.getByRole("link", { name: "Arrival" }).count(), 2, "movie rows show the title");
      if (phone) await assertTapTargets(page, `history-${tag}`);
      await shot(page, `history-${tag}`);

      // Expand a bulk batch.
      await page.getByText("Season 1 · 4 episodes").click();
      await page.getByRole("link", { name: "S1 · E4 — Fern’s Birthday" }).waitFor();
      await page.getByText("Season 1 · 4 episodes").scrollIntoViewIfNeeded();
      await shot(page, `history-batch-${tag}`, false);
      await page.getByText("Season 1 · 4 episodes").click();

      // Deleting an event updates progress and status, with one Undo in the toast.
      assert.equal(await statusOf(page, 3, "show"), "completed");
      const before = (await readDB(page)).events.length;
      await page.getByRole("button", { name: "Delete watch of Severance S1 · E3" }).click();
      await page.getByText("Deleted Severance S1 · E3 · now Watching").waitFor();
      assert.equal((await readDB(page)).events.length, before - 1);
      assert.equal(await statusOf(page, 3, "show"), "watching");
      assert.equal(await page.getByRole("button", { name: "Delete watch of Severance S1 · E3" }).count(), 0);
      await shot(page, `history-delete-toast-${tag}`, false);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await page.getByText("Watch restored").waitFor();
      await page.getByRole("button", { name: "Delete watch of Severance S1 · E3" }).waitFor();
      assert.equal((await readDB(page)).events.length, before);
      assert.equal(await statusOf(page, 3, "show"), "completed");

      // Stats: segmented range control with accessible labels; every range and bucket size.
      await page.goto(`${base}/stats`, { waitUntil: "networkidle" });
      const range = page.getByRole("group", { name: "Date range" });
      await range.waitFor();
      for (const label of ["Last 4 Weeks", "Last 3 Months", "Last 12 Months", "All Time"]) {
        const box = await range.getByRole("radio", { name: label }).locator("xpath=ancestor::label").boundingBox();
        assert(box.height >= 44, `${label} segment is ${box.height}px tall`);
        await range.getByRole("radio", { name: label }).waitFor({ state: "attached" });
      }
      assert(await range.getByRole("radio", { name: "Last 3 Months" }).isChecked(), "defaults to 3 months");
      await page.getByRole("heading", { name: "Episodes & Movies Watched" }).waitFor();
      for (const heading of ["Hours Watched", "By Kind", "Anime vs. Other", "By Genre", "By List Status", "Score Distribution"]) {
        await page.getByRole("heading", { name: heading }).waitFor();
      }
      if (phone) await assertTapTargets(page, `stats-${tag}`);
      await shot(page, `stats-3m-week-${tag}`);

      await range.getByRole("radio", { name: "Last 4 Weeks" }).locator("xpath=ancestor::label").click();
      assert(await range.getByRole("radio", { name: "Last 4 Weeks" }).isChecked());
      // By List Status follows the range: only titles watched in it, every title for All Time.
      const statuses = page.getByRole("region", { name: "By List Status" });
      await statuses.getByText("Titles watched in this range.").waitFor();
      assert.equal(await statuses.getByRole("listitem").count(), 2, "4 weeks: Watching and Completed");
      assert.match(await statuses.getByRole("listitem").filter({ hasText: "Completed" }).innerText(), /\b3\b/);
      await shot(page, `stats-4w-week-${tag}`);
      await range.getByRole("radio", { name: "Last 12 Months" }).locator("xpath=ancestor::label").click();
      await page.getByRole("group", { name: "Group charts by" }).getByText("Month", { exact: true }).click();
      await shot(page, `stats-12m-month-${tag}`);
      await range.getByText("All Time", { exact: true }).click();
      await statuses.getByText("All titles in your library.").waitFor();
      assert.equal(await statuses.getByRole("listitem").count(), 4, "all time: every status in the library");
      assert.match(await statuses.getByRole("listitem").filter({ hasText: "Completed" }).innerText(), /\b4\b/);
      await shot(page, `stats-all-month-${tag}`);
      await page.close();
    }
  }
} finally { await browser.close(); }
