// Layout proof: screenshots of the shell, quick-add panel and /components with a mocked TMDB proxy,
// at phone and desktop sizes in light and dark. Fails on horizontal scroll. Not run in CI.
// Usage: start `npm run dev` (no env needed), then
//   BASE_URL=http://localhost:3000 node scripts/screenshots.mjs [outDir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "/workspace/ryuuji-shots/423";
const VIEWPORTS = {
  375: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true },
  1280: { viewport: { width: 1280, height: 800 } },
};
const SCHEMES = ["light", "dark"];

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
  `<svg xmlns="http://www.w3.org/2000/svg" width="92" height="138"><defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#1b2433"/></linearGradient></defs><rect width="92" height="138" fill="url(#g)"/></svg>`;

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
}

async function shot(page, name, { fullPage = false } = {}) {
  await assertNoHorizontalScroll(page, name);
  // Let entrance transitions settle.
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log(`ok   ${name}.png (no horizontal scroll)`);
}

async function openSearch(page, query) {
  await page.getByRole("button", { name: /Search/ }).first().click();
  const input = page.getByRole("combobox", { name: "Search movies and shows" });
  await input.waitFor();
  await input.fill(query);
  return input;
}

async function newPage(browser, width, colorScheme, mockOptions) {
  const page = await browser.newPage({ ...VIEWPORTS[width], colorScheme });
  await mock(page, mockOptions);
  return page;
}

async function goto(page, path) {
  const response = await page.goto(BASE_URL + path, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  return response;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of Object.keys(VIEWPORTS)) {
    for (const scheme of SCHEMES) {
      const tag = `${width}-${scheme}`;
      const page = await newPage(browser, width, scheme);
      await goto(page, "/");
      await shot(page, `up-next-${tag}`);
      await goto(page, "/library");
      await shot(page, `library-${tag}`);

      // Search, move the selection, then add the first result with Return.
      const input = await openSearch(page, "in");
      await page.getByRole("option").first().waitFor();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await input.press("Enter");
      await page.getByRole("option", { name: /Inception/ }).getByText("Added").waitFor();
      await shot(page, `search-${tag}`);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });

      if ((await goto(page, "/components").catch(() => null))?.ok()) await shot(page, `components-${tag}`, { fullPage: true });
      await page.close();

      const locked = await newPage(browser, width, scheme, { locked: true });
      await goto(locked, "/");
      await openSearch(locked, "frieren");
      const passcode = locked.getByLabel("Enter the passcode to search TMDB");
      await passcode.waitFor();
      await shot(locked, `passcode-${tag}`);
      await passcode.fill("hunter2");
      await locked.getByRole("button", { name: "Unlock" }).click();
      await locked.getByRole("option").first().waitFor();
      await locked.close();
    }
  }
  console.log("ok   passcode unlock retried the search");
} finally {
  await browser.close();
}
