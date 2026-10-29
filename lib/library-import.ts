import { deepEqual } from "./deep-equal";
import { readTheme } from "./theme";
import { readWatchPreferences } from "./watch-preferences";
import type { LibrarySettings } from "./library-schema";
import { z } from "zod";
import { LIBRARY_FORMAT, LIBRARY_SCHEMA_VERSION, parseLibraryFile, type LibraryFile } from "./library-schema";
import type { LibraryRepository } from "./storage";
import { watchEventFieldsSchema } from "./types";
import type { Title, TitleKey, WatchEvent } from "./types";

export type ImportCounts = { titlesToAdd: number; titlesToMerge: number; titlesUnchanged: number; eventsToAdd: number; eventsAlreadyPresent: number; conflicts: number };
export type FieldChange = { field: string; oldValue: unknown; newValue: unknown };
export type DiscardedValue = { field: string; value: unknown; reason: string };
export type TitleDiff = TitleKey & { name: string; changes: FieldChange[]; discarded: DiscardedValue[] };
export type ImportPlan = { file: LibraryFile; counts: ImportCounts; titles: Title[]; events: WatchEvent[]; titleDiffs: TitleDiff[]; settingsChanges: FieldChange[] };
export const currentLibrarySettings = (): LibrarySettings => ({ theme: readTheme(), watch: readWatchPreferences() });
const key = (title: TitleKey) => `${title.kind}:${title.tmdbId}`;

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
  // No Title edit timestamp or separate local edit record exists. Cache/viewing dates are not edits.
  merged.status = incoming.status;
  if (incoming.score !== null) merged.score = incoming.score;
  if (incoming.notes.trim()) merged.notes = incoming.notes;
  return merged;
}

/** Pure diff shared by preview and the transaction; confirmation always recomputes against live data. */
export function planLibraryImport(file: LibraryFile, titles: Title[], events: WatchEvent[], settings = currentLibrarySettings()): ImportPlan {
  const counts: ImportCounts = { titlesToAdd: 0, titlesToMerge: 0, titlesUnchanged: 0, eventsToAdd: 0, eventsAlreadyPresent: 0, conflicts: 0 };
  const plan: ImportPlan = { file, counts, titles: [], events: [], titleDiffs: [], settingsChanges: [] };
  for (const [field, newValue] of Object.entries(file.settings ?? {})) {
    const oldValue = Reflect.get(settings, field);
    if (!deepEqual(oldValue, newValue)) plan.settingsChanges.push({ field, oldValue, newValue });
  }
  const byTitle = new Map(titles.map((title) => [key(title), title]));
  const byUid = new Map(events.map((event) => [event.uid, event]));
  for (const { watchEvents, ...incoming } of file.titles) {
    const existing = byTitle.get(key(incoming));
    const merged = existing ? mergeTitle(existing, incoming) : incoming;
    const diff: TitleDiff = { tmdbId: incoming.tmdbId, kind: incoming.kind, name: incoming.name, changes: [], discarded: [] };
    for (const [field, newValue] of Object.entries(merged)) {
      const oldValue = existing ? Reflect.get(existing, field) : undefined;
      if (!deepEqual(oldValue, newValue)) diff.changes.push({ field, oldValue, newValue });
      const incomingValue = Reflect.get(incoming, field);
      if (existing && !deepEqual(Reflect.get(existing, field), incomingValue)) {
        const incomingKept = deepEqual(newValue, incomingValue);
        diff.discarded.push({ field, value: incomingKept ? oldValue : incomingValue,
          reason: incomingKept ?
            field === "status" || field === "score" || field === "notes" ? "Incoming value wins (no modification timestamps available)." : "Incoming metadata fills an empty local field." :
            field === "notes" || field === "score" ? "Empty incoming values never erase local values." : "Existing metadata is retained." });
      }
    }
    plan.titleDiffs.push(diff);
    if (!existing) { counts.titlesToAdd++; plan.titles.push(merged); }
    else if (!deepEqual(existing, merged)) { counts.titlesToMerge++; plan.titles.push(merged); }
    else counts.titlesUnchanged++;
    for (const fields of watchEvents) {
      const event = { ...fields, tmdbId: incoming.tmdbId, kind: incoming.kind };
      const previous = byUid.get(event.uid);
      if (previous) {
        counts.eventsAlreadyPresent++;
        if (!deepEqual(event, previous)) {
          counts.conflicts++;
          for (const [field, value] of Object.entries(event)) {
            if (!deepEqual(value, Reflect.get(previous, field))) diff.discarded.push({
              field: `watchEvents.${event.uid}.${field}`, value, reason: "Existing event with this UID is retained.",
            });
          }
        }
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
  return parseLibraryFile({ format: LIBRARY_FORMAT, schemaVersion: LIBRARY_SCHEMA_VERSION, exportedAt: now.toISOString(), settings: currentLibrarySettings(),
    titles: titles.sort((a, b) => a.tmdbId - b.tmdbId || a.kind.localeCompare(b.kind)).map((title) => ({ ...title,
      watchEvents: events.filter((event) => key(event) === key(title)).sort((a, b) => a.uid.localeCompare(b.uid)).map((event) => watchEventFieldsSchema.parse({ uid: event.uid, watchedAt: event.watchedAt, season: event.season, episode: event.episode, tmdbEpisodeId: event.tmdbEpisodeId, batchId: event.batchId })),
    })),
  });
}
