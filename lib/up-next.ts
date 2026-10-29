import { byEpisodeOrder, isSpecial, rewatchProgress, titleEpisodes, titleProgress, type Episode } from "./progress";
import type { Title, WatchEvent } from "./types";

export type UpNextEntry = { title: Title; next: Episode; remaining: number; rewatchNumber: number | null };

/** Swift UpNextEntry selection, plus caught-up titles and their next known air date. */
export function selectUpNext(library: { title: Title; events: WatchEvent[] }[], today: string) {
  const active: UpNextEntry[] = [];
  const caughtUp: { title: Title; airDate: string | null }[] = [];
  const activity = new Map<Title, number>();
  for (const { title, events } of library) {
    activity.set(title, events.length ? Math.max(...events.map((e) => Date.parse(e.watchedAt))) : Date.parse(title.addedAt));
    if (title.kind !== "show") continue;
    if (title.status === "caughtUp") {
      const upcoming = titleEpisodes(title).filter((e) => !isSpecial(e) && e.airDate && e.airDate > today)
        .sort((a, b) => (a.airDate ?? "").localeCompare(b.airDate ?? "") || byEpisodeOrder(a, b))[0];
      caughtUp.push({ title, airDate: upcoming?.airDate ?? null });
    }
    if (title.status !== "watching" && title.status !== "rewatching") continue;
    const progress = titleProgress(title, events, today);
    const rewatch = title.status === "rewatching" ? rewatchProgress(progress) : null;
    const next = title.status === "rewatching" ? rewatch?.next : progress.next;
    if (next) active.push({ title, next, remaining: rewatch?.remaining ?? progress.remaining, rewatchNumber: rewatch?.number ?? null });
  }
  const recent = (a: { title: Title }, b: { title: Title }) => (activity.get(b.title) ?? 0) - (activity.get(a.title) ?? 0);
  return { active: active.sort(recent), caughtUp: caughtUp.sort(recent) };
}
