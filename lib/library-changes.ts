"use client";

import { useEffect } from "react";

export const LIBRARY_CHANGED = "ryuuji-library";

export function useLibraryChanges(reload: () => Promise<unknown>) {
  useEffect(() => {
    const listener = () => { void reload().catch(() => {}); };
    window.addEventListener(LIBRARY_CHANGED, listener);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(LIBRARY_CHANGED);
    channel?.addEventListener("message", listener);
    return () => {
      window.removeEventListener(LIBRARY_CHANGED, listener);
      channel?.close();
    };
  }, [reload]);
}

/** Notification errors must not turn a committed import into a reported failure. */
export function notifyLibraryChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LIBRARY_CHANGED));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(LIBRARY_CHANGED);
      try { channel.postMessage("changed"); } finally { channel.close(); }
    } catch { /* Data has already committed. */ }
  }
}
