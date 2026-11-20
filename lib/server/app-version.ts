import "server-only";

// The app version from package.json, read at build time. Server-only, so the rest of
// package.json is never bundled into client code.
import packageJson from "@/package.json";

export const APP_VERSION: string = packageJson.version;
