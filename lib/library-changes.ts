"use client";

import { useEffect } from "react";

export const LIBRARY_CHANGED = "ryuuji-library";

/**
 * Calls `reload` whenever the library changes in this tab or another one. `reload` must only read:
 * a write would notify again. Overlapping notices run at most one more reload after the current
 * one, so a burst can't apply an older read after a newer one.
 */
export function useLibraryChanges(reload: () => Promise<unknown>) {
  useEffect(() => {
    let running = false;
    let again = false;
    const run = async () => {
      running = true;
      try {
        do {
          again = false;
          await reload().catch(() => {});
        } while (again);
      } finally {
        running = false;
      }
    };
    const listener = () => {
      if (running) again = true;
      else void run();
    };
    window.addEventListener(LIBRARY_CHANGED, listener);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(LIBRARY_CHANGED);
    channel?.addEventListener("message", listener);
    return () => {
      window.removeEventListener(LIBRARY_CHANGED, listener);
      channel?.close();
    };
  }, [reload]);
}

/** Call only after a write commits. Notification errors must not turn a committed write into a reported failure. */
export function notifyLibraryChanged() {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(LIBRARY_CHANGED));
  } catch { /* Data has already committed. */ }
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(LIBRARY_CHANGED);
      try { channel.postMessage("changed"); } finally { channel.close(); }
    } catch { /* Data has already committed. */ }
  }
}
