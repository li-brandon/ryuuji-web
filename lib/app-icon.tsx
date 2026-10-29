import { ImageResponse } from "next/og";
import { ICON_BACKGROUND, ICON_FOREGROUND } from "@/lib/pwa";

/**
 * The app icon as a PNG: the sidebar's "R" mark, full bleed so the platform applies its own
 * mask (iOS rounds the corners, Android crops maskable icons to a circle or squircle).
 * `safeZone` shrinks the glyph into the inner 80% that maskable icons guarantee to show.
 */
export function appIcon(size: number, { safeZone = false } = {}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: ICON_BACKGROUND,
          color: ICON_FOREGROUND,
          fontSize: size * (safeZone ? 0.5 : 0.62),
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        R
      </div>
    ),
    { width: size, height: size },
  );
}
