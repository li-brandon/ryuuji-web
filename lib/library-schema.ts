import { z } from "zod";
import { titleSchema, watchEventFieldsSchema } from "./types";

// Versioned JSON interchange format; see docs/library-schema.md.

export const LIBRARY_FORMAT = "ryuuji-library";
export const LIBRARY_SCHEMA_VERSION = 1;

export const libraryFileSchema = z.object({
  format: z.literal(LIBRARY_FORMAT),
  schemaVersion: z.literal(LIBRARY_SCHEMA_VERSION),
  exportedAt: z.iso.datetime({ offset: true }),
  titles: z.array(titleSchema.extend({ watchEvents: z.array(watchEventFieldsSchema) })),
});

export type LibraryFile = z.infer<typeof libraryFileSchema>;

/** Validates parsed JSON as a library file. Throws a ZodError on unknown versions or bad values. */
export function parseLibraryFile(data: unknown): LibraryFile {
  return libraryFileSchema.parse(data);
}
