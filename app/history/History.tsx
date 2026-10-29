"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow } from "@/components/ui/ListRow";
import { Poster } from "@/components/ui/Poster";
import { Skeleton } from "@/components/ui/Skeleton";
import { STATUS_LABELS } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { batchLabel, dayHeading, episodeLabel, historyDays, rewatchNumbers, type HistoryEntry } from "@/lib/history";
import { posterUrl } from "@/lib/quick-add";
import { libraryRepository } from "@/lib/storage";
import type { Title } from "@/lib/types";
import { UndoStack } from "@/lib/undo-stack";
import { WatchLogService } from "@/lib/watch-log";
import styles from "./history.module.css";

// Ports the macOS Views/History/HistoryView: every watch event, newest first, grouped by day.
// Deleting an event goes through WatchLogService, so progress and status follow, with one undo step.

type Loaded = { entries: HistoryEntry[]; titles: Title[]; now: Date };

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const titleKeyId = (t: { kind: string; tmdbId: number }) => `${t.kind}:${t.tmdbId}`;
const titleHref = (t: Title) => `/title/${t.kind}/${t.tmdbId}`;

async function load(): Promise<Loaded> {
  const repo = await libraryRepository();
  const titles = await repo.listTitles();
  const entries = (await Promise.all(titles.map(async (title) => (await repo.listWatchEvents(title)).map((event) => ({ event, title }))))).flat();
  return { entries, titles, now: new Date() };
}

/** What a row is called in toasts and labels: "Frieren S1 · E3" or just the movie's name. */
function describe({ event, title }: HistoryEntry) {
  const name = title?.name ?? "Removed title";
  return event.kind === "movie" ? name : `${name} S${event.season ?? 0} · E${event.episode ?? 0}`;
}

export function History() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const undoStack = useRef(new UndoStack());
  const service = useRef<WatchLogService | null>(null);
  const toast = useToast();
  const reload = useCallback(async () => {
    const loaded = await load();
    setData(loaded);
    return loaded;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((loaded) => { if (!cancelled) setData(loaded); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const undo = useCallback(async () => {
    if (lock.current || !undoStack.current.canUndo) return;
    lock.current = true;
    setBusy(true);
    try {
      await undoStack.current.undo();
      await reload();
      toast({ message: "Watch restored" });
    } catch {
      toast({ message: "Couldn't undo. Please try again." });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [reload, toast]);

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

  async function remove(entry: HistoryEntry) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      service.current ??= new WatchLogService(await libraryRepository());
      const before = undoStack.current.size;
      await service.current.deleteEvent(entry.event.uid, undoStack.current);
      const loaded = await reload();
      const status = loaded.titles.find((t) => titleKeyId(t) === titleKeyId(entry.event))?.status;
      const statusNote = status && entry.title && status !== entry.title.status ? ` · now ${STATUS_LABELS[status]}` : "";
      toast(undoStack.current.size > before
        ? { message: `Deleted ${describe(entry)}${statusNote}`, actionLabel: "Undo", onAction: () => void undo() }
        : { message: "That watch was already gone" });
    } catch {
      toast({ message: "Couldn't delete the watch. Please try again." });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const header = <header className="page-header"><h1>History</h1><p>Every episode and movie you’ve logged.</p></header>;
  if (error) return <>{header}<p role="alert">Couldn’t load your history. Reload to try again.</p></>;
  if (data === null) {
    return <>{header}<div role="status" aria-label="Loading history" className={styles.loading}>{[1, 2, 3, 4].map((n) => <Skeleton key={n} height={64} />)}</div></>;
  }
  if (data.entries.length === 0) {
    return (
      <>
        {header}
        <EmptyState icon="history" title="No watches logged yet">
          When you log an episode or movie it appears here, newest first, so you can look back or fix a mistake.
        </EmptyState>
      </>
    );
  }

  const rewatches = rewatchNumbers(data.entries.map((e) => e.event));
  const row = (entry: HistoryEntry, showsTitle = true) => (
    <HistoryRow key={entry.event.uid} entry={entry} showsTitle={showsTitle} rewatch={rewatches.get(entry.event.uid)} busy={busy} onDelete={() => void remove(entry)} />
  );

  return (
    <>
      {header}
      {historyDays(data.entries).map((day) => {
        const id = `day-${day.start.getTime()}`;
        return (
          <section key={id} className={styles.day} aria-labelledby={id}>
            <h2 id={id} className={styles.heading}>{dayHeading(day.start, data.now)}</h2>
            <ul className={styles.list}>
              {day.items.map((item) => item.kind === "single" ? row(item.entry) : (
                <li key={item.id} className={styles.batch}>
                  <details>
                    <summary className={styles.summary}>
                      <Poster src={posterUrl(item.entries[0].title?.posterPath ?? null)} small />
                      <span className={styles.summaryText}>
                        <span className={styles.summaryTitle}>{item.entries[0].title?.name ?? "Removed title"}</span>
                        <span className={styles.meta}>
                          {batchLabel(item.entries.map((e) => e.event))}
                          <span className={cx(styles.tag, styles.bulk)}>Bulk</span>
                          <time dateTime={item.entries[0].event.watchedAt}>{timeFormat.format(new Date(item.entries[0].event.watchedAt))}</time>
                        </span>
                      </span>
                      <span className={styles.chevron} aria-hidden="true">▾</span>
                    </summary>
                    <ul className={styles.list}>
                      {[...item.entries].sort((a, b) => (a.event.season ?? 0) - (b.event.season ?? 0) || (a.event.episode ?? 0) - (b.event.episode ?? 0)).map((entry) => row(entry, false))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

type RowProps = { entry: HistoryEntry; showsTitle: boolean; rewatch: number | undefined; busy: boolean; onDelete: () => void };

function HistoryRow({ entry, showsTitle, rewatch, busy, onDelete }: RowProps) {
  const { event, title } = entry;
  const name = title?.name ?? "Removed title";
  const episode = episodeLabel(event, title);
  const heading = showsTitle ? name : episode ?? name;
  const subtitle = showsTitle ? episode : null;
  return (
    <ListRow
      className={styles.row}
      leading={showsTitle ? <Poster src={posterUrl(title?.posterPath ?? null)} small /> : undefined}
      title={title ? <Link className={styles.link} href={titleHref(title)}>{heading}</Link> : heading}
      subtitle={
        <>
          {subtitle && <span className={styles.line}>{subtitle}</span>}
          <span className={styles.meta}>
            <time dateTime={event.watchedAt}>{timeFormat.format(new Date(event.watchedAt))}</time>
            {rewatch !== undefined && <span className={styles.tag}>Rewatch #{rewatch}</span>}
          </span>
        </>
      }
      trailing={<Button className={styles.delete} variant="ghost" icon="trash" disabled={busy} aria-label={`Delete watch of ${describe(entry)}`} onClick={onDelete} />}
    />
  );
}
