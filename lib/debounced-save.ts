/**
 * Debounced save that can't silently drop the last edit: a pending value is flushed when the
 * page is hidden or unloaded (pagehide, visibilitychange → hidden), and beforeunload asks the
 * browser to warn while a save is still pending.
 */
export type DebouncedSave<T> = {
  schedule(value: T): void;
  flush(): Promise<void>;
  pending(): boolean;
  dispose(): void;
};

export function debouncedSave<T>(save: (value: T) => Promise<void>, delayMs: number, target: Window = window): DebouncedSave<T> {
  let value: { current: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = 0;

  async function flush() {
    clearTimeout(timer);
    if (!value) return;
    const next = value.current;
    value = null;
    inFlight++;
    try {
      await save(next);
    } finally {
      inFlight--;
    }
  }
  const onHide = () => void flush().catch(() => {});
  const onVisibility = () => {
    if (target.document.visibilityState === "hidden") onHide();
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!value && inFlight === 0) return;
    onHide();
    event.preventDefault();
    event.returnValue = "";
  };

  target.addEventListener("pagehide", onHide);
  target.document.addEventListener("visibilitychange", onVisibility);
  target.addEventListener("beforeunload", onBeforeUnload);

  return {
    schedule(next) {
      value = { current: next };
      clearTimeout(timer);
      timer = setTimeout(onHide, delayMs);
    },
    flush,
    pending: () => value !== null || inFlight > 0,
    dispose() {
      target.removeEventListener("pagehide", onHide);
      target.document.removeEventListener("visibilitychange", onVisibility);
      target.removeEventListener("beforeunload", onBeforeUnload);
      onHide();
    },
  };
}
