// Run against npm run dev: BASE_URL=http://localhost:3000 node scripts/screenshots-413.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/413";
mkdirSync(out, { recursive: true });

const episode = (number, airDate = "2026-01-01") => ({ tmdbId: 1000 + number, season: 1, number, name: ["Journey’s End", "A Quiet Morning", "The Next Adventure"][number - 1], airDate, runtime: 24 });
const title = (tmdbId, name, status, episodes) => ({
  tmdbId, kind: "show", name, originalName: name, overview: "", posterPath: `/413-${tmdbId}.jpg`,
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
const events = [event(1, 1, "2026-10-29T12:00:00Z"), event(2, 1, "2026-10-28T12:00:00Z"), event(2, 2, "2026-10-28T12:00:00Z"), event(3, 1, "2026-10-27T12:00:00Z")];

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
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  console.log(`ok ${name}`);
}
const browser = await chromium.launch();
try {
  for (const width of [375, 1280]) {
    for (const colorScheme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 800 }, colorScheme, isMobile: width === 375, hasTouch: width === 375 });
      await page.clock.install({ time: new Date("2026-11-01T12:00:00Z") });
      await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
        document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal { display: none; }" }));
      }));
      await page.route("https://image.tmdb.org/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="92" height="138"><rect width="92" height="138" fill="#4f6d9a"/><circle cx="46" cy="52" r="24" fill="#a7bacd"/></svg>' }));
      await page.goto(base, { waitUntil: "networkidle" });
      await page.getByText("Nothing up next yet").waitFor();
      await seed(page);
      await page.getByText("Next episode Fri, Nov 6").waitFor();
      const tag = `${width}-${colorScheme}`;
      await shot(page, `up-next-${tag}`);
      const log = page.getByRole("button", { name: "Log S1E2 of Frieren", exact: true });
      const box = await log.boundingBox();
      assert(box.width >= 44 && box.height >= 44, "44px log target");
      await log.click();
      await page.getByRole("button", { name: "Log S1E3 of Frieren", exact: true }).waitFor();
      await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
      await shot(page, `up-next-undo-${tag}`);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await log.waitFor();
      // Final episode changes status to Caught Up; keyboard undo must bring the row back.
      await page.getByRole("button", { name: "Log S1E1 of A Short Journey", exact: true }).click();
      await page.getByText("Logged S1E1 of A Short Journey", { exact: true }).waitFor();
      await page.keyboard.press("Control+z");
      await page.getByRole("button", { name: "Log S1E1 of A Short Journey", exact: true }).waitFor();
      // Undo in the search input belongs to the editor, not the watch log.
      await log.click();
      await page.getByRole("button", { name: "Log S1E3 of Frieren", exact: true }).waitFor();
      await page.keyboard.press("Control+k");
      const input = page.getByRole("combobox", { name: "Search movies and shows" });
      await input.waitFor();
      await input.press("Control+z");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Log S1E3 of Frieren", exact: true }).focus();
      assert(await page.getByRole("button", { name: "Log S1E3 of Frieren", exact: true }).isVisible());
      await page.keyboard.press("Meta+z");
      await log.waitFor();
      await seed(page, true);
      await page.getByText("Nothing up next yet").waitFor();
      await shot(page, `up-next-empty-${tag}`);
      await page.getByRole("button", { name: "Find something to watch" }).click();
      await input.waitFor();
      await page.close();
    }
  }
} finally { await browser.close(); }
