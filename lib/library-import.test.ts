import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import fixture from "../test/fixtures/macos-library-export.json";
import { exportLibrary, previewImport, readLibraryFile } from "./library-import";
import { LibraryRepository, openLibraryDB } from "./storage";
import * as lock from "./watch-log-lock";

const connections: Awaited<ReturnType<typeof openLibraryDB>>[] = [];
async function setup() {
  const db = await openLibraryDB(crypto.randomUUID()); connections.push(db);
  return { db, repo: new LibraryRepository(db) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); connections.splice(0).forEach((db) => db.close()); });

it("imports the real exporter fixture, previews counts, broadcasts under lock and reimports without writes", async () => {
  const { repo } = await setup();
  const locked = vi.spyOn(lock, "withWatchLogLock");
  const posted = vi.spyOn(BroadcastChannel.prototype, "postMessage");
  const plan = await previewImport(repo, JSON.stringify(fixture));
  expect(plan.counts).toEqual({ titlesToAdd: 3, titlesToMerge: 0, titlesUnchanged: 0, eventsToAdd: 3, eventsAlreadyPresent: 0, conflicts: 0 });
  await repo.importLibrary(plan);
  expect(locked).toHaveBeenCalledOnce(); expect(posted).toHaveBeenCalledWith("changed");
  const exported = await exportLibrary(repo, new Date(fixture.exportedAt));
  expect(exported).toEqual({ ...readLibraryFile(fixture), exportedAt: new Date(fixture.exportedAt).toISOString(), settings: exported.settings });
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  const add = vi.spyOn(IDBObjectStore.prototype, "add");
  const second = await previewImport(repo, fixture);
  expect(second.counts.titlesUnchanged).toBe(3); expect(second.counts.eventsAlreadyPresent).toBe(3);
  await repo.importLibrary(second);
  expect(put).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
});

it.each([
  ["bad JSON", "{", /valid JSON/],
  ["unknown field", { ...fixture, secret: "no" }, /Unrecognized/],
  ["new version", { ...fixture, schemaVersion: 2 }, /newer version/],
  ["wrong format", { ...fixture, format: "other" }, /wrong format/],
  ["duplicate UID", { ...fixture, titles: fixture.titles.map((t, i) => i ? t : { ...t, watchEvents: [...t.watchEvents, ...t.watchEvents] }) }, /Duplicate event/],
])("rejects %s without changing populated storage", async (_name, invalid, message) => {
  const { repo } = await setup(); await repo.importLibrary(await previewImport(repo, fixture));
  const before = await repo.librarySnapshot();
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  await expect(previewImport(repo, invalid)).rejects.toThrow(message);
  expect(await repo.librarySnapshot()).toEqual(before); expect(put).not.toHaveBeenCalled();
});

it("round-trips every field into an empty store", async () => {
  browserSettings();
  const { repo } = await setup(); const { repo: restored } = await setup();
  await repo.importLibrary(await previewImport(repo, fixture));
  const backup = await exportLibrary(repo);
  await restored.importLibrary(await previewImport(restored, JSON.stringify(backup)));
  expect(await restored.librarySnapshot()).toEqual(await repo.librarySnapshot());
});

it("fills defaults, preserves choices and metadata, and reports UID conflicts", async () => {
  const { repo } = await setup(); const file = readLibraryFile(fixture);
  const { watchEvents, ...title } = file.titles[0];
  await repo.createTitle({ ...title, status: "planToWatch", score: null, notes: "", name: "My name" });
  const plan = await previewImport(repo, file); expect(plan.counts.titlesToMerge).toBe(1);
  await repo.importLibrary(plan);
  expect(await repo.getTitle(title)).toMatchObject({ status: title.status, score: title.score, notes: title.notes, name: "My name" });
  await repo.updateTitle(title, { notes: "My notes", score: 7, status: "dropped" });
  const originalWatchedAt = watchEvents[0].watchedAt;
  file.titles[0].watchEvents[0].watchedAt = "2025-01-01T00:00:00Z";
  const conflict = await previewImport(repo, file); expect(conflict.counts.conflicts).toBe(1);
  expect(conflict.titleDiffs[0].discarded).toContainEqual({ field: `watchEvents.${watchEvents[0].uid}.watchedAt`, value: "2025-01-01T00:00:00Z", reason: "Existing event with this UID is retained." });
  await repo.importLibrary(conflict);
  expect(await repo.getWatchEvent(watchEvents[0].uid)).toMatchObject({ watchedAt: originalWatchedAt });
  expect(await repo.getTitle(title)).toMatchObject({ notes: title.notes, score: title.score, status: title.status });
});

it("rolls back both stores if a later request fails", async () => {
  const { repo } = await setup(); const plan = await previewImport(repo, fixture);
  vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new Error("disk failure"); });
  await expect(repo.importLibrary(plan)).rejects.toThrow("disk failure");
  expect(await repo.librarySnapshot()).toEqual({ titles: [], events: [] });
});

it("recomputes stale previews using the timestamp-free incoming-wins fallback", async () => {
  const { repo } = await setup(); const plan = await previewImport(repo, fixture);
  const title = (await import("./types")).titleSchema.parse(Object.fromEntries(Object.entries(plan.file.titles[0]).filter(([key]) => key !== "watchEvents")));
  await repo.createTitle({ ...title, notes: "Changed during preview" });
  await repo.importLibrary(plan);
  expect((await repo.getTitle(title))?.notes).toBe(title.notes);
});

it.each([
  { notes: "Incoming notes", score: 0, status: "planToWatch" as const },
  { notes: " \n ", score: null, status: "watching" as const },
])("previews all changed and discarded fields with the timestamp-free fallback: %j", async (choices) => {
  const { repo } = await setup();
  const file = readLibraryFile(fixture);
  const incoming = (await import("./types")).titleSchema.parse(Object.fromEntries(Object.entries(file.titles[0]).filter(([key]) => key !== "watchEvents")));
  const local = { ...incoming, notes: "Local notes", score: 7, status: "dropped" as const, name: "Local name" };
  await repo.createTitle(local);
  Object.assign(file.titles[0], choices);
  // Creation and metadata refresh times must not be mistaken for edit times.
  await repo.updateTitle(local, { addedAt: "2099-01-01T00:00:00Z", lastRefreshedAt: "2099-01-01T00:00:00Z" });
  const plan = await previewImport(repo, file);
  const diff = plan.titleDiffs[0];
  expect(diff.changes).toEqual(expect.arrayContaining([
    { field: "status", oldValue: "dropped", newValue: choices.status },
    ...(choices.score !== null ? [{ field: "score", oldValue: 7, newValue: 0 }] : []),
    ...(choices.notes.trim() ? [{ field: "notes", oldValue: "Local notes", newValue: choices.notes }] : []),
  ]));
  expect(diff.discarded).toEqual(expect.arrayContaining([
    { field: "name", value: incoming.name, reason: "Existing metadata is retained." },
    expect.objectContaining({ field: "status", value: "dropped", reason: expect.stringContaining("no modification timestamps") }),
    expect.objectContaining({ field: "notes", value: choices.notes.trim() ? "Local notes" : choices.notes }),
    expect.objectContaining({ field: "score", value: choices.score !== null ? 7 : null }),
  ]));
  expect(diff.changes.map((change) => change.field).sort()).toEqual(choices.score !== null ? ["notes", "score", "status"] : ["status"]);
  await repo.importLibrary(plan);
  expect(await repo.getTitle(local)).toMatchObject({
    status: choices.status, score: choices.score ?? 7, notes: choices.notes.trim() ? choices.notes : "Local notes", name: "Local name",
  });
});

function browserSettings() {
  const values = new Map<string, string>();
  const events = new EventTarget();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal("window", events);
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  return { values, events };
}

it("exports current settings, previews changes, and restores through app change events", async () => {
  const { values, events } = browserSettings();
  const { repo } = await setup();
  values.set("ryuuji-theme", "light");
  values.set("ryuuji-watch-preferences", JSON.stringify({ region: "US", services: [9] }));
  expect((await exportLibrary(repo)).settings).toEqual({ theme: "light", watch: { region: "US", services: [9] } });
  const themeChange = vi.fn(); const watchChange = vi.fn();
  events.addEventListener("ryuuji-theme-change", themeChange);
  events.addEventListener("ryuuji-watch-preferences-change", watchChange);
  const settings = { theme: "dark", watch: { region: "JP", services: [8] } };
  const plan = await previewImport(repo, { ...fixture, settings });
  expect(plan.settingsChanges).toEqual([
    { field: "theme", oldValue: "light", newValue: "dark" },
    { field: "watch", oldValue: { region: "US", services: [9] }, newValue: settings.watch },
  ]);
  await repo.importLibrary(plan);
  expect(values.get("ryuuji-theme")).toBe("dark");
  expect(JSON.parse(values.get("ryuuji-watch-preferences") ?? "null")).toEqual(settings.watch);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(themeChange).toHaveBeenCalledOnce(); expect(watchChange).toHaveBeenCalledOnce();
  expect((await previewImport(repo, { ...fixture, settings })).settingsChanges).toEqual([]);
  await repo.importLibrary(await previewImport(repo, fixture));
  expect(values.get("ryuuji-theme")).toBe("dark");
});

it("does not restore settings when the database commit fails", async () => {
  const { values } = browserSettings(); const { repo } = await setup();
  values.set("ryuuji-theme", "light");
  const plan = await previewImport(repo, { ...fixture, settings: { theme: "dark" } });
  vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new Error("disk failure"); });
  await expect(repo.importLibrary(plan)).rejects.toThrow("disk failure");
  expect(values.get("ryuuji-theme")).toBe("light");
});
