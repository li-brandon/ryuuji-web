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
afterEach(() => { vi.restoreAllMocks(); connections.splice(0).forEach((db) => db.close()); });

it("imports the real exporter fixture, previews counts, broadcasts under lock and reimports without writes", async () => {
  const { repo } = await setup();
  const locked = vi.spyOn(lock, "withWatchLogLock");
  const posted = vi.spyOn(BroadcastChannel.prototype, "postMessage");
  const plan = await previewImport(repo, JSON.stringify(fixture));
  expect(plan.counts).toEqual({ titlesToAdd: 3, titlesToMerge: 0, titlesUnchanged: 0, eventsToAdd: 3, eventsAlreadyPresent: 0, conflicts: 0, invalid: 0 });
  await repo.importLibrary(plan);
  expect(locked).toHaveBeenCalledOnce(); expect(posted).toHaveBeenCalledWith("changed");
  const exported = await exportLibrary(repo, new Date(fixture.exportedAt));
  expect(exported).toEqual({ ...readLibraryFile(fixture), exportedAt: new Date(fixture.exportedAt).toISOString() });
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
  await repo.importLibrary(conflict);
  expect(await repo.getWatchEvent(watchEvents[0].uid)).toMatchObject({ watchedAt: originalWatchedAt });
  expect(await repo.getTitle(title)).toMatchObject({ notes: "My notes", score: 7, status: "dropped" });
});

it("rolls back both stores if a later request fails", async () => {
  const { repo } = await setup(); const plan = await previewImport(repo, fixture);
  vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new Error("disk failure"); });
  await expect(repo.importLibrary(plan)).rejects.toThrow("disk failure");
  expect(await repo.librarySnapshot()).toEqual({ titles: [], events: [] });
});

it("recomputes stale previews without overwriting newer choices", async () => {
  const { repo } = await setup(); const plan = await previewImport(repo, fixture);
  const title = (await import("./types")).titleSchema.parse(Object.fromEntries(Object.entries(plan.file.titles[0]).filter(([key]) => key !== "watchEvents")));
  await repo.createTitle({ ...title, notes: "Changed during preview" });
  await repo.importLibrary(plan);
  expect((await repo.getTitle(title))?.notes).toBe("Changed during preview");
});
