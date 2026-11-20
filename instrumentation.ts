// Runs once per server instance before it handles requests: refuse to start with an unsafe
// access config (short passcode, missing or short session secret, bad not-before).

export async function register() {
  const { exitOnInvalidAccessConfig, readAccessConfig } = await import("@/lib/server/config");
  // Next inlines NEXT_RUNTIME, so process.exit stays out of the edge bundle. On Node an invalid
  // config exits the process; elsewhere it throws and the routes still fail closed per request.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    exitOnInvalidAccessConfig((code) => process.exit(code));
  } else {
    readAccessConfig();
  }
}
