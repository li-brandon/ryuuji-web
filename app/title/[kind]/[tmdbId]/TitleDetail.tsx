"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { Poster } from "@/components/ui/Poster";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusPill, STATUS_LABELS } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { isAired, today as localToday } from "@/lib/air-date";
import { isSpecial, rewatchProgress, titleProgress, watchCount, type Episode } from "@/lib/progress";
import { posterUrl, refreshTitle } from "@/lib/quick-add";
import { debouncedSave, type DebouncedSave } from "@/lib/debounced-save";
import { libraryRepository } from "@/lib/storage";
import { TMDBRequestError } from "@/lib/tmdb-client";
import { LIST_STATUSES, type ListStatus, type Title, type TitleKey, type WatchEvent } from "@/lib/types";
import { UndoStack } from "@/lib/undo-stack";
import { allowedStatuses, canStartRewatch, WatchLogService } from "@/lib/watch-log";
import styles from "./detail.module.css";

// Ports the macOS Views/Detail/TitleDetailView: header, list fields, episode checklist with bulk
// marking, movie logging and the guided rewatch flow (LIB-293).

type Entry = { title: Title; events: WatchEvent[] };
type Menu = { kind: "status" } | { kind: "bulk" } | { kind: "episode"; episode: Episode };

const NOTES_DEBOUNCE_MS = 600;
const code = (e: Episode) => `S${e.season}E${e.number}`;
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const airDateText = (airDate: string | null) => (airDate ? dateFormat.format(new Date(`${airDate}T12:00:00`)) : "TBA");

async function load(key: TitleKey): Promise<Entry | undefined> {
  const repo = await libraryRepository();
  const title = await repo.getTitle(key);
  return title && { title, events: await repo.listWatchEvents(key) };
}

function refreshError(error: unknown) {
  if (error instanceof TMDBRequestError && error.status === 401) return "Couldn’t refresh: enter the passcode in Search (⌘K) first.";
  if (error instanceof TMDBRequestError && error.status === 503) return `Couldn’t refresh: TMDB isn’t configured on this server (${error.message}).`;
  return `Couldn’t refresh from TMDB: ${error instanceof Error ? error.message : String(error)}`;
}

export function TitleDetail({ titleKey }: { titleKey: TitleKey }) {
  const [entry, setEntry] = useState<Entry | null | undefined>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const lock = useRef(false);
  const undoStack = useRef(new UndoStack());
  const service = useRef<WatchLogService | null>(null);
  const toast = useToast();
  const reload = useCallback(async () => setEntry(await load(titleKey)), [titleKey]);

  useEffect(() => {
    let cancelled = false;
    void load(titleKey).then((loaded) => { if (!cancelled) setEntry(loaded); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [titleKey]);

  const undo = useCallback(async () => {
    if (lock.current || !undoStack.current.canUndo) return;
    lock.current = true;
    setBusy(true);
    try {
      const name = undoStack.current.undoActionName;
      await undoStack.current.undo();
      await reload();
      toast({ message: `Undid ${name}` });
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

  /** Runs one logging or status action; each registers at most one undo step, offered in the toast. */
  async function perform(message: string, action: (service: WatchLogService, undo: UndoStack) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMenu(null);
    try {
      service.current ??= new WatchLogService(await libraryRepository());
      const before = undoStack.current.size;
      await action(service.current, undoStack.current);
      await reload();
      toast(undoStack.current.size > before ? { message, actionLabel: "Undo", onAction: () => void undo() } : { message: "Nothing to change" });
    } catch {
      toast({ message: "Couldn't save the change. Please try again." });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await refreshTitle(await libraryRepository(), titleKey);
      await reload();
      toast({ message: "Refreshed from TMDB" });
    } catch (error) {
      toast({ message: refreshError(error), duration: 8000 });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (error) return <><BackLink /><p role="alert">Couldn’t load this title. Reload to try again.</p></>;
  if (entry === null) return <><BackLink /><div role="status" aria-label="Loading title" className={styles.loading}><Skeleton variant="poster" width={140} /><Skeleton height={88} /></div></>;
  if (entry === undefined) return <><BackLink /><EmptyState icon="library" title="Title removed">This title is no longer in your library.</EmptyState></>;

  const { title, events } = entry;
  const today = localToday();
  const progress = titleProgress(title, events, today);
  const rewatch = title.status === "rewatching" ? rewatchProgress(progress) : null;
  const key = { tmdbId: title.tmdbId, kind: title.kind };
  const seasons = [...(title.episodes?.seasons ?? [])].sort((a, b) => Number(a.number === 0) - Number(b.number === 0) || a.number - b.number);
  const e = menu?.kind === "episode" ? menu.episode : null;
  const aired = !!e && isAired(e.airDate, today);
  const watched = !!e && watchCount(progress, e) > 0;
  const meta = [title.releaseDate?.slice(0, 4), title.kind === "movie" ? "Movie" : "Show", title.showStatus].filter(Boolean).join(" · ");

  return (
    <article className={styles.detail}>
      <BackLink />
      <header className={styles.header}>
        <Poster className={styles.poster} src={posterUrl(title.posterPath, "w342")} alt={`${title.name} poster`} />
        <div className={styles.info}>
          <h1>{title.name}</h1>
          <p className={styles.meta}>
            {meta}
            {title.isAnime && <span className={styles.tag}>Anime</span>}
          </p>
          {title.genres.length > 0 && <p className={styles.genres}>{title.genres.join(", ")}</p>}
          {title.kind === "show" && <p className={styles.progress}>{progress.watchedAiredRegularCount}/{progress.airedRegular.length} episodes watched</p>}
          {rewatch && (
            <p className={styles.rewatch}>
              Rewatch #{rewatch.number} · {rewatch.watchedCount}/{rewatch.episodes.length}
              {rewatch.next && <Button size="sm" icon="plus" disabled={busy} onClick={() => void perform(`Logged ${code(rewatch.next!)}`, (s, u) => s.log(key, rewatch.next, u))}>Log {code(rewatch.next)}</Button>}
            </p>
          )}
          <div className={styles.fields}>
            <button type="button" className={styles.status} aria-haspopup="dialog" aria-label={`Status: ${STATUS_LABELS[title.status]}. Change`} disabled={busy} onClick={() => setMenu({ kind: "status" })}>
              <StatusPill status={title.status} /> <span aria-hidden="true">▾</span>
            </button>
            <ScoreSelect title={title} onSaved={reload} />
          </div>
          <div className={styles.actions}>
            {title.kind === "show" && <Button disabled={busy || progress.remaining === 0} aria-haspopup="dialog" icon="check" onClick={() => setMenu({ kind: "bulk" })}>Mark watched…</Button>}
            {title.status === "rewatching" ? (
              <Button disabled={busy} onClick={() => void perform("Stopped rewatch", (s, u) => s.stopRewatch(key, u))}>Stop rewatch</Button>
            ) : canStartRewatch(title, progress) && (
              <Button disabled={busy} onClick={() => void perform("Started rewatch", (s, u) => s.startRewatch(key, u))}>Start rewatch</Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>Refresh</Button>
          </div>
        </div>
        {title.overview && <p className={styles.overview}>{title.overview}</p>}
      </header>

      <Notes key={`notes-${title.kind}-${title.tmdbId}`} title={title} />

      {title.kind === "movie" ? (
        <section className={styles.movie} aria-label="Watches">
          {progress.eventCount === 0 ? (
            <Button variant="primary" size="lg" icon="check" disabled={busy} onClick={() => void perform("Marked watched", (s, u) => s.log(key, null, u))}>Mark watched</Button>
          ) : (
            <>
              <p className={styles.watched}>{progress.eventCount === 1 ? "Watched once" : `Watched ${progress.eventCount} times`}</p>
              <Button icon="plus" disabled={busy} onClick={() => void perform("Logged rewatch", (s, u) => s.log(key, null, u))}>Log rewatch</Button>
              <Button variant="danger" disabled={busy} onClick={() => void perform("Unmarked", (s, u) => s.unmark(key, null, u))}>Unmark</Button>
            </>
          )}
        </section>
      ) : seasons.length === 0 ? (
        <p className={styles.empty}>No episode data yet. Use Refresh to fetch it from TMDB.</p>
      ) : (
        seasons.map((season) => (
          <Season key={season.number} name={season.name} episodes={season.episodes} today={today} watchedCount={(e) => watchCount(progress, e)} busy={busy}
            onMarkSeason={() => void perform(`Marked ${season.name} watched`, (s, u) => s.bulkMark(key, { season: season.number }, u))}
            onToggle={(e, watched) => void perform(watched ? `Unmarked ${code(e)}` : `Logged ${code(e)}`, (s, u) => (watched ? s.unmark(key, e, u) : s.log(key, e, u)))}
            onMenu={(episode) => setMenu({ kind: "episode", episode })} />
        ))
      )}

      <Sheet open={menu !== null} title onClose={() => setMenu(null)} label={menu?.kind === "status" ? "Change status" : menu?.kind === "bulk" ? "Mark watched" : menu ? `${code(menu.episode)} · ${menu.episode.name}` : "Actions"}>
        {menu?.kind === "status" && (
          <div className={styles.menu}>
            {LIST_STATUSES.filter((s) => s === title.status || allowedStatuses(title.kind).includes(s)).map((status: ListStatus) => (
              <Button key={status} aria-current={status === title.status ? "true" : undefined} disabled={busy || status === title.status}
                onClick={() => void perform(`Status set to ${STATUS_LABELS[status]}`, (s, u) => s.setStatus(key, status, u))}>
                {status === title.status && <span aria-hidden="true">✓ </span>}{STATUS_LABELS[status]}
              </Button>
            ))}
          </div>
        )}
        {menu?.kind === "bulk" && (
          <div className={styles.menu}>
            <Button variant="primary" disabled={busy || progress.remaining === 0} onClick={() => void perform("Marked all aired episodes watched", (s, u) => s.bulkMark(key, "all", u))}>
              All aired episodes ({progress.remaining} left)
            </Button>
            {seasons.map((season) => {
              const left = season.episodes.filter((e) => isAired(e.airDate, today) && watchCount(progress, e) === 0).length;
              return <Button key={season.number} disabled={busy || left === 0} onClick={() => void perform(`Marked ${season.name} watched`, (s, u) => s.bulkMark(key, { season: season.number }, u))}>{season.name} ({left} left)</Button>;
            })}
            <p className={styles.hint}>To mark everything up to an episode, use that episode’s ••• menu.</p>
          </div>
        )}
        {e && (
          <div className={styles.menu}>
            <Button variant="primary" disabled={busy || !aired} onClick={() => void perform(`Marked up to ${code(e)} watched`, (s, u) => s.bulkMark(key, { upTo: e }, u))}>Mark up to here</Button>
            {watched ? (
              <>
                <Button disabled={busy} onClick={() => void perform(`Logged ${code(e)} again`, (s, u) => s.log(key, e, u))}>Log again</Button>
                <Button variant="danger" disabled={busy} onClick={() => void perform(`Unmarked ${code(e)}`, (s, u) => s.unmark(key, e, u))}>Unmark</Button>
              </>
            ) : (
              <Button disabled={busy || !aired} onClick={() => void perform(`Logged ${code(e)}`, (s, u) => s.log(key, e, u))}>Mark watched</Button>
            )}
            {!aired && <p className={styles.hint}>Airs {airDateText(e.airDate)}.</p>}
          </div>
        )}
      </Sheet>
    </article>
  );
}

function BackLink() {
  return <Link className={styles.back} href="/library">← Back to library</Link>;
}

type SeasonProps = {
  name: string;
  episodes: Episode[];
  today: string;
  busy: boolean;
  watchedCount: (e: Episode) => number;
  onMarkSeason: () => void;
  onToggle: (e: Episode, watched: boolean) => void;
  onMenu: (e: Episode) => void;
};

function Season({ name, episodes, today, busy, watchedCount, onMarkSeason, onToggle, onMenu }: SeasonProps) {
  const [open, setOpen] = useState(true);
  const aired = episodes.filter((e) => isAired(e.airDate, today));
  const watched = aired.filter((e) => watchedCount(e) > 0).length;
  const id = `season-${episodes[0]?.season ?? name}`;
  return (
    <section className={styles.season} aria-label={name}>
      <div className={styles.seasonHeader}>
        <button type="button" className={styles.seasonToggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {name} <span className={styles.count}>{watched}/{aired.length}</span>
        </button>
        <Button size="sm" variant="ghost" disabled={busy || watched === aired.length} onClick={onMarkSeason}>Mark season</Button>
      </div>
      {open && (
        <ul id={id} className={styles.episodes}>
          {[...episodes].sort((a, b) => a.number - b.number).map((e) => {
            const count = watchedCount(e);
            const isAiredEp = isAired(e.airDate, today);
            return (
              <li key={e.tmdbId} className={cx(styles.episode, !isAiredEp && styles.unaired)}>
                <label className={styles.check}><input type="checkbox" checked={count > 0} disabled={busy || (!isAiredEp && count === 0)} aria-label={`Watched ${code(e)} ${e.name}`} onChange={() => onToggle(e, count > 0)} /></label>
                <span className={styles.number}>{isSpecial(e) ? `SP${e.number}` : e.number}</span>
                <span className={styles.name}>{e.name}</span>
                {count > 1 && <span className={styles.tag} title={`Rewatched ${count - 1} time${count === 2 ? "" : "s"}`}>×{count}</span>}
                <span className={styles.date}>{airDateText(e.airDate)}</span>
                <Button size="sm" variant="ghost" aria-label={`More for ${code(e)}`} aria-haspopup="dialog" disabled={busy} onClick={() => onMenu(e)}>•••</Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Score: none or 1–10. Not a logging action, so no undo step (as in Swift's ScorePicker). */
function ScoreSelect({ title, onSaved }: { title: Title; onSaved: () => Promise<void> }) {
  const toast = useToast();
  async function save(value: string) {
    try {
      await (await libraryRepository()).updateTitle(title, { score: value ? Number(value) : null });
      await onSaved();
    } catch {
      toast({ message: "Couldn't save the score. Please try again." });
    }
  }
  return (
    <label className={styles.score}>
      Score
      <select value={title.score ?? ""} onChange={(e) => void save(e.target.value)}>
        <option value="">No score</option>
        {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
}

/** Notes save after typing pauses, on blur, and when the page is hidden or unloaded. */
function Notes({ title }: { title: Title }) {
  const [notes, setNotes] = useState(title.notes);
  const [saved, setSaved] = useState<"saved" | "saving" | "failed" | null>(null);
  const saver = useRef<DebouncedSave<string>>(null);

  useEffect(() => {
    const key: TitleKey = { tmdbId: title.tmdbId, kind: title.kind };
    const save = debouncedSave<string>(async (value) => {
      try {
        await (await libraryRepository()).updateTitle(key, { notes: value });
        setSaved("saved");
      } catch {
        setSaved("failed");
      }
    }, NOTES_DEBOUNCE_MS);
    saver.current = save;
    return () => save.dispose();
  }, [title.tmdbId, title.kind]);

  return (
    <label className={styles.notes}>
      <span>Notes <span className={styles.hint} role="status">{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "failed" ? "Couldn’t save notes" : ""}</span></span>
      <textarea value={notes} rows={3} onBlur={() => void saver.current?.flush()} onChange={(e) => {
        setNotes(e.target.value);
        setSaved("saving");
        saver.current?.schedule(e.target.value);
      }} />
    </label>
  );
}
