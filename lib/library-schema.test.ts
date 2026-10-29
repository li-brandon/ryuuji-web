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

it.each(["Returning Series", "Ended", "Canceled", "In Production", "Planned", "Pilot", "Unknown"])("accepts ShowStatus %s", (showStatus) => {
  expect(parseLibraryFile({ ...example, titles: [{ ...example.titles[0], showStatus }] }).titles[0].showStatus).toBe(showStatus);
});

it.each([
  [], ["titles", 0], ["titles", 0, "episodes"],
  ["titles", 0, "episodes", "seasons", 0],
  ["titles", 0, "episodes", "seasons", 0, "episodes", 0],
  ["titles", 0, "providerData"], ["titles", 0, "providerData", "providers", 0],
  ["titles", 0, "watchEvents", 0],
])("rejects unknown fields at path %j", (...path) => {
  const input = structuredClone(example);
  let target = input;
  for (const key of path) target = target[key];
  target.extra = true;
  expect(() => parseLibraryFile(input)).toThrow();
  try { parseLibraryFile(input); } catch (error) {
    expect(error).toMatchObject({ issues: [expect.objectContaining({ path, keys: ["extra"] })] });
  }
});

it.each([
  { uid: "bad" }, { watchedAt: "bad" }, { season: "1" },
  { episode: 1.5 }, { tmdbEpisodeId: "id" }, { batchId: "bad" },
])("validates nested watch events: %j", (changes) => {
  const input = structuredClone(example);
  Object.assign(input.titles[0].watchEvents[0], changes);
  expect(() => parseLibraryFile(input)).toThrow();
});

it("reports duplicate titles and event uids, including across titles", () => {
  const input = structuredClone(example);
  input.titles.push(structuredClone(input.titles[0]));
  input.titles[1].watchEvents.push(structuredClone(input.titles[0].watchEvents[0]));
  expect(() => parseLibraryFile(input)).toThrow();
  try { parseLibraryFile(input); } catch (error) {
    expect(error).toMatchObject({ issues: expect.arrayContaining([
      expect.objectContaining({ path: ["titles", 2], message: "Duplicate title show:1399" }),
      expect.objectContaining({ path: ["titles", 1, "watchEvents", 0, "uid"] }),
      expect.objectContaining({ path: ["titles", 2, "watchEvents", 0, "uid"] }),
    ]) });
  }
});

it("rejects duplicate event uids within a title", () => {
  const input = structuredClone(example);
  input.titles[0].watchEvents.push(structuredClone(input.titles[0].watchEvents[0]));
  expect(() => parseLibraryFile(input)).toThrow("Duplicate event uid");
});
