"use client";

import { WatchProviderBadges, JustWatchAttribution } from "@/components/WatchProviders";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuickAddButton } from "@/components/QuickAdd";
import { Button, buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow } from "@/components/ui/ListRow";
import { Poster } from "@/components/ui/Poster";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusPill, STATUS_LABELS } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { today } from "@/lib/air-date";
import { libraryFiltersSchema, selectLibrary, type LibraryEntry } from "@/lib/library";
import { titleProgress } from "@/lib/progress";
import { libraryRepository } from "@/lib/storage";
import { LIST_STATUSES, type ListStatus, type Title } from "@/lib/types";
import { UndoStack } from "@/lib/undo-stack";
import { allowedStatuses, WatchLogService } from "@/lib/watch-log";
import styles from "./library.module.css";

async function loadLibrary() {
  const repo = await libraryRepository();
  return Promise.all((await repo.listTitles()).map(async (title) => ({ title, events: await repo.listWatchEvents(title) })));
}
const href = (title: Title) => `/title/${title.kind}/${title.tmdbId}`;

export function Library() {
  const query = useSearchParams();
  const filters = libraryFiltersSchema.parse(Object.fromEntries(query));
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [selection, setSelection] = useState<{ title: Title; confirm: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const undoStack = useRef(new UndoStack());
  const service = useRef<WatchLogService | null>(null);
  const toast = useToast();
  useEffect(() => {
    let cancelled = false;
    void loadLibrary().then((entries) => { if (!cancelled) setLibrary(entries); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  const undo = useCallback(async () => {
    if (lock.current || !undoStack.current.canUndo) return;
    lock.current = true;
    setBusy(true);
    try {
      await undoStack.current.undo();
      setLibrary(await loadLibrary());
      toast({ message: "Status change undone" });
    } catch { toast({ message: "Couldn't undo the status change. Please try again." }); }
    finally { lock.current = false; setBusy(false); }
  }, [toast]);
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
  function filter(key: string, value: string) {
    const params = new URLSearchParams(query);
    params.set(key, value);
    window.history.replaceState(null, "", `/library?${params}`);
  }
  async function change(status?: ListStatus) {
    if (!selection || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const repo = await libraryRepository();
      service.current ??= new WatchLogService(repo);
      if (status) await service.current.setStatus(selection.title, status, undoStack.current);
      else await repo.deleteTitle(selection.title);
      setLibrary(await loadLibrary());
      setSelection(null);
      toast(status ? { message: "Status updated", actionLabel: "Undo", onAction: () => void undo() } : { message: "Title and watch history removed" });
    } catch { toast({ message: "Couldn't save changes. Please try again." }); }
    finally { lock.current = false; setBusy(false); }
  }
  const result = selectLibrary(library ?? [], filters);
  return <div className={styles.library}>
    <header className="page-header"><h1>Library</h1><p>Everything you track, from Plan to Watch to Completed.</p></header>
    <div className={styles.filters} aria-label="Library filters">
      <div className={styles.chips} role="group" aria-label="Status">
        <Button aria-pressed={filters.status === "all"} variant={filters.status === "all" ? "primary" : "ghost"} onClick={() => filter("status", "all")}>All {result.total}</Button>
        {LIST_STATUSES.map((status) => <Button key={status} aria-pressed={filters.status === status} variant={filters.status === status ? "primary" : "ghost"} onClick={() => filter("status", status)}>{STATUS_LABELS[status]} {result.counts[status]}</Button>)}
      </div>
      <div className={styles.controls}>
        <label>Kind <select aria-label="Kind" value={filters.kind} onChange={(e) => filter("kind", e.target.value)}><option value="all">All</option><option value="movie">Movies</option><option value="show">Shows</option></select></label>
        <label><input type="checkbox" checked={filters.anime === "1"} onChange={(e) => filter("anime", e.target.checked ? "1" : "0")} /> Anime only</label>
        <label>Sort <select aria-label="Sort" value={filters.sort} onChange={(e) => filter("sort", e.target.value)}><option value="name">Name</option><option value="added">Date added</option><option value="watched">Last watched</option><option value="score">Score</option></select></label>
      </div>
    </div>
    <div className={styles.results} role="region" aria-label="Library titles">
      {error ? <p role="alert">Couldn’t load your library. Reload to try again.</p> : library === null ? <div role="status" aria-label="Loading library">{[1, 2, 3].map((n) => <Skeleton key={n} height={88} />)}</div> : library.length === 0 ? <EmptyState icon="library" title="Your library is empty" action={<QuickAddButton>Add a title</QuickAddButton>}>Search for a movie or show to start your library.</EmptyState> : result.visible.length === 0 ? <EmptyState icon="library" title="No matching titles" action={<Button onClick={() => window.history.replaceState(null, "", "/library")}>Clear filters</Button>}>Try a different status, kind or anime filter.</EmptyState> : result.groups.map((group) => <section key={group.status} aria-label={STATUS_LABELS[group.status]}>
        <h2 className={styles.heading}>{STATUS_LABELS[group.status]} <span>{group.entries.length}</span></h2>
        <ul className={styles.list}>{group.entries.map(({ title, events }) => {
          const progress = titleProgress(title, events, today());
          return <ListRow key={`${title.kind}-${title.tmdbId}`} leading={<Link href={href(title)} aria-label={`Open ${title.name}`}><Poster small src={title.posterPath ? `https://image.tmdb.org/t/p/w92${title.posterPath}` : null} /></Link>} title={<Link className={styles.title} href={href(title)}>{title.name}</Link>} subtitle={<span className={styles.meta}><span>{title.kind === "show" ? `${progress.watchedAiredRegularCount} of ${progress.airedRegular.length} ${progress.airedRegular.length === 1 ? "episode" : "episodes"}` : progress.eventCount > 0 ? "Watched" : "Movie"}{title.isAnime ? " · Anime" : ""}</span><StatusPill status={title.status} /><WatchProviderBadges title={title} /></span>} trailing={<Button variant="ghost" aria-label={`Actions for ${title.name}`} aria-haspopup="dialog" onClick={() => setSelection({ title, confirm: false })}>•••</Button>} />;
        })}</ul>
      </section>)}
    </div>
    <JustWatchAttribution />
    <Sheet open={selection !== null} label={selection?.confirm ? `Remove ${selection.title.name}?` : selection?.title.name ?? "Title actions"} title onClose={() => { if (!lock.current) setSelection(null); }}>
      {selection && (selection.confirm ? <div className={styles.actions}><p>This removes the title and all its watch history. This cannot be undone.</p><Button autoFocus disabled={busy} onClick={() => setSelection(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void change()}>Remove from library</Button></div> : <div className={styles.actions}>
        <Link className={buttonClass()} href={href(selection.title)}>Open detail</Link>
        <p>Change status</p>{LIST_STATUSES.filter((status) => status === selection.title.status || allowedStatuses(selection.title.kind).includes(status)).map((status) => <Button key={status} aria-current={selection.title.status === status ? "true" : undefined} disabled={busy || selection.title.status === status} onClick={() => void change(status)}>{selection.title.status === status && <span aria-hidden="true">✓ </span>}{STATUS_LABELS[status]}</Button>)}
        <Button variant="danger" disabled={busy} onClick={() => setSelection({ ...selection, confirm: true })}>Remove…</Button>
      </div>)}
    </Sheet>
  </div>;
}
