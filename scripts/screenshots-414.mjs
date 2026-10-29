// Run against npm run dev: BASE_URL=http://localhost:3000 node scripts/screenshots-414.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/414";
mkdirSync(out, { recursive: true });

const episode = (number, airDate = "2026-01-01") => ({ tmdbId: 1000 + number, season: 1, number, name: ["Journey’s End", "A Quiet Morning", "The Next Adventure"][number - 1], airDate, runtime: 24 });
const title = (tmdbId, name, status, episodes) => ({
  tmdbId, kind: "show", name, originalName: name, overview: "", posterPath: `/414-${tmdbId}.jpg`,
  releaseDate: "2026-01-01", genres: [], originCountries: [], originalLanguage: "ja", runtime: null,
  isAnime: true, showStatus: "Returning Series", episodes: { schemaVersion: 1, seasons: [{ number: 1, name: "Season 1", episodes }] },
  metadataRevision: 1, lastRefreshedAt: null, providerData: null, status, score: null, notes: "", addedAt: "2026-10-01T00:00:00Z",
});
const titles = [
  title(1, "Frieren", "watching", [episode(1), episode(2), episode(3)]),
  title(2, "Samurai Champloo", "rewatching", [episode(1), episode(2)]),
  title(3, "DAN DA DAN", "caughtUp", [episode(1), episode(2, "2026-11-06")]),
  title(4, "A Short Journey", "watching", [episode(1)]),
];
const event = (tmdbId, number, watchedAt) => ({ uid: crypto.randomUUID(), tmdbId, kind: "show", season: 1, episode: number, tmdbEpisodeId: 1000 + number, batchId: null, watchedAt });
titles.push(
  { ...title(5, "Spirited Away", "completed", []), kind: "movie", score: 10 },
  { ...title(6, "Arrival", "planToWatch", []), kind: "movie", isAnime: false },
  { ...title(7, "Severance", "onHold", [episode(1), episode(2)]), isAnime: false },
  { ...title(8, "The Long Road", "dropped", [episode(1)]), isAnime: false },
);
const events = [{ ...event(5, 1, "2026-10-26T12:00:00Z"), kind: "movie", season: null, episode: null, tmdbEpisodeId: null }, event(1, 1, "2026-10-29T12:00:00Z"), event(2, 1, "2026-10-28T12:00:00Z"), event(2, 2, "2026-10-28T12:00:00Z"), event(3, 1, "2026-10-27T12:00:00Z")];

async function seed(page, empty = false) {
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
  }, { titles: empty ? [] : titles, events: empty ? [] : events });
  await page.reload({ waitUntil: "networkidle" });
}
async function shot(page, name) {
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), `${name}: horizontal scroll`);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: !name.startsWith("library-scrolled-") });
  console.log(`ok ${name}`);
}
const browser = await chromium.launch();
try {
  for (const width of [375, 1280]) {
    for (const colorScheme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 800 }, colorScheme, isMobile: width === 375, hasTouch: width === 375 });
      await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
        document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal { display: none; }" }));
      }));
      await page.route("https://image.tmdb.org/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="92" height="138"><rect width="92" height="138" fill="#4f6d9a"/><circle cx="46" cy="52" r="24" fill="#a7bacd"/></svg>' }));
      await page.goto(`${base}/library`, { waitUntil: "networkidle" });
      await page.getByText("Your library is empty").waitFor();
      await seed(page);
      await page.getByRole("link", { name: "Frieren", exact: true }).waitFor();
      await page.getByText("1 of 3 episodes · Anime", { exact: true }).waitFor();
      await page.getByText("Movie", { exact: true }).waitFor();
      await page.getByText("Watched · Anime", { exact: true }).waitFor();
      const tag = `${width}-${colorScheme}`;
      await shot(page, `library-${tag}`);
      const region = page.getByRole("region", { name: "Library titles" });
      const filters = page.getByLabel("Library filters", { exact: true });
      const initialFilterBox = await filters.boundingBox();
      const initialRegionBox = await region.boundingBox();
      assert(initialRegionBox.y >= initialFilterBox.y + initialFilterBox.height - 1, "rows start below filters");
      if (width === 375) assert(initialFilterBox.height <= 110, "phone filters stay compact");
      else assert(await page.getByRole("group", { name: "Status", exact: true }).evaluate((el) => el.scrollWidth <= el.clientWidth), "desktop chips do not clip");
      await page.evaluate(() => window.scrollTo(0, 320));
      assert(await page.evaluate(() => window.scrollY > 0), "whole page scrolls");
      assert.equal(await region.evaluate((el) => el.scrollTop), 0, "list has no inner scroll");
      const filterBox = await page.getByLabel("Library filters", { exact: true }).boundingBox();
      assert.equal(Math.round(filterBox.y), width === 375 ? 56 : 0, "filters stick below app bar");
      assert(await page.getByRole("heading", { name: "Library", exact: true }).evaluate((el) => el.getBoundingClientRect().bottom < 0), "page heading scrolls away");
      assert(await region.locator("li").evaluateAll((rows, bottom) => rows.every((row) => {
        const box = row.getBoundingClientRect();
        if (box.bottom <= bottom) return true;
        const x = box.left + 20;
        return !row.contains(document.elementFromPoint(x, bottom - 2));
      }), filterBox.y + filterBox.height), "rows do not paint over filters");
      await shot(page, `library-scrolled-${tag}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole("button", { name: "Actions for Arrival", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      const currentStatus = page.getByRole("dialog").getByRole("button", { name: "Plan to Watch", exact: true });
      assert(await currentStatus.isDisabled(), "current status is disabled");
      assert.equal(await currentStatus.getAttribute("aria-current"), "true");
      assert((await currentStatus.textContent()).includes("✓"), "current status has a checkmark");
      await shot(page, `row-menu-${tag}`);
      await page.getByRole("button", { name: "Remove…", exact: true }).click();
      await shot(page, `remove-confirmation-${tag}`);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("link", { name: "Arrival", exact: true }).click();
      await page.getByRole("heading", { name: "Arrival", exact: true }).waitFor();
      assert.equal(await page.getByRole("region", { name: "Library titles" }).count(), 0);
      await shot(page, `title-${tag}`);
      await page.getByRole("link", { name: "Back to library" }).click();
      await page.getByRole("button", { name: "Actions for Frieren", exact: true }).click();
      await page.getByRole("button", { name: "Completed", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByText("3 of 3 episodes · Anime", { exact: true }).scrollIntoViewIfNeeded();
      await page.getByText("3 of 3 episodes · Anime", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Actions for Frieren", exact: true }).click();
      await page.getByRole("button", { name: "Remove…", exact: true }).click();
      await page.getByRole("button", { name: "Remove from library", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("link", { name: "Frieren", exact: true }).count(), 0);
      assert(await page.evaluate(async () => {
        const db = await new Promise((resolve) => { const req = indexedDB.open("ryuuji", 1); req.onsuccess = () => resolve(req.result); });
        const events = await new Promise((resolve) => { const req = db.transaction("watchEvents").objectStore("watchEvents").getAll(); req.onsuccess = () => resolve(req.result); });
        db.close(); return events.every((event) => event.tmdbId !== 1);
      }), "removal cascades events");
      await page.getByLabel("Kind", { exact: true }).selectOption("movie");
      await page.waitForFunction(() => new URLSearchParams(location.search).get("kind") === "movie");
      await page.getByLabel("Anime only").click();
      await page.waitForFunction(() => document.querySelector('input[type="checkbox"]').checked);
      await page.getByLabel("Sort", { exact: true }).selectOption("score");
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.getByLabel("Kind", { exact: true }).inputValue(), "movie");
      assert(await page.getByLabel("Anime only").isChecked());
      assert.equal(await page.getByLabel("Sort", { exact: true }).inputValue(), "score");
      await page.getByRole("button", { name: /^Watching / }).click();
      await page.getByText("No matching titles", { exact: true }).waitFor();
      await shot(page, `no-matches-${tag}`);
      await seed(page, true);
      await page.getByText("Your library is empty").waitFor();
      await shot(page, `empty-${tag}`);
      await page.getByRole("button", { name: "Add a title", exact: true }).click();
      await page.getByRole("combobox", { name: "Search movies and shows" }).waitFor();
      await page.close();
    }
  }
} finally { await browser.close(); }
