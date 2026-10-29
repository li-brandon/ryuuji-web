import { appIcon } from "@/lib/app-icon";
import { ICONS } from "@/lib/pwa";

// Served at /icon/192 and /icon/512 (also linked from the manifest).
export function generateImageMetadata() {
  return [ICONS.small, ICONS.large].map(({ size }) => ({
    id: String(size),
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  return appIcon(Number(await id) === ICONS.large.size ? ICONS.large.size : ICONS.small.size);
}
