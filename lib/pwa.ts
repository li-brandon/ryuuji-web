// Install metadata shared by app/manifest.ts, the generated icons and the root layout's viewport.
// Colors mirror app/tokens.css (`--bg` light and dark, `--accent` light); lib/pwa.test.ts checks
// they stay in sync, since the manifest and icons cannot read CSS custom properties.

export const THEME_COLORS = { light: "#f6f6f8", dark: "#0b0b0e" } as const;
export const ICON_BACKGROUND = "#c8361d";
export const ICON_FOREGROUND = "#ffffff";

/** Generated PNG icons (app/icon.tsx and app/maskable-icon/route.tsx). */
export const ICONS = {
  small: { src: "/icon/192", size: 192 },
  large: { src: "/icon/512", size: 512 },
  maskable: { src: "/maskable-icon", size: 512 },
} as const;
