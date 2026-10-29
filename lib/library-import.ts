import { z } from "zod";
import { LIBRARY_FORMAT, LIBRARY_SCHEMA_VERSION, parseLibraryFile, type LibraryFile } from "./library-schema";
import type { LibraryRepository } from "./storage";
import { watchEventFieldsSchema } from "./types";
import type { Title, TitleKey, WatchEvent } from "./types";

export type ImportCounts = { titlesToAdd: number; titlesToMerge: number; titlesUnchanged: number; eventsToAdd: number; eventsAlreadyPresent: number; conflicts: number; invalid: number };
export type ImportPlan = { file: LibraryFile; counts: ImportCounts; titles: Title[]; events: WatchEvent[] };
const key = (title: TitleKey) => `${title.kind}:${title.tmdbId}`;
const equal = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

export function readLibraryFile(input: unknown): LibraryFile {
  let data: unknown = input;
  if (typeof input === "string") {
    try { data = JSON.parse(input); } catch { throw new Error("This file is not valid JSON. Choose a Ryuuji library export."); }
  }
  const envelope = z.object({ format: z.unknown().optional(), schemaVersion: z.unknown().optional() }).safeParse(data);
  if (envelope.success) {
    if (envelope.data.format !== LIBRARY_FORMAT) throw new Error("This is not a Ryuuji library export (wrong format).");
    const version = envelope.data.schemaVersion;
    if (typeof version === "number" && version > LIBRARY_SCHEMA_VERSION) throw new Error("This file was made by a newer version of Ryuuji. Update Ryuuji before importing it.");
  }
  try { return parseLibraryFile(data); }
  catch (error) {
    if (error instanceof z.ZodError) throw new Error(`Invalid library file: ${error.issues.map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`).join("; ")}`);
    throw error;
  }
}

function mergeTitle(existing: Title, incoming: Title): Title {
  const merged = { ...existing };
  // Missing metadata only. Boolean false is a value, not missing metadata.
  for (const field of ["name", "originalName", "overview", "posterPath", "releaseDate", "genres", "originCountries", "originalLanguage", "runtime", "showStatus", "episodes", "providerData"] as const) {
    const value = existing[field];
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      Object.assign(merged, { [field]: incoming[field] });
    }
  }
  if (existing.status === "planToWatch") merged.status = incoming.status;
  if (existing.score === null) merged.score = incoming.score;
  if (!existing.notes.trim()) merged.notes = incoming.notes;
  return merged;
}

/** Pure diff shared by preview and the transaction; confirmation always recomputes against live data. */
export function planLibraryImport(file: LibraryFile, titles: Title[], events: WatchEvent[]): ImportPlan {
  const counts: ImportCounts = { titlesToAdd: 0, titlesToMerge: 0, titlesUnchanged: 0, eventsToAdd: 0, eventsAlreadyPresent: 0, conflicts: 0, invalid: 0 };
  const plan: ImportPlan = { file, counts, titles: [], events: [] };
  const byTitle = new Map(titles.map((title) => [key(title), title]));
  const byUid = new Map(events.map((event) => [event.uid, event]));
  for (const { watchEvents, ...incoming } of file.titles) {
    const existing = byTitle.get(key(incoming));
    const merged = existing ? mergeTitle(existing, incoming) : incoming;
    if (!existing) { counts.titlesToAdd++; plan.titles.push(merged); }
    else if (!equal(existing, merged)) { counts.titlesToMerge++; plan.titles.push(merged); }
    else counts.titlesUnchanged++;
    for (const fields of watchEvents) {
      const event = { ...fields, tmdbId: incoming.tmdbId, kind: incoming.kind };
      const previous = byUid.get(event.uid);
      if (previous) {
        counts.eventsAlreadyPresent++;
        if (Object.keys(event).some((field) => Reflect.get(event, field) !== Reflect.get(previous, field))) counts.conflicts++;
      } else { counts.eventsToAdd++; plan.events.push(event); }
    }
  }
  return plan;
}

export async function previewImport(repo: LibraryRepository, input: unknown): Promise<ImportPlan> {
  const file = readLibraryFile(typeof Blob !== "undefined" && input instanceof Blob ? await input.text() : input);
  const { titles, events } = await repo.librarySnapshot();
  return planLibraryImport(file, titles, events);
}

export async function exportLibrary(repo: LibraryRepository, now = new Date()): Promise<LibraryFile> {
  const { titles, events } = await repo.librarySnapshot();
  return parseLibraryFile({ format: LIBRARY_FORMAT, schemaVersion: LIBRARY_SCHEMA_VERSION, exportedAt: now.toISOString(),
    titles: titles.sort((a, b) => a.tmdbId - b.tmdbId || a.kind.localeCompare(b.kind)).map((title) => ({ ...title,
      watchEvents: events.filter((event) => key(event) === key(title)).sort((a, b) => a.uid.localeCompare(b.uid)).map((event) => watchEventFieldsSchema.parse({ uid: event.uid, watchedAt: event.watchedAt, season: event.season, episode: event.episode, tmdbEpisodeId: event.tmdbEpisodeId, batchId: event.batchId })),
    })),
  });
}
