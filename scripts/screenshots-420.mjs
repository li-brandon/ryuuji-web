// BASE_URL=http://localhost:3000 node scripts/screenshots-420.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/420";
const fixture = (name) => JSON.parse(readFileSync(new URL(`../test/fixtures/tmdb/${name}.json`, import.meta.url), "utf8"));
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
    await context.addInitScript((theme) => localStorage.setItem("ryuuji-theme", theme), colorScheme);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/session", (route) => route.fulfill({ json: { authenticated: true } }));
    await page.route("**/api/tmdb/**", (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/tmdb/", "");
      if (path === "watch/providers/regions") return route.fulfill({ json: fixture("watch-providers-regions") });
      if (path === "watch/providers/movie") return route.fulfill({ json: fixture("watch-providers-movie-US") });
      if (path === "watch/providers/tv") return route.fulfill({ json: fixture("watch-providers-tv-US") });
      throw new Error(`Unexpected TMDB request: ${path}`);
    });
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Backup & import" }).waitFor();
    await shot(page, `settings-${width}-${colorScheme}`, width === 375);
    await page.locator('input[type="file"]').setInputFiles(new URL("../test/fixtures/macos-library-export.json", import.meta.url).pathname);
    await page.getByRole("heading", { name: "Import preview" }).waitFor();
    await page.getByText("3 titles to add", { exact: false }).waitFor();
    await shot(page, `preview-${width}-${colorScheme}`, width === 375);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
