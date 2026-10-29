import { z } from "zod";

// Mirrors the macOS app's SchemaV2 models and Domain/Types.swift. Raw values match exactly.
// Optional Swift fields are `null` here; omitted keys parse as `null`.

export const KINDS = ["movie", "show"] as const;
export const LIST_STATUSES = [
  "planToWatch",
  "watching",
  "rewatching",
  "caughtUp",
  "onHold",
  "dropped",
  "completed",
] as const;
export const SHOW_STATUSES = [
  "Returning Series",
  "Ended",
  "Canceled",
  "In Production",
  "Planned",
  "Pilot",
  "Unknown",
] as const;

const isoDateTime = z.iso.datetime({ offset: true });
const opt = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

export const kindSchema = z.enum(KINDS);
export const listStatusSchema = z.enum(LIST_STATUSES);
export const showStatusSchema = z.enum(SHOW_STATUSES);

export const episodeMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  seasons: z.array(
    z.object({
      number: z.int(),
      name: z.string(),
      episodes: z.array(
        z.object({
          tmdbId: z.int(),
          season: z.int(),
          number: z.int(),
          name: z.string(),
          airDate: opt(z.string()),
          runtime: opt(z.int()),
        }),
      ),
    }),
  ),
});

export const watchProviderDataSchema = z.object({
  region: z.string(),
  fetchedAt: isoDateTime,
  providers: z.array(
    z.object({
      id: z.int(),
      name: z.string(),
      logoPath: opt(z.string()),
      displayPriority: z.int(),
    }),
  ),
  link: opt(z.string()),
});

export const titleSchema = z.object({
  tmdbId: z.int(),
  kind: kindSchema,
  name: z.string(),
  originalName: z.string(),
  overview: z.string(),
  posterPath: opt(z.string()),
  /** "yyyy-MM-dd": release date (movies) or first-air date (shows). */
  releaseDate: opt(z.string()),
  genres: z.array(z.string()),
  originCountries: z.array(z.string()),
  originalLanguage: z.string(),
  runtime: opt(z.int()),
  isAnime: z.boolean(),
  showStatus: opt(showStatusSchema),
  /** Cached seasons/episodes; null for movies or before the first fetch. */
  episodes: opt(episodeMetadataSchema),
  metadataRevision: z.int(),
  lastRefreshedAt: opt(isoDateTime),
  providerData: opt(watchProviderDataSchema),
  status: listStatusSchema,
  score: opt(z.int()),
  notes: z.string(),
  addedAt: isoDateTime,
});

/** A watch event without its title key, as nested under a title in the interchange file. */
export const watchEventFieldsSchema = z.object({
  uid: z.uuid(),
  watchedAt: isoDateTime,
  season: opt(z.int()),
  episode: opt(z.int()),
  tmdbEpisodeId: opt(z.int()),
  batchId: opt(z.uuid()),
});

export type Kind = z.infer<typeof kindSchema>;
export type ListStatus = z.infer<typeof listStatusSchema>;
export type ShowStatus = z.infer<typeof showStatusSchema>;
export type EpisodeMetadata = z.infer<typeof episodeMetadataSchema>;
export type WatchProviderData = z.infer<typeof watchProviderDataSchema>;
export type Title = z.infer<typeof titleSchema>;
export type TitleKey = Pick<Title, "tmdbId" | "kind">;
/** One recorded watch; `tmdbId` + `kind` key it to its title. */
export type WatchEvent = z.infer<typeof watchEventFieldsSchema> & TitleKey;
