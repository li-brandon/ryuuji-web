"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QuickAddButton } from "@/components/QuickAdd";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow } from "@/components/ui/ListRow";
import { Poster } from "@/components/ui/Poster";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusPill } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { today } from "@/lib/air-date";
import { libraryRepository } from "@/lib/storage";
import { UndoStack } from "@/lib/undo-stack";
import { selectUpNext, type UpNextEntry } from "@/lib/up-next";
import { WatchLogService } from "@/lib/watch-log";
import styles from "./up-next.module.css";

async function loadLibrary() {
  const repo = await libraryRepository();
  return Promise.all((await repo.listTitles()).map(async (title) => ({ title, events: await repo.listWatchEvents(title) })));
}

export default function UpNextPage() {
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof loadLibrary>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const undoStack = useRef(new UndoStack());
  const service = useRef<WatchLogService | null>(null);
  const toast = useToast();
  const refresh = useCallback(async () => setLibrary(await loadLibrary()), []);

  useEffect(() => {
    let cancelled = false;
    void loadLibrary().then((loaded) => {
      if (!cancelled) setLibrary(loaded);
    }).catch(() => {
      if (!cancelled) setError("Couldn't load your library. Reload to try again.");
    });
    return () => { cancelled = true; };
  }, []);

  const undo = useCallback(async () => {
    if (lock.current || !undoStack.current.canUndo) return;
    lock.current = true;
    setBusy(true);
    try {
      await undoStack.current.undo();
      await refresh();
      toast({ message: "Log undone" });
    } catch {
      toast({ message: "Couldn't undo the log. Please try again." });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [refresh, toast]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest("input, textarea, select") || target.isContentEditable)) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z" && undoStack.current.canUndo) {
        event.preventDefault();
        void undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo]);

  async function log(entry: UpNextEntry) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      service.current ??= new WatchLogService(await libraryRepository());
      await service.current.log(entry.title, entry.next, undoStack.current);
      await refresh();
      toast({ message: `Logged S${entry.next.season}E${entry.next.number} of ${entry.title.name}`, actionLabel: "Undo", onAction: () => void undo() });
    } catch {
      toast({ message: "Couldn't save the log. Please try again." });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const entries = selectUpNext(library ?? [], today());
  return (
    <>
      <header className="page-header"><h1>Up Next</h1><p>The next episode of everything you’re watching.</p></header>
      {error ? <p role="alert">{error}</p> : library === null ? (
        <div role="status" aria-label="Loading Up Next" className={styles.loading}>
          {[1, 2, 3].map((n) => <Skeleton key={n} height={88} />)}
        </div>
      ) : (
        <>
          {entries.active.length > 0 && <ul className={styles.list} aria-label="Up Next">
            {entries.active.map((entry) => {
              const code = `S${entry.next.season}E${entry.next.number}`;
              return <ListRow key={entry.title.tmdbId} leading={<Poster src={entry.title.posterPath ? `https://image.tmdb.org/t/p/w92${entry.title.posterPath}` : null} small />}
                title={entry.title.name}
                subtitle={<span key={code} className={styles.episode}>{code} · {entry.next.name}<span className={styles.meta}><StatusPill status={entry.title.status} /> {entry.remaining} left{entry.rewatchNumber !== null && ` in rewatch #${entry.rewatchNumber}`}</span></span>}
                trailing={<Button icon="plus" size="lg" variant="ghost" disabled={busy} aria-label={`Log ${code} of ${entry.title.name}`} onClick={() => void log(entry)} />} />;
            })}
          </ul>}
          {entries.caughtUp.length > 0 && <section className={styles.caughtUp} aria-labelledby="caught-up"><h2 id="caught-up">Caught up</h2><ul className={styles.list}>
            {entries.caughtUp.map(({ title, airDate }) => <ListRow key={title.tmdbId} title={title.name} subtitle={airDate ? `Next episode ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${airDate}T12:00:00`))}` : "Waiting for the next episode"} trailing={<StatusPill status="caughtUp" />} />)}
          </ul></section>}
          {!entries.active.length && !entries.caughtUp.length && <EmptyState icon="upNext" title="Nothing up next yet" action={<QuickAddButton>Find something to watch</QuickAddButton>}>Add a show and its next episode lands here, ready to log in one tap. Press ⌘K or Ctrl-K to search anywhere.</EmptyState>}
        </>
      )}
    </>
  );
}
