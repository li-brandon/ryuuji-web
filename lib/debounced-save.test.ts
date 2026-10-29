import { afterEach, describe, expect, it, vi } from "vitest";
import { debouncedSave } from "./debounced-save";

type Listener = (event: never) => void;
function fakeTarget() {
  const make = () => {
    const listeners = new Map<string, Set<Listener>>();
    return {
      listeners,
      addEventListener: (type: string, fn: Listener) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
      removeEventListener: (type: string, fn: Listener) => void listeners.get(type)?.delete(fn),
      fire: (type: string, event: object = {}) => listeners.get(type)?.forEach((fn) => fn(event as never)),
    };
  };
  const win = make();
  const document = { ...make(), visibilityState: "visible" as DocumentVisibilityState };
  return { win, document, target: { ...win, document } as unknown as Window };
}

describe("debouncedSave", () => {
  afterEach(() => vi.useRealTimers());

  it("saves the latest value once after the delay", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const { target } = fakeTarget();
    const notes = debouncedSave(save, 600, target);
    notes.schedule("a");
    notes.schedule("ab");
    expect(notes.pending()).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledExactlyOnceWith("ab");
    expect(notes.pending()).toBe(false);
  });

  it("flushes a pending save on pagehide", () => {
    const save = vi.fn(async () => {});
    const { win, target } = fakeTarget();
    debouncedSave(save, 600, target).schedule("typed");
    win.fire("pagehide");
    expect(save).toHaveBeenCalledExactlyOnceWith("typed");
  });

  it("flushes a pending save when the page becomes hidden, not when visible", () => {
    const save = vi.fn(async () => {});
    const { document, target } = fakeTarget();
    debouncedSave(save, 600, target).schedule("typed");
    document.fire("visibilitychange");
    expect(save).not.toHaveBeenCalled();
    document.visibilityState = "hidden";
    document.fire("visibilitychange");
    expect(save).toHaveBeenCalledExactlyOnceWith("typed");
  });

  it("warns on beforeunload only while a save is pending", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { win, target } = fakeTarget();
    const notes = debouncedSave(save, 600, target);

    const idle = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    win.fire("beforeunload", idle);
    expect(idle.preventDefault).not.toHaveBeenCalled();

    notes.schedule("typed");
    const pending = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    win.fire("beforeunload", pending);
    expect(pending.preventDefault).toHaveBeenCalled();
    expect(pending.returnValue).toBe("");
    expect(save).toHaveBeenCalledExactlyOnceWith("typed");

    finish();
    await Promise.resolve();
    await Promise.resolve();
    const after = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    win.fire("beforeunload", after);
    expect(after.preventDefault).not.toHaveBeenCalled();
  });

  it("dispose flushes and removes listeners", () => {
    const save = vi.fn(async () => {});
    const { win, document, target } = fakeTarget();
    const notes = debouncedSave(save, 600, target);
    notes.schedule("typed");
    notes.dispose();
    expect(save).toHaveBeenCalledExactlyOnceWith("typed");
    expect([...win.listeners.values()].every((s) => s.size === 0)).toBe(true);
    expect([...document.listeners.values()].every((s) => s.size === 0)).toBe(true);
  });
});
