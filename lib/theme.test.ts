import { describe, expect, it } from "vitest";
import { applyTheme, parseTheme, resolveTheme, THEME_SCRIPT, THEME_STORAGE_KEY } from "./theme";

/** Runs the inline script against a fake document and storage; returns the resulting data-theme. */
function runScript(stored: string | null | Error) {
  const root = { dataset: {} as Record<string, string> };
  const localStorage = {
    getItem: (key: string) => {
      if (stored instanceof Error) throw stored;
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  new Function("document", "localStorage", THEME_SCRIPT)({ documentElement: root }, localStorage);
  return root.dataset.theme;
}

describe("theme", () => {
  it("parses stored preferences, defaulting to system", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("sepia")).toBe("system");
    expect(parseTheme(null)).toBe("system");
  });

  it("resolves system against the OS setting and keeps pinned themes", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("inline script pins only valid themes and survives blocked storage", () => {
    expect(runScript("dark")).toBe("dark");
    expect(runScript("light")).toBe("light");
    expect(runScript("system")).toBeUndefined();
    expect(runScript("<script>")).toBeUndefined();
    expect(runScript(null)).toBeUndefined();
    expect(runScript(new Error("SecurityError"))).toBeUndefined();
  });

  it("applyTheme sets or clears data-theme", () => {
    const root = { dataset: {} as Record<string, string> } as HTMLElement;
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
    applyTheme("system", root);
    expect(root.dataset.theme).toBeUndefined();
  });
});
