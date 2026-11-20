import "server-only";

// Access configuration read from the environment. `instrumentation.ts` validates it at server
// startup, and the routes re-read it per request so a bad value still fails closed.

export const MIN_PASSCODE_LENGTH = 16;
export const MIN_SESSION_SECRET_LENGTH = 32;

export type AccessConfig = {
  passcode: string;
  secret: string;
  /** Sessions issued before this (epoch seconds) are rejected; 0 when unset. */
  notBefore: number;
};

export class AccessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessConfigError";
  }
}

/** Epoch seconds from an ISO 8601 date-time with a timezone or an epoch value (seconds), else NaN. */
function parseNotBefore(value: string): number {
  if (/^\d{1,12}$/.test(value)) return Number(value);
  // Date-only strings parse as UTC midnight and offset-less date-times as server-local time;
  // require a full date-time with `Z` or `±HH:MM` so the instant is unambiguous.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Math.floor(Date.parse(value) / 1000);
}

/**
 * The access config, or null when `RYUUJI_PASSCODE` is unset (access disabled).
 * Throws `AccessConfigError` when the passcode is set but the config is unsafe.
 * Messages name variables and rules only, never values.
 */
export function readAccessConfig(env: Record<string, string | undefined> = process.env): AccessConfig | null {
  const passcode = env.RYUUJI_PASSCODE;
  if (!passcode) return null;
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    throw new AccessConfigError(`RYUUJI_PASSCODE must be at least ${MIN_PASSCODE_LENGTH} characters`);
  }
  const secret = env.RYUUJI_SESSION_SECRET ?? "";
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new AccessConfigError(
      `RYUUJI_SESSION_SECRET must be set to at least ${MIN_SESSION_SECRET_LENGTH} characters when RYUUJI_PASSCODE is set`,
    );
  }
  const rawNotBefore = env.RYUUJI_SESSION_NOT_BEFORE?.trim();
  const notBefore = rawNotBefore ? parseNotBefore(rawNotBefore) : 0;
  if (!Number.isFinite(notBefore)) {
    throw new AccessConfigError(
      "RYUUJI_SESSION_NOT_BEFORE must be an ISO 8601 date-time with a timezone (Z or ±HH:MM) or epoch seconds",
    );
  }
  return { passcode, secret, notBefore };
}

/**
 * Startup check for the Node.js server: on an invalid access config, logs one line naming the
 * variable (never its value) and calls `exit(1)` so the process stops instead of serving 503s.
 * Other errors propagate.
 */
export function exitOnInvalidAccessConfig(
  exit: (code: number) => void,
  log: (line: string) => void = console.error,
  env: Record<string, string | undefined> = process.env,
): void {
  try {
    readAccessConfig(env);
  } catch (error) {
    if (!(error instanceof AccessConfigError)) throw error;
    log(`Invalid server config, refusing to start: ${error.message}`);
    exit(1);
  }
}

/** `readAccessConfig`, with an invalid config reported as null so callers fail closed. */
export function accessConfigOrNull(): AccessConfig | null {
  try {
    return readAccessConfig();
  } catch {
    return null;
  }
}
