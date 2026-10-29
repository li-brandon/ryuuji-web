"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "./ui/Button";
import { LIBRARY_CHANGED } from "@/lib/library-changes";
import { RefreshScheduler, type RefreshState } from "@/lib/refresh-scheduler";
import { libraryRepository } from "@/lib/storage";

const Context = createContext<RefreshScheduler | null>(null);
const initial: RefreshState = { running: false, lastRun: null, message: "" };
const emptySubscribe = () => () => {};
const initialSnapshot = () => initial;

export function MetadataRefreshProvider({ children }: { children: React.ReactNode }) {
  const [scheduler, setScheduler] = useState<RefreshScheduler | null>(null);
  useEffect(() => {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(LIBRARY_CHANGED);
    const instance = new RefreshScheduler({
      repository: libraryRepository, storage: localStorage, document, window,
      online: () => navigator.onLine, locks: navigator.locks,
      changed: () => {
        window.dispatchEvent(new Event(LIBRARY_CHANGED));
        channel?.postMessage("changed");
      },
    });
    let active = true;
    queueMicrotask(() => { if (active) setScheduler(instance); });
    instance.start();
    return () => { active = false; instance.stop(); channel?.close(); };
  }, []);
  return <Context.Provider value={scheduler}>{children}</Context.Provider>;
}

function relativeTime(last: number | null) {
  if (last === null) return "Never refreshed";
  const minutes = Math.max(0, Math.floor((Date.now() - last) / 60000));
  if (minutes < 1) return "Last refreshed just now";
  if (minutes < 60) return `Last refreshed ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last refreshed ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Last refreshed ${days} day${days === 1 ? "" : "s"} ago`;
}

export function MetadataSettings() {
  const scheduler = useContext(Context);
  const state = useSyncExternalStore(scheduler?.subscribe ?? emptySubscribe, scheduler?.getSnapshot ?? initialSnapshot, initialSnapshot);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  return <section className="section" aria-labelledby="metadata-heading">
    <h2 id="metadata-heading">Metadata</h2>
    <p>{relativeTime(state.lastRun)}</p>
    <Button className="self-start" disabled={!scheduler || state.running} onClick={() => void scheduler?.refresh()}>Refresh now</Button>
    <p role="status" aria-live="polite">{state.message}</p>
  </section>;
}
