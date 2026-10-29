import { appIcon } from "@/lib/app-icon";
import { ICONS } from "@/lib/pwa";

// The manifest's `purpose: "maskable"` icon. A separate route so it is not linked as a favicon.
export const dynamic = "force-static";

export function GET() {
  return appIcon(ICONS.maskable.size, { safeZone: true });
}
