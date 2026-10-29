// Post-deploy smoke test (see docs/deploy.md). Drives a fresh browser profile, so it never touches
// the library on your own devices, and uses one passcode attempt of the 10/minute login limit.
//
//   BASE_URL=https://<deployment> RYUUJI_SMOKE_PASSCODE=… npm run smoke
//
// Optional: RYUUJI_SMOKE_QUERY (default "Breaking Bad") must find a show with an aired S1E1.
// Needs `npx playwright install chromium`. The passcode is read at runtime and never printed.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL?.replace(/\/$/, "");
const passcode = process.env.RYUUJI_SMOKE_PASSCODE;
const query = process.env.RYUUJI_SMOKE_QUERY || "Breaking Bad";
if (!base || !passcode) {
  console.error("Set BASE_URL and RYUUJI_SMOKE_PASSCODE.");
  process.exit(2);
}

/** Error text with the passcode masked, in case a library echoes an input value. */
const redact = (text) => String(text).split(passcode).join("***");
const step = async (name, run) => {
  process.stdout.write(`- ${name} … `);
  await run();
  console.log("ok");
};

const browser = await chromium.launch({ headless: true });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await step("unauthenticated /api/tmdb is 401", async () => {
    const response = await context.request.get(`${base}/api/tmdb/configuration`);
    assert.equal(response.status(), 401);
  });

  await step("manifest is reachable", async () => {
    const response = await context.request.get(`${base}/manifest.webmanifest`);
    assert.equal(response.status(), 200);
    const manifest = await response.json();
    assert.equal(manifest.name, "Ryuuji");
    assert.equal(manifest.display, "standalone");
  });

  await step("log in from search", async () => {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Search (⌘K)" }).click();
    await page.getByRole("combobox", { name: "Search movies and shows" }).fill(query);
    const passcodeInput = page.getByLabel("Enter the passcode to search TMDB");
    await passcodeInput.fill(passcode);
    await page.getByRole("button", { name: "Unlock" }).click();
    await passcodeInput.waitFor({ state: "detached" });
  });

  let titleName;
  await step(`add a show found by "${query}"`, async () => {
    const result = page.getByRole("option").filter({ hasText: "Show" }).first();
    await result.waitFor();
    titleName = (await result.innerText()).split("\n")[0];
    await result.click();
    await page.getByText(/^Added “.+” to Plan to Watch\.$/).waitFor();
    // Picking it again opens the detail page.
    await result.click();
    await page.waitForURL(/\/title\/show\/\d+$/);
  });

  const firstEpisode = page.getByRole("checkbox", { name: /^Watched S1E1 / });
  await step("log an episode", async () => {
    await firstEpisode.check();
    // The toast appears once the watch event is written to IndexedDB.
    await page.getByText("Logged S1E1", { exact: true }).waitFor();
  });

  await step("data survives a reload", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await firstEpisode.waitFor();
    assert.equal(await firstEpisode.isChecked(), true, `S1E1 of ${titleName} is still logged`);
  });

  await step("service worker is registered", async () => {
    const scope = await page.evaluate(async () => {
      const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 15_000))]);
      return registration?.scope ?? null;
    });
    assert.equal(scope, `${new URL(base).origin}/`);
  });

  assert.deepEqual(pageErrors, [], "no uncaught page errors");
  await context.close();
  console.log("Smoke test passed.");
} catch (error) {
  failed = true;
  console.log("FAILED");
  console.error(redact(error?.stack ?? error));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
