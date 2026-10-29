"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import { applyTheme, readTheme, setTheme, resolveTheme, THEME_CHANGE, THEMES, type ThemePreference } from "@/lib/theme";
import { cx } from "./cx";
import { Icon } from "./Icon";
import styles from "./ui.module.css";

const DARK = "(prefers-color-scheme: dark)";
const LABELS: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };

function subscribe(onChange: () => void) {
  const media = matchMedia(DARK);
  window.addEventListener(THEME_CHANGE, onChange);
  window.addEventListener("storage", onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE, onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onChange);
  };
}

/** Re-applies the stored theme after React's dev-mode remount clears <html> attributes. No-op in production. */
export function ThemeSync() {
  useLayoutEffect(() => applyTheme(readTheme()), []);
  return null;
}

/** System / Light / Dark segmented control. `compact` shows icons only. */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const preference = useSyncExternalStore(subscribe, readTheme, () => "system" as const);
  const systemDark = useSyncExternalStore(subscribe, () => matchMedia(DARK).matches, () => false);
  const name = useId();

  return (
    <fieldset className={cx(styles.segmented, compact && styles.compact)}>
      <legend className="sr-only">Theme</legend>
      {THEMES.map((theme) => (
        <label
          key={theme}
          className={styles.segment}
          title={theme === "system" ? `System (${resolveTheme(theme, systemDark)})` : LABELS[theme]}
        >
          <input type="radio" name={name} value={theme} checked={preference === theme} onChange={() => setTheme(theme)} />
          <Icon name={theme === "system" ? "system" : theme === "light" ? "sun" : "moon"} size={18} />
          <span className={compact ? "sr-only" : undefined}>{LABELS[theme]}</span>
        </label>
      ))}
    </fieldset>
  );
}
