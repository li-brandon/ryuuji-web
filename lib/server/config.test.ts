import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { AccessConfigError, readAccessConfig } from "./config";

vi.mock("server-only", () => ({}));

const PASSCODE = "sixteen chars ok";
const SECRET = "test-session-secret-0123456789ab";

afterEach(() => vi.unstubAllEnvs());

describe("readAccessConfig", () => {
  it("is null (access disabled) when the passcode is unset", () => {
    expect(readAccessConfig({})).toBeNull();
    expect(readAccessConfig({ RYUUJI_PASSCODE: "", RYUUJI_SESSION_SECRET: "short" })).toBeNull();
  });

  it("refuses a passcode under 16 characters", () => {
    expect(() => readAccessConfig({ RYUUJI_PASSCODE: "fifteen chars!!", RYUUJI_SESSION_SECRET: SECRET })).toThrow(
      new AccessConfigError("RYUUJI_PASSCODE must be at least 16 characters"),
    );
    expect(readAccessConfig({ RYUUJI_PASSCODE: PASSCODE, RYUUJI_SESSION_SECRET: SECRET })).toEqual({
      passcode: PASSCODE,
      secret: SECRET,
      notBefore: 0,
    });
  });

  it("requires a session secret of at least 32 characters", () => {
    expect(() => readAccessConfig({ RYUUJI_PASSCODE: PASSCODE })).toThrow(/RYUUJI_SESSION_SECRET must be set/);
    expect(() => readAccessConfig({ RYUUJI_PASSCODE: PASSCODE, RYUUJI_SESSION_SECRET: SECRET.slice(1) })).toThrow(
      AccessConfigError,
    );
  });

  it("parses RYUUJI_SESSION_NOT_BEFORE as ISO date-time or epoch seconds", () => {
    const env = (notBefore: string) => ({ RYUUJI_PASSCODE: PASSCODE, RYUUJI_SESSION_SECRET: SECRET, RYUUJI_SESSION_NOT_BEFORE: notBefore });
    expect(readAccessConfig(env("2026-10-29T12:00:00Z"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env("2026-10-29T14:00:00+02:00"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env("1793275200"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env(" "))?.notBefore).toBe(0);
    for (const bad of ["2026-10-29", "yesterday", "-5", "1.5"]) expect(() => readAccessConfig(env(bad)), bad).toThrow(/NOT_BEFORE/);
  });

  it("never puts secret values in error messages", () => {
    const passcode = "short-but-secret";
    try {
      readAccessConfig({ RYUUJI_PASSCODE: passcode.slice(0, 15), RYUUJI_SESSION_SECRET: SECRET });
    } catch (error) {
      expect(String(error)).not.toContain(passcode.slice(0, 15));
    }
  });
});

describe("instrumentation register", () => {
  it("refuses to start with a short passcode", async () => {
    vi.stubEnv("RYUUJI_PASSCODE", "fifteen chars!!");
    vi.stubEnv("RYUUJI_SESSION_SECRET", SECRET);
    await expect(register()).rejects.toThrow("RYUUJI_PASSCODE must be at least 16 characters");
  });

  it("refuses to start without a session secret when the passcode is set", async () => {
    vi.stubEnv("RYUUJI_PASSCODE", PASSCODE);
    vi.stubEnv("RYUUJI_SESSION_SECRET", "");
    await expect(register()).rejects.toThrow(AccessConfigError);
  });

  it("starts with a valid config or with access unset", async () => {
    vi.stubEnv("RYUUJI_PASSCODE", PASSCODE);
    vi.stubEnv("RYUUJI_SESSION_SECRET", SECRET);
    await expect(register()).resolves.toBeUndefined();
    vi.stubEnv("RYUUJI_PASSCODE", "");
    vi.stubEnv("RYUUJI_SESSION_SECRET", "");
    await expect(register()).resolves.toBeUndefined();
  });
});
