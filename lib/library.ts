import { z } from "zod";
import { LIST_STATUSES, type Title, type WatchEvent } from "./types";

export const libraryFiltersSchema = z.object({
  status: z.enum(["all", ...LIST_STATUSES]).catch("all"),
  kind: z.enum(["all", "movie", "show"]).catch("all"),
  anime: z.enum(["0", "1"]).catch("0"),
  sort: z.enum(["name", "added", "watched", "score"]).catch("watched"),
});
export type LibraryFilters = z.infer<typeof libraryFiltersSchema>;
export type LibraryEntry = { title: Title; events: WatchEvent[] };
const lastWatch = ({ events }: LibraryEntry) => Math.max(0, ...events.map((event) => Date.parse(event.watchedAt)));

export function selectLibrary(entries: LibraryEntry[], filters: LibraryFilters) {
  const matched = entries.filter(({ title }) => (filters.kind === "all" || title.kind === filters.kind) && (filters.anime === "0" || title.isAnime));
  const counts = Object.fromEntries(LIST_STATUSES.map((status) => [status, matched.filter(({ title }) => title.status === status).length]));
  const visible = matched.filter(({ title }) => filters.status === "all" || title.status === filters.status).sort((a, b) => {
    const byName = a.title.name.localeCompare(b.title.name, "en", { numeric: true, sensitivity: "base" });
    const tie = byName || a.title.kind.localeCompare(b.title.kind) || a.title.tmdbId - b.title.tmdbId;
    switch (filters.sort) {
      case "name": return tie;
      case "added": return Date.parse(b.title.addedAt) - Date.parse(a.title.addedAt) || tie;
      case "watched": return lastWatch(b) - lastWatch(a) || tie;
      case "score": return (b.title.score ?? -Infinity) - (a.title.score ?? -Infinity) || tie;
    }
  });
  return { counts, total: matched.length, visible, groups: LIST_STATUSES.map((status) => ({ status, entries: visible.filter(({ title }) => title.status === status) })).filter((group) => group.entries.length) };
}
