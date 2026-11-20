/**
 * Orders overlapping async reads by when they started, not when they finished. Call `start()` as a
 * read begins (or as a local write is applied) and pass the sequence to `apply`: it runs `update`
 * only if nothing that started later has already applied, so an older snapshot can't overwrite a
 * newer one.
 */
export type ReadOrder = { start: () => number; apply: (seq: number, update: () => void) => boolean };

export function readOrder(): ReadOrder {
  let started = 0;
  let applied = 0;
  return {
    start: () => ++started,
    apply: (seq, update) => {
      if (seq <= applied) return false;
      applied = seq;
      update();
      return true;
    },
  };
}
