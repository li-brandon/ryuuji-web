import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import nextConfig from "@/next.config";
import { APP_NAME } from "@/lib/app";
import { ICON_BACKGROUND, THEME_COLORS } from "@/lib/pwa";

const tokens = readFileSync(new URL("../app/tokens.css", import.meta.url), "utf8");
const token = (name: string) => {
  const match = new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`).exec(tokens);
  if (!match) throw new Error(`--${name} not found in tokens.css`);
  return { light: match[1], dark: match[2] };
};

describe("PWA colors", () => {
  it("match the design tokens", () => {
    expect(THEME_COLORS).toEqual(token("bg"));
    expect(ICON_BACKGROUND).toBe(token("accent").light);
  });
});

describe("manifest", () => {
  const m = manifest();

  it("installs as a standalone app named Ryuuji", () => {
    expect(m).toMatchObject({ name: APP_NAME, short_name: APP_NAME, start_url: "/", scope: "/", display: "standalone" });
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
  });

  it("uses the light background token for theme and splash colors", () => {
    expect(m.theme_color).toBe(THEME_COLORS.light);
    expect(m.background_color).toBe(THEME_COLORS.light);
  });

  it("lists 192 and 512 PNG icons plus a maskable one", () => {
    expect(m.icons).toEqual([
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
});

describe("next.config headers", () => {
  it("serves /sw.js uncached with a root scope", async () => {
    const rules = await nextConfig.headers!();
    const sw = rules.find((rule) => rule.source === "/sw.js");
    expect(Object.fromEntries(sw!.headers.map(({ key, value }) => [key, value]))).toMatchObject({
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    });
  });
});
