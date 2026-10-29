// Layout proof for LIB-412: screenshots of the shell and quick-add panel with a mocked TMDB proxy.
// Not run in CI. Usage: start `npm run dev` (no env needed), then
//   BASE_URL=http://localhost:3000 node scripts/screenshots.mjs [outDir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "/workspace/ryuuji-shots/412";
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

const fixtures = {
  "search/movie": {
    results: [
      { id: 27205, title: "Inception", release_date: "2010-07-15", poster_path: "/inception.jpg", popularity: 80 },
      { id: 157336, title: "Interstellar: A Very Long Title That Has To Truncate Nicely", release_date: "2014-11-05", poster_path: null, popularity: 60 },
    ],
  },
  "search/tv": {
    results: [
      { id: 209867, name: "Frieren: Beyond Journey's End", first_air_date: "2023-09-29", poster_path: "/broken.jpg", genre_ids: [16], origin_country: ["JP"], popularity: 70 },
    ],
  },
  "movie/27205": {
    id: 27205,
    title: "Inception",
    original_title: "Inception",
    overview: "A thief who steals corporate secrets…",
    poster_path: "/inception.jpg",
    release_date: "2010-07-15",
    runtime: 148,
    genres: [{ id: 28, name: "Action" }],
    origin_country: ["US"],
    original_language: "en",
  },
};

const poster = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="92" height="138"><rect width="92" height="138" fill="${color}"/></svg>`;

/** Mocks the proxy and TMDB images. With `locked`, /api/tmdb is 401 until /api/session succeeds. */
async function mock(page, { locked = false } = {}) {
  let unlocked = !locked;
  // Hide the dev-mode indicator, which sits over the tab bar.
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () =>
      document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal { display: none; }" })),
    ),
  );
  await page.route("https://image.tmdb.org/**", (route) =>
    route.request().url().includes("broken")
      ? route.fulfill({ status: 404 })
      : route.fulfill({ contentType: "image/svg+xml", body: poster("#4f6d9a") }),
  );
  await page.route("**/api/session", (route) => {
    unlocked = true;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/api/tmdb/**", (route) => {
    if (!unlocked) return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
    const path = new URL(route.request().url()).pathname.replace("/api/tmdb/", "");
    return path in fixtures ? route.fulfill({ json: fixtures[path] }) : route.fulfill({ status: 404, json: { error: "Not found" } });
  });
}

async function assertNoHorizontalScroll(page, label) {
  const { scrollWidth, width } = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    width: window.innerWidth,
  }));
  if (scrollWidth > width) throw new Error(`${label}: horizontal scroll (scrollWidth ${scrollWidth} > ${width})`);
  console.log(`ok   ${label}: scrollWidth ${scrollWidth} <= ${width}`);
}

async function shot(page, name, { checkScroll = true } = {}) {
  if (checkScroll) await assertNoHorizontalScroll(page, name);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`saved ${name}.png`);
}

async function openSearch(page, query) {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByRole("combobox", { name: "Search movies and shows" });
  await input.waitFor();
  await input.fill(query);
  return input;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const phone = await browser.newPage({ viewport: PHONE, hasTouch: true, isMobile: true });
  await mock(phone);
  for (const [path, name] of [
    ["/", "up-next"],
    ["/library", "library"],
    ["/settings", "settings"],
  ]) {
    await phone.goto(BASE_URL + path, { waitUntil: "networkidle" });
    await phone.getByRole("heading", { level: 1 }).waitFor();
    await shot(phone, name);
  }

  // Search via the visible button (phones), then add the first result with Return.
  await phone.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await phone.getByRole("button", { name: /Search/ }).tap();
  const input = phone.getByRole("combobox");
  await input.fill("in");
  await phone.getByRole("option").first().waitFor();
  await phone.keyboard.press("ArrowDown");
  await phone.keyboard.press("ArrowUp");
  await input.press("Enter");
  await phone.getByRole("option", { name: /Inception/ }).getByText("Added").waitFor();
  await shot(phone, "search-results-added");

  // Escape closes the panel.
  await phone.keyboard.press("Escape");
  await phone.getByRole("dialog").waitFor({ state: "hidden" });

  const locked = await browser.newPage({ viewport: PHONE, hasTouch: true, isMobile: true });
  await mock(locked, { locked: true });
  await locked.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await locked.getByRole("heading", { level: 1 }).waitFor();
  await openSearch(locked, "frieren");
  await locked.getByLabel("Enter the passcode to search TMDB").waitFor();
  await shot(locked, "passcode-prompt");
  await locked.getByLabel("Enter the passcode to search TMDB").fill("hunter2");
  await locked.getByRole("button", { name: "Unlock" }).click();
  await locked.getByRole("option").first().waitFor();
  console.log("ok   passcode unlock retried the search");

  const desktop = await browser.newPage({ viewport: DESKTOP });
  await mock(desktop);
  await desktop.goto(BASE_URL + "/library", { waitUntil: "networkidle" });
  await desktop.getByRole("heading", { level: 1 }).waitFor();
  await openSearch(desktop, "in");
  await desktop.getByRole("option").first().waitFor();
  await shot(desktop, "desktop-search");
} finally {
  await browser.close();
}
