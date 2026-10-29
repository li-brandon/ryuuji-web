// Use an already-running server: BASE_URL=http://localhost:3000 node scripts/screenshots-421.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = "/workspace/ryuuji-shots/421";
const NOTICE = "This product uses the TMDB API but is not endorsed or certified by TMDB.";

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
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const tag = `${width}-${colorScheme}`;

    // Reach About the way a phone user would: Settings → About Ryuuji.
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "About Ryuuji" }).first().click();
    await page.waitForURL(`${base}/about`);
    await page.getByRole("heading", { level: 1, name: "Ryuuji" }).waitFor();
    await page.getByText(NOTICE, { exact: true }).waitFor();
    await page.getByRole("link", { name: "Streaming data by JustWatch" }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Visit themoviedb.org" }).getAttribute("href"), "https://www.themoviedb.org");

    // TMDB's logo must be less prominent than Ryuuji's branding.
    const logo = page.getByRole("img", { name: "The Movie Database (TMDB)" });
    await logo.waitFor();
    assert(await logo.evaluate((img) => img.complete && img.naturalWidth > 0), "TMDB logo loaded");
    const logoBox = await logo.boundingBox();
    const headingBox = await page.getByRole("heading", { level: 1 }).boundingBox();
    assert(logoBox.width <= 120 && logoBox.height < headingBox.height, `TMDB logo is smaller than the branding: ${JSON.stringify(logoBox)}`);

    if (width === 1280) assert(await page.locator(".sidebar-footer").getByRole("link", { name: "About Ryuuji" }).isVisible(), "sidebar links to About");
    await shot(page, `about-${tag}`, width === 375);
    assert.deepEqual(pageErrors, []);
    await context.close();
  }
} finally { await browser.close(); }
