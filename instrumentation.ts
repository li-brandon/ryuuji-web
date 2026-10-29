// Runs once per server instance before it handles requests: refuse to start with an unsafe
// access config (short passcode, missing or short session secret, bad not-before).

export async function register() {
  const { readAccessConfig } = await import("@/lib/server/config");
  readAccessConfig();
}
