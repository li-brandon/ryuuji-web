import { describe, expect, it } from "vitest";
import { dueTitles, FINISHED_STALE_INTERVAL, isDue } from "./refresh";

import { show } from "../test/fixtures/refresh";
const now = new Date("2026-10-29T12:00:00Z");
describe("macOS metadata selection", () => {
  it("always selects ongoing shows regardless of list status, never movies", () => {
    expect(isDue({ ...show, lastRefreshedAt: now.toISOString(), status: "dropped" }, now)).toBe(true);
    expect(isDue({ ...show, kind: "movie" }, now)).toBe(false);
  });
  it.each(["Ended", "Canceled"] as const)("refreshes %s shows at seven days or with missing cache", (showStatus) => {
    const ended = { ...show, showStatus, lastRefreshedAt: now.toISOString() };
    expect(isDue(ended, now)).toBe(false);
    expect(isDue({ ...ended, episodes: null }, now)).toBe(true);
    expect(isDue({ ...ended, lastRefreshedAt: null }, now)).toBe(true);
    expect(isDue(ended, new Date(now.getTime() + FINISHED_STALE_INTERVAL - 1))).toBe(false);
    expect(isDue(ended, new Date(now.getTime() + FINISHED_STALE_INTERVAL))).toBe(true);
  });
  it("waits a full seven days before refreshing a finished show", () => {
    const day = 24 * 60 * 60 * 1000;
    const ended = { ...show, showStatus: "Ended" as const, lastRefreshedAt: now.toISOString() };
    expect(isDue(ended, new Date(now.getTime() + 6 * day + 23 * 60 * 60 * 1000))).toBe(false);
    expect(isDue(ended, new Date(now.getTime() + 7 * day))).toBe(true);
    expect(dueTitles([ended, show], new Date(now.getTime() + 6 * day))).toEqual([show]);
  });
  it("preserves order without truncating the batch", () => {
    const titles = Array.from({ length: 12 }, (_, tmdbId) => ({ ...show, tmdbId }));
    expect(dueTitles(titles, now)).toEqual(titles);
  });
});
