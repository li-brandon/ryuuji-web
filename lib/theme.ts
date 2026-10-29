// Theme preference: "system" follows prefers-color-scheme; "light"/"dark" pin data-theme on <html>.

export const THEMES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "ryuuji-theme";

export function parseTheme(value: unknown): ThemePreference {
  return THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : "system";
}

/** The palette a preference shows, given whether the system prefers dark. */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

/** Runs inline in <head> before first paint, so a pinned theme never flashes. Mirrors applyTheme. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function applyTheme(preference: ThemePreference, root: HTMLElement = document.documentElement) {
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
}
