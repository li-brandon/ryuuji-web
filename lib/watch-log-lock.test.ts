import { afterEach, expect, it, vi } from "vitest";
import { withWatchLogLock } from "./watch-log-lock";

afterEach(() => vi.unstubAllGlobals());

it("serializes without Web Locks and broadcasts only after success", async () => {
  vi.stubGlobal("navigator", {});
  const order: string[] = [];
  const postMessage = vi.fn(() => order.push("notice"));
  const close = vi.fn();
  vi.stubGlobal("BroadcastChannel", class {
    constructor(readonly name: string) { expect(name).toBe("ryuuji-library"); }
    postMessage = postMessage;
    close = close;
  });
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const first = withWatchLogLock(async () => {
    order.push("first");
    started.resolve();
    await gate.promise;
    order.push("done");
    return 42;
  });
  const second = withWatchLogLock(async () => { order.push("second"); });
  await started.promise;
  expect(order).toEqual(["first"]);
  gate.resolve();
  expect(await first).toBe(42);
  await second;
  expect(order).toEqual(["first", "done", "notice", "second", "notice"]);
  expect(close).toHaveBeenCalledTimes(2);
  await expect(withWatchLogLock(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  await expect(withWatchLogLock(async () => "recovered")).resolves.toBe("recovered");
  expect(postMessage).toHaveBeenCalledTimes(3);
});
