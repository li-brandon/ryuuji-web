import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";
import { ICONS, THEME_COLORS } from "@/lib/pwa";

export default function manifest(): MetadataRoute.Manifest {
  const png = ({ src, size }: { src: string; size: number }) => ({ src, sizes: `${size}x${size}`, type: "image/png" });
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The manifest has no dark variant; the viewport's theme-color follows the system theme once loaded.
    theme_color: THEME_COLORS.light,
    background_color: THEME_COLORS.light,
    icons: [
      { ...png(ICONS.small), purpose: "any" },
      { ...png(ICONS.large), purpose: "any" },
      { ...png(ICONS.maskable), purpose: "maskable" },
    ],
  };
}
