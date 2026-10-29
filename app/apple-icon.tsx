import { appIcon } from "@/lib/app-icon";

// The home-screen icon on iOS (Add to Home Screen ignores manifest icons).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(size.width);
}
