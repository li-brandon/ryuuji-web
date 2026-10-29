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
