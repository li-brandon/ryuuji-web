import { z } from "zod";
import type { ProviderInfo, WatchProviderData } from "./types";

export const DEFAULT_REGION = "US";
export const JUSTWATCH_URL = "https://www.justwatch.com";
export const regionSchema = z.string().regex(/^[A-Z]{2}$/);
export const preferencesSchema = z.object({ region: regionSchema.default(DEFAULT_REGION), services: z.array(z.int().nonnegative()).default([]) });
export type WatchPreferences = z.infer<typeof preferencesSchema>;

const rawProviderSchema = z.object({
  provider_id: z.int(), provider_name: z.string(), logo_path: z.string().nullable().optional(),
  display_priority: z.int().optional(), display_priorities: z.record(z.string(), z.int()).optional(),
});
export const providerListSchema = z.object({ results: z.array(rawProviderSchema) });
export const regionsSchema = z.object({ results: z.array(z.object({ iso_3166_1: regionSchema, english_name: z.string(), native_name: z.string().optional() })) });
export const watchResponseSchema = z.object({
  id: z.int(), results: z.record(z.string(), z.object({
    link: z.string().nullable().optional(), flatrate: z.array(rawProviderSchema).optional(),
    rent: z.array(rawProviderSchema).optional(), buy: z.array(rawProviderSchema).optional(),
  })),
});
const byPriority = (a: ProviderInfo, b: ProviderInfo) => a.displayPriority - b.displayPriority || a.name.localeCompare(b.name);
const provider = (raw: z.infer<typeof rawProviderSchema>, region: string): ProviderInfo => ({
  id: raw.provider_id, name: raw.provider_name, logoPath: raw.logo_path ?? null,
  displayPriority: raw.display_priorities?.[region] ?? raw.display_priority ?? Number.MAX_SAFE_INTEGER,
});

export function mapWatchProviders(response: z.infer<typeof watchResponseSchema>, region: string, now = new Date()): WatchProviderData {
  const entry = response.results[region];
  const map = (raw: z.infer<typeof rawProviderSchema>[] = []) => raw.map((p) => provider(p, region)).sort(byPriority);
  return { region, fetchedAt: now.toISOString(), providers: map(entry?.flatrate), rent: map(entry?.rent), buy: map(entry?.buy), link: entry?.link ?? null };
}

export function mergeProviderCatalog(lists: z.infer<typeof providerListSchema>[], region: string): ProviderInfo[] {
  const providers = new Map<number, ProviderInfo>();
  for (const list of lists) for (const raw of list.results) {
    const info = provider(raw, region);
    const existing = providers.get(info.id);
    if (!existing || existing.displayPriority > info.displayPriority) providers.set(info.id, info);
  }
  return [...providers.values()].sort((a, b) => a.displayPriority - b.displayPriority || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export function providerBadges(data: WatchProviderData | null, region: string, services: ReadonlySet<number>) {
  const matching = data?.region === region ? data.providers.filter((p) => services.has(p.id)).sort(byPriority) : [];
  return { shown: matching.slice(0, 5), overflow: Math.max(0, matching.length - 5) };
}
export function decodeServices(raw: string): Set<number> {
  return new Set(raw.split(",").map((v) => v.trim()).filter((v) => /^\d+$/.test(v)).map(Number));
}
export const encodeServices = (ids: ReadonlySet<number>) => [...ids].sort((a, b) => a - b).join(",");

/** Cached/imported links are untrusted. Only use TMDB watch pages or JustWatch. */
export function watchLink(link: string | null | undefined): string {
  try {
    const url = new URL(link ?? "");
    if (url.protocol === "https:" && ["www.themoviedb.org", "www.justwatch.com"].includes(url.hostname)) return url.href;
  } catch { /* Missing or malformed cache link. */ }
  return JUSTWATCH_URL;
}
