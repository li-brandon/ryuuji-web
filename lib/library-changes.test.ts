import { afterEach, expect, it, vi } from "vitest";
import { LIBRARY_CHANGED, notifyLibraryChanged, useLibraryChanges } from "./library-changes";

// Runs the hook's effect directly: there's no DOM renderer in these tests.
const effects = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }));
vi.mock("react", () => ({
  useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) effects.cleanups.push(cleanup); },
}));

afterEach(() => { effects.cleanups.splice(0).forEach((cleanup) => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("notifies this tab with an event and other tabs over the channel", async () => {
  vi.stubGlobal("window", new EventTarget());
  const local = vi.fn();
  window.addEventListener(LIBRARY_CHANGED, local);
  const other = new BroadcastChannel(LIBRARY_CHANGED);
  const received = new Promise((resolve) => other.addEventListener("message", (message) => resolve(message.data), { once: true }));
  notifyLibraryChanged();
  expect(local).toHaveBeenCalledOnce();
  expect(await received).toBe("changed");
  other.close();
});

it("reloads on notices, runs one more reload for a burst and stops after cleanup", async () => {
  vi.stubGlobal("window", new EventTarget());
  const gates: PromiseWithResolvers<void>[] = [];
  const reload = vi.fn(() => { const gate = Promise.withResolvers<void>(); gates.push(gate); return gate.promise; });
  useLibraryChanges(reload);
  const notice = () => window.dispatchEvent(new Event(LIBRARY_CHANGED));
  notice();
  notice();
  notice();
  expect(reload).toHaveBeenCalledOnce();
  gates[0].resolve();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  gates[1].reject(new Error("read failed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reload).toHaveBeenCalledTimes(2);
  notice();
  expect(reload).toHaveBeenCalledTimes(3);
  gates[2].resolve();
  effects.cleanups.splice(0).forEach((cleanup) => cleanup());
  await new Promise((resolve) => setTimeout(resolve, 0));
  notice();
  expect(reload).toHaveBeenCalledTimes(3);
});
