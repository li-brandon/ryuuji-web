import { z } from "zod";
import { THEMES } from "./theme";
import { preferencesSchema } from "./watch-providers";
import { titleSchema, watchEventFieldsSchema } from "./types";

// Versioned JSON interchange format; see docs/library-schema.md.

export const LIBRARY_FORMAT = "ryuuji-library";
export const LIBRARY_SCHEMA_VERSION = 1;

export const librarySettingsSchema = z.strictObject({
  theme: z.enum(THEMES).optional(),
  watch: preferencesSchema.strict().optional(),
});
export type LibrarySettings = z.infer<typeof librarySettingsSchema>;

export const libraryFileSchema = z.strictObject({
  format: z.literal(LIBRARY_FORMAT),
  schemaVersion: z.literal(LIBRARY_SCHEMA_VERSION),
  exportedAt: z.iso.datetime({ offset: true }),
  settings: librarySettingsSchema.optional(),
  titles: z.array(titleSchema.extend({ watchEvents: z.array(watchEventFieldsSchema) })),
}).superRefine((file, ctx) => {
  const titles = new Set<string>();
  const events = new Set<string>();
  file.titles.forEach((title, titleIndex) => {
    const key = `${title.kind}:${title.tmdbId}`;
    if (titles.has(key)) {
      ctx.addIssue({ code: "custom", path: ["titles", titleIndex], message: `Duplicate title ${key}` });
    }
    titles.add(key);
    title.watchEvents.forEach((event, eventIndex) => {
      if (events.has(event.uid)) {
        ctx.addIssue({ code: "custom", path: ["titles", titleIndex, "watchEvents", eventIndex, "uid"], message: `Duplicate event uid ${event.uid}` });
      }
      events.add(event.uid);
    });
  });
});

export type LibraryFile = z.infer<typeof libraryFileSchema>;

/** Validates parsed JSON as a library file. Throws a ZodError on unknown versions or bad values. */
export function parseLibraryFile(data: unknown): LibraryFile {
  return libraryFileSchema.parse(data);
}
