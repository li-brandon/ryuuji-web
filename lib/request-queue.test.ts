import { describe, expect, it } from "vitest";
import { createLimiter } from "./request-queue";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLimiter", () => {
  it("never runs more than max tasks and starts the rest in FIFO order", async () => {
    const limit = createLimiter(2);
    const gates = Array.from({ length: 5 }, () => deferred());
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const results = gates.map((gate, i) => limit(async () => {
      started.push(i);
      peak = Math.max(peak, ++active);
      await gate.promise;
      active--;
      return i;
    }));
    await flush();
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);
    for (const gate of gates) gate.resolve();
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4]);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it("frees the slot when a task rejects or throws", async () => {
    const limit = createLimiter(1);
    const failed = limit(() => Promise.reject(new Error("offline")));
    const threw = limit(() => { throw new Error("sync"); });
    const after = limit(async () => "ran");
    await expect(failed).rejects.toThrow("offline");
    await expect(threw).rejects.toThrow("sync");
    await expect(after).resolves.toBe("ran");
  });

  it("drops queued tasks whose signal aborts before they start", async () => {
    const limit = createLimiter(1);
    const gate = deferred();
    const ran: string[] = [];
    const first = limit(async () => { ran.push("first"); await gate.promise; });
    const controller = new AbortController();
    const skipped = limit(async () => { ran.push("skipped"); }, controller.signal);
    const last = limit(async () => { ran.push("last"); });
    controller.abort();
    await expect(skipped).rejects.toThrow();
    const alreadyAborted = limit(async () => { ran.push("never"); }, controller.signal);
    await expect(alreadyAborted).rejects.toThrow();
    gate.resolve();
    await Promise.all([first, last]);
    expect(ran).toEqual(["first", "last"]);
  });

  it("lets a started task finish even if its signal aborts", async () => {
    const limit = createLimiter(1);
    const gate = deferred();
    const controller = new AbortController();
    const running = limit(async () => { await gate.promise; return "done"; }, controller.signal);
    await flush();
    controller.abort();
    gate.resolve();
    await expect(running).resolves.toBe("done");
  });

  it("rejects invalid limits", () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
  });
});
