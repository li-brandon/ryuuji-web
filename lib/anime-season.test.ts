import { describe, expect, it } from "vitest";
import { AnimeSeason, type Quarter } from "./anime-season";

describe("AnimeSeason (macOS port)", () => {
  it("current season follows calendar quarters", () => {
    for (const [month, day, quarter] of [[1, 1, "winter"], [3, 31, "winter"], [4, 1, "spring"], [8, 15, "summer"], [10, 18, "fall"], [12, 31, "fall"]] as const) {
      expect(AnimeSeason.current(new Date(2026, month - 1, day, 12))).toEqual(new AnimeSeason(2026, quarter));
    }
  });
  it("current season turns over at local midnight on New Year's, not UTC midnight", () => {
    const zone = process.env.TZ;
    try {
      // Chicago is behind UTC, so late Dec 31 is already Jan 1 in UTC; Kiritimati (UTC+14) is ahead,
      // so early Jan 1 is still Dec 31 in UTC. UTC getters would pick the wrong season in both.
      for (const tz of ["America/Chicago", "Asia/Tokyo", "Pacific/Kiritimati"]) {
        process.env.TZ = tz;
        const evening = new Date(2025, 11, 31, 23, 59, 59, 999);
        const morning = new Date(2026, 0, 1, 0, 0);
        expect(evening.getTimezoneOffset(), tz).not.toBe(0);
        expect(AnimeSeason.current(evening), tz).toEqual(new AnimeSeason(2025, "fall"));
        expect(AnimeSeason.current(morning), tz).toEqual(new AnimeSeason(2026, "winter"));
        expect(morning.getTime() - evening.getTime(), tz).toBe(1);
        // At least one side of midnight sits on a different UTC date than its local date.
        expect([evening.getUTCDate() !== evening.getDate(), morning.getUTCDate() !== morning.getDate()], tz).toContain(true);
      }
      process.env.TZ = "America/Chicago";
      expect(new Date(2025, 11, 31, 23, 0).getUTCFullYear()).toBe(2026);
      process.env.TZ = "Pacific/Kiritimati";
      expect(new Date(2026, 0, 1, 0, 0).getUTCFullYear()).toBe(2025);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
  it("next and previous cross years", () => {
    const fall = new AnimeSeason(2025, "fall");
    expect(fall.next).toEqual(new AnimeSeason(2026, "winter"));
    expect(fall.next.previous).toEqual(fall);
    expect(new AnimeSeason(2026, "winter").previous).toEqual(fall);
    expect(new AnimeSeason(2026, "spring").next).toEqual(new AnimeSeason(2026, "summer"));
  });
  it("bounds and labels", () => {
    const cases: [Quarter, string, string][] = [["winter", "2026-01-01", "2026-03-31"], ["spring", "2026-04-01", "2026-06-30"], ["summer", "2026-07-01", "2026-09-30"], ["fall", "2026-10-01", "2026-12-31"]];
    for (const [quarter, first, last] of cases) {
      const season = new AnimeSeason(2026, quarter);
      expect(season.firstDay).toBe(first);
      expect(season.lastDay).toBe(last);
    }
    expect(new AnimeSeason(2025, "fall").label).toBe("Fall 2025");
  });
  it("contains is inclusive", () => {
    const spring = new AnimeSeason(2026, "spring");
    expect(spring.contains("2026-04-01")).toBe(true);
    expect(spring.contains("2026-06-30")).toBe(true);
    for (const date of ["2026-03-31", "2026-07-01", null, ""]) expect(spring.contains(date)).toBe(false);
  });
  it("round-trips linkable seasons and rejects invalid queries", () => {
    const fall = new AnimeSeason(2026, "fall");
    expect(fall.slug).toBe("fall-2026");
    expect(AnimeSeason.parse(fall.slug)).toEqual(fall);
    for (const value of [null, "", "autumn-2026", "fall-26", "fall-0000", "fall-2026junk"]) expect(AnimeSeason.parse(value)).toBeNull();
  });
});
