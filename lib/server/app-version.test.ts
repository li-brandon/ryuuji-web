import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "./app-version";

vi.mock("server-only", () => ({}));

describe("APP_VERSION", () => {
  it("is package.json's version", () => {
    const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
