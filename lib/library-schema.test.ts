import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLibraryFile } from "./library-schema";

// The documented example doubles as the fixture, so the docs can't drift from the schema.
const example = JSON.parse(
  readFileSync(new URL("../docs/library-schema.md", import.meta.url), "utf8").match(/```json\n([\s\S]*?)```/)![1],
);

describe("parseLibraryFile", () => {
  it("accepts the documented example", () => {
    const file = parseLibraryFile(example);
    expect(file.titles[0].watchEvents).toHaveLength(1);
    // Omitted optional fields parse as null.
    expect(file.titles[1].episodes).toBeNull();
  });

  it("rejects an unknown schema version", () => {
    expect(() => parseLibraryFile({ ...example, schemaVersion: 2 })).toThrow();
  });

  it("rejects another format", () => {
    expect(() => parseLibraryFile({ ...example, format: "other" })).toThrow();
  });

  it("rejects bad enum values", () => {
    const withTitle = (changes: object) => ({ ...example, titles: [{ ...example.titles[0], ...changes }] });
    expect(() => parseLibraryFile(withTitle({ kind: "tv" }))).toThrow();
    expect(() => parseLibraryFile(withTitle({ status: "plan_to_watch" }))).toThrow();
    expect(() => parseLibraryFile(withTitle({ showStatus: "Returning" }))).toThrow();
  });
});
