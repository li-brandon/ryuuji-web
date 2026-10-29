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

/** Epoch seconds from an ISO 8601 date-time or an epoch value (seconds), else NaN. */
function parseNotBefore(value: string): number {
  if (/^\d{1,12}$/.test(value)) return Number(value);
  // Date-only strings would parse as UTC midnight; require a full date-time.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return NaN;
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
    throw new AccessConfigError("RYUUJI_SESSION_NOT_BEFORE must be an ISO 8601 date-time or epoch seconds");
  }
  return { passcode, secret, notBefore };
}

/** `readAccessConfig`, with an invalid config reported as null so callers fail closed. */
export function accessConfigOrNull(): AccessConfig | null {
  try {
    return readAccessConfig();
  } catch {
    return null;
  }
}
