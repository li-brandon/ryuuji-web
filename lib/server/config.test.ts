import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { AccessConfigError, exitOnInvalidAccessConfig, readAccessConfig } from "./config";

vi.mock("server-only", () => ({}));

const PASSCODE = "sixteen chars ok";
const SECRET = "test-session-secret-0123456789ab";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

  it("parses RYUUJI_SESSION_NOT_BEFORE as ISO date-time with a timezone or epoch seconds", () => {
    const env = (notBefore: string) => ({ RYUUJI_PASSCODE: PASSCODE, RYUUJI_SESSION_SECRET: SECRET, RYUUJI_SESSION_NOT_BEFORE: notBefore });
    expect(readAccessConfig(env("2026-10-29T12:00:00Z"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env("2026-10-29T12:00:00.500Z"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env("2026-10-29T12:00Z"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env("2026-10-29T14:00:00+02:00"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env("2026-10-29T07:00:00-05:00"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env("1793275200"))?.notBefore).toBe(1_793_275_200);
    expect(readAccessConfig(env(" "))?.notBefore).toBe(0);
    for (const bad of ["2026-10-29", "yesterday", "-5", "1.5", "2026-13-01T00:00:00Z"]) {
      expect(() => readAccessConfig(env(bad)), bad).toThrow(/NOT_BEFORE/);
    }
  });

  it("rejects RYUUJI_SESSION_NOT_BEFORE without a timezone", () => {
    const env = (notBefore: string) => ({ RYUUJI_PASSCODE: PASSCODE, RYUUJI_SESSION_SECRET: SECRET, RYUUJI_SESSION_NOT_BEFORE: notBefore });
    for (const bad of ["2026-10-29T12:00:00", "2026-10-29T12:00", "2026-10-29T12:00:00.500", "2026-10-29", "2026-10-29T12:00:00+0200"]) {
      expect(() => readAccessConfig(env(bad)), bad).toThrow(
        new AccessConfigError(
          "RYUUJI_SESSION_NOT_BEFORE must be an ISO 8601 date-time with a timezone (Z or ±HH:MM) or epoch seconds",
        ),
      );
    }
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

describe("exitOnInvalidAccessConfig", () => {
  it("logs one line naming the variable, never its value, and exits with 1", () => {
    const secretPasscode = "fifteen chars!!";
    const exit = vi.fn();
    const log = vi.fn();
    exitOnInvalidAccessConfig(exit, log, { RYUUJI_PASSCODE: secretPasscode, RYUUJI_SESSION_SECRET: SECRET });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(log).toHaveBeenCalledOnce();
    const [line] = log.mock.calls[0];
    expect(line).toContain("RYUUJI_PASSCODE");
    expect(line).not.toContain(secretPasscode);
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain("\n");
  });

  it("names RYUUJI_SESSION_SECRET and RYUUJI_SESSION_NOT_BEFORE without their values", () => {
    const exit = vi.fn();
    const log = vi.fn();
    const shortSecret = "short-session-secret";
    exitOnInvalidAccessConfig(exit, log, { RYUUJI_PASSCODE: PASSCODE, RYUUJI_SESSION_SECRET: shortSecret });
    exitOnInvalidAccessConfig(exit, log, {
      RYUUJI_PASSCODE: PASSCODE,
      RYUUJI_SESSION_SECRET: SECRET,
      RYUUJI_SESSION_NOT_BEFORE: "2026-10-29T12:00:00",
    });
    expect(exit.mock.calls).toEqual([[1], [1]]);
    expect(log.mock.calls[0][0]).toContain("RYUUJI_SESSION_SECRET");
    expect(log.mock.calls[1][0]).toContain("RYUUJI_SESSION_NOT_BEFORE");
    for (const [line] of log.mock.calls) {
      for (const value of [PASSCODE, SECRET, shortSecret, "2026-10-29T12:00:00"]) expect(line).not.toContain(value);
    }
  });

  it("does not exit with a valid config or with access unset", () => {
    const exit = vi.fn();
    const log = vi.fn();
    exitOnInvalidAccessConfig(exit, log, { RYUUJI_PASSCODE: PASSCODE, RYUUJI_SESSION_SECRET: SECRET });
    exitOnInvalidAccessConfig(exit, log, {});
    exitOnInvalidAccessConfig(exit, log, { RYUUJI_PASSCODE: "", RYUUJI_SESSION_SECRET: "short" });
    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe("instrumentation register", () => {
  const stubExit = () => vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const stubStderr = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("exits the Node.js server with 1 on an invalid config, logging the variable but not its value", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("RYUUJI_PASSCODE", "fifteen chars!!");
    vi.stubEnv("RYUUJI_SESSION_SECRET", SECRET);
    const exit = stubExit();
    const stderr = stubStderr();
    await register();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      "Invalid server config, refusing to start: RYUUJI_PASSCODE must be at least 16 characters",
    );
    expect(String(stderr.mock.calls[0][0])).not.toContain("fifteen chars!!");
  });

  it("does not exit the Node.js server with a valid config or with access unset", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const exit = stubExit();
    const stderr = stubStderr();
    vi.stubEnv("RYUUJI_PASSCODE", PASSCODE);
    vi.stubEnv("RYUUJI_SESSION_SECRET", SECRET);
    await expect(register()).resolves.toBeUndefined();
    vi.stubEnv("RYUUJI_PASSCODE", "");
    vi.stubEnv("RYUUJI_SESSION_SECRET", "");
    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("never exits outside the Node.js runtime; it throws instead", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const exit = stubExit();
    vi.stubEnv("RYUUJI_PASSCODE", PASSCODE);
    vi.stubEnv("RYUUJI_SESSION_SECRET", "");
    await expect(register()).rejects.toThrow(AccessConfigError);
    expect(exit).not.toHaveBeenCalled();
  });

  it("refuses to start with a short passcode outside Node.js", async () => {
    vi.stubEnv("NEXT_RUNTIME", "");
    vi.stubEnv("RYUUJI_PASSCODE", "fifteen chars!!");
    vi.stubEnv("RYUUJI_SESSION_SECRET", SECRET);
    await expect(register()).rejects.toThrow("RYUUJI_PASSCODE must be at least 16 characters");
  });

  it("refuses to start without a session secret when the passcode is set outside Node.js", async () => {
    vi.stubEnv("NEXT_RUNTIME", "");
    const exit = stubExit();
    vi.stubEnv("RYUUJI_PASSCODE", PASSCODE);
    vi.stubEnv("RYUUJI_SESSION_SECRET", "");
    await expect(register()).rejects.toThrow(AccessConfigError);
    expect(exit).not.toHaveBeenCalled();
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
