/**
 * Runs at most `max` tasks at once; the rest wait in FIFO order. A queued task whose signal aborts
 * before it starts is dropped (its promise rejects with the abort reason); a started task always finishes.
 */
export function createLimiter(max: number) {
  if (!Number.isInteger(max) || max < 1) throw new RangeError("Limiter needs at least one slot");
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    while (active < max && queue.length) queue.shift()?.();
  };
  return function limit<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        const index = queue.indexOf(start);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(signal?.reason);
      };
      const start = () => {
        signal?.removeEventListener("abort", onAbort);
        active++;
        new Promise<T>((run) => run(task())).then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      queue.push(start);
      next();
    });
  };
}
