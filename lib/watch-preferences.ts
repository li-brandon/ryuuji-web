import { preferencesSchema, DEFAULT_REGION, type WatchPreferences } from "./watch-providers";
import { providerInfoSchema } from "./types";

export const WATCH_PREFERENCES_KEY = "ryuuji-watch-preferences";
export const WATCH_CHANGE = "ryuuji-watch-preferences-change";
export const DEFAULT_PREFERENCES: WatchPreferences = { region: DEFAULT_REGION, services: [] };
let memory = JSON.stringify(DEFAULT_PREFERENCES);
export function preferenceSnapshot(): string {
  try { return localStorage.getItem(WATCH_PREFERENCES_KEY) ?? memory; } catch { return memory; }
}
export function parsePreferences(raw: string): WatchPreferences {
  try { return preferencesSchema.parse(JSON.parse(raw)); } catch { return DEFAULT_PREFERENCES; }
}
export const readWatchPreferences = () => parsePreferences(preferenceSnapshot());
export function saveWatchPreferences(value: WatchPreferences) {
  memory = JSON.stringify(preferencesSchema.parse(value));
  try { localStorage.setItem(WATCH_PREFERENCES_KEY, memory); } catch { /* Keep the preference for this session. */ }
  window.dispatchEvent(new Event(WATCH_CHANGE));
}
export function subscribeWatchPreferences(onChange: () => void) {
  window.addEventListener(WATCH_CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(WATCH_CHANGE, onChange); window.removeEventListener("storage", onChange); };
}
export function loadProviderCatalog(region: string) {
  try { return providerInfoSchema.array().parse(JSON.parse(localStorage.getItem(`ryuuji-provider-catalog-${region}`) ?? "[]")); } catch { return []; }
}
export function saveProviderCatalog(region: string, catalog: ReturnType<typeof loadProviderCatalog>) {
  try { localStorage.setItem(`ryuuji-provider-catalog-${region}`, JSON.stringify(catalog)); } catch { /* Offline cache is best effort. */ }
}
