import type { Title } from "./types";

export const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
export const FINISHED_STALE_INTERVAL = 7 * REFRESH_INTERVAL;

/** MetadataRefresher.isDue: movies are excluded; ongoing shows refresh every cycle. */
export function isDue(title: Title, now = new Date()): boolean {
  if (title.kind !== "show") return false;
  if (title.showStatus !== "Ended" && title.showStatus !== "Canceled") return true;
  if (!title.episodes || !title.lastRefreshedAt) return true;
  const last = Date.parse(title.lastRefreshedAt);
  return !Number.isFinite(last) || now.getTime() - last >= FINISHED_STALE_INTERVAL;
}

/** macOS preserves repository order, with no total batch limit. */
export function dueTitles(titles: readonly Title[], now = new Date()): Title[] {
  return titles.filter((title) => isDue(title, now));
}
