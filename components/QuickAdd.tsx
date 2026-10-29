"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { ListRow } from "@/components/ui/ListRow";
import { Poster } from "@/components/ui/Poster";
import { Sheet } from "@/components/ui/Sheet";
import { STATUS_LABELS } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import {
  addTitle,
  existingTitleHref,
  isQuickAddShortcut,
  itemId,
  moveSelection,
  posterUrl,
  searchTitles,
  shortcutStatus,
  STATUS_SHORTCUTS,
  titleHref,
  type SearchItem,
} from "@/lib/quick-add";
import { libraryRepository } from "@/lib/storage";
import { TMDBRequestError } from "@/lib/tmdb-client";
import type { ListStatus } from "@/lib/types";
import { UndoStack } from "@/lib/undo-stack";
import { allowedStatuses } from "@/lib/watch-log";
import styles from "./QuickAdd.module.css";

// Port of the macOS QuickAddPanel: Cmd/Ctrl-K search-and-add, Return adds as Plan to Watch,
// Cmd/Ctrl-1 to 6 add with a status. Picking a title already in the library opens it.

const DEBOUNCE_MS = 300;
const OPEN_EVENT = "ryuuji:quick-add";

type Phase = { kind: "idle" | "searching" | "done" } | { kind: "failed"; message: string };

const errorText = (error: unknown) =>
  error instanceof TMDBRequestError && error.status === 503
    ? `Search is unavailable on this server: ${error.message}.`
    : error instanceof Error
      ? error.message
      : String(error);

export function QuickAdd() {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [selected, setSelected] = useState(-1);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [retry, setRetry] = useState(0);
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const listId = useId();
  const router = useRouter();
  const toast = useToast();
  const undoStack = useRef(new UndoStack());

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isQuickAddShortcut(e)) return;
      e.preventDefault();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // The Sheet's effect has already shown the dialog.
    input.current?.focus();
    libraryRepository()
      .then((repo) => repo.listTitles())
      .then((titles) => setInLibrary(new Set(titles.map(itemId))))
      .catch((error) => setMessage(`Couldn't open your library: ${errorText(error)}`));
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || !trimmed) return;
    let stale = false;
    const timer = setTimeout(async () => {
      setPhase({ kind: "searching" });
      try {
        const found = await searchTitles(trimmed);
        if (stale) return;
        setResults(found);
        setSelected(found.length ? 0 : -1);
        setPhase({ kind: "done" });
      } catch (error) {
        if (stale) return;
        setResults([]);
        setSelected(-1);
        if (error instanceof TMDBRequestError && error.status === 401) {
          setNeedsPasscode(true);
          setPhase({ kind: "idle" });
        } else {
          setPhase({ kind: "failed", message: errorText(error) });
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, query, retry]);

  useEffect(() => {
    if (selected >= 0) document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, selected]);

  function close() {
    setOpen(false);
  }

  /** Runs when the sheet closes for any reason (Escape, backdrop, close()). */
  function reset() {
    setOpen(false);
    setQuery("");
    setResults([]);
    setSelected(-1);
    setPhase({ kind: "idle" });
    setMessage(null);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      setSelected(-1);
      setPhase({ kind: "idle" });
    }
  }

  function openTitle(href: string) {
    close();
    router.push(href);
  }

  async function undo() {
    try {
      await undoStack.current.undo();
      toast({ message: "Status change undone" });
    } catch {
      toast({ message: "Couldn't undo the status change. Please try again." });
    }
  }

  async function add(item: SearchItem, status: ListStatus = "planToWatch") {
    const id = itemId(item);
    if (adding.has(id)) return;
    const existing = existingTitleHref(item, inLibrary);
    if (existing) return openTitle(existing);
    setMessage(null);
    setAdding((s) => new Set(s).add(id));
    try {
      const { outcome } = await addTitle(await libraryRepository(), item, status, { undo: undoStack.current });
      setInLibrary((s) => new Set(s).add(id));
      if (outcome === "existing") return openTitle(titleHref(item));
      setMessage(`Added “${item.name}” to ${STATUS_LABELS[status]}.`);
      if (status !== "planToWatch") toast({ message: `Added “${item.name}” as ${STATUS_LABELS[status]}`, actionLabel: "Undo", onAction: () => void undo() });
    } catch (error) {
      if (error instanceof TMDBRequestError && error.status === 401) setNeedsPasscode(true);
      else setMessage(`Couldn't add “${item.name}”: ${errorText(error)}`);
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const item = results[selected];
    const status = item && shortcutStatus(e, item.kind);
    if (/^[1-6]$/.test(e.key) && (e.metaKey || e.ctrlKey)) e.preventDefault();
    if (status) {
      void add(item, status);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => moveSelection(i, e.key === "ArrowDown" ? 1 : -1, results.length));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (item) void add(item);
    }
  }

  const active = selected >= 0 ? `${listId}-${selected}` : undefined;

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Search (⌘K)">
        <Icon name="search" />
        <span className={styles.label}>Search</span>
        <kbd className={styles.kbd}>⌘K</kbd>
      </button>
      <Sheet open={open} onClose={reset} label="Search movies and shows" className={styles.sheet}>
        <div className={styles.panel}>
          <div className={styles.field}>
            <Icon name="search" />
            <input
              ref={input}
              type="text"
              role="combobox"
              aria-label="Search movies and shows"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-activedescendant={active}
              aria-autocomplete="list"
              placeholder="Search movies and shows"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button variant="ghost" icon="close" aria-label="Close" onClick={close} />
          </div>

          {needsPasscode && (
            <PasscodeForm
              onUnlocked={() => {
                setNeedsPasscode(false);
                setRetry((n) => n + 1);
                input.current?.focus();
              }}
            />
          )}

          {phase.kind === "searching" && <p className={styles.hint}>Searching…</p>}
          {phase.kind === "failed" && (
            <p className={cx(styles.hint, styles.error)} role="alert">
              {phase.message}
            </p>
          )}
          {phase.kind === "done" && !results.length && <p className={styles.hint}>No movies or shows match “{query.trim()}”.</p>}
          {phase.kind === "idle" && !needsPasscode && (
            <p className={styles.hint}>
              Find a movie or show on TMDB and add it to Plan to Watch.
              <span className={styles.keys}> ↑↓ to move, Return adds, Esc closes.</span>
            </p>
          )}
          {results[selected] && (
            <div className={styles.shortcuts} role="group" aria-label={`Add “${results[selected].name}” as`}>
              {STATUS_SHORTCUTS.map((status, i) => (
                <button
                  key={status}
                  type="button"
                  disabled={!allowedStatuses(results[selected].kind).includes(status)}
                  aria-keyshortcuts={`Meta+${i + 1} Control+${i + 1}`}
                  onClick={() => void add(results[selected], status)}
                >
                  <kbd>⌘{i + 1}</kbd> {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          )}
          <ul id={listId} role="listbox" aria-label="Results" className={styles.results} hidden={!results.length}>
            {results.map((item, i) => {
              const id = itemId(item);
              const status = adding.has(id) ? "Adding…" : inLibrary.has(id) ? "Open" : null;
              return (
                <ListRow
                  key={id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === selected}
                  onClick={() => {
                    setSelected(i);
                    void add(item);
                  }}
                  leading={<Poster src={posterUrl(item.posterPath)} small />}
                  title={item.name}
                  subtitle={[item.year, item.kind === "movie" ? "Movie" : "Show", item.isAnime && "Anime"].filter(Boolean).join(" · ")}
                  trailing={
                    <span className={cx(styles.badge, status === "Open" && styles.added)}>
                      <Icon name={status === "Open" ? "check" : "plus"} size={16} />
                      {status ?? "Add"}
                    </span>
                  }
                />
              );
            })}
          </ul>

          <p className={styles.hint} role="status">
            {message}
          </p>
        </div>
      </Sheet>
    </>
  );
}

/** Opens the quick-add panel from anywhere (e.g. an empty state). */
export function QuickAddButton({ children }: { children: React.ReactNode }) {
  return (
    <Button variant="primary" icon="search" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      {children}
    </Button>
  );
}

function PasscodeForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ passcode }),
      });
      if (response.ok) return onUnlocked();
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      const reason = body?.error ?? `HTTP ${response.status}`;
      setError(response.status === 503 ? `Sign-in is unavailable on this server: ${reason}.` : reason);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.passcode} onSubmit={submit}>
      <label htmlFor={inputId} className={styles.passcodeTitle}>
        <Icon name="lock" size={18} />
        Enter the passcode to search TMDB
      </label>
      <div className={styles.passcodeRow}>
        <input id={inputId} type="password" autoComplete="current-password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} required />
        <Button type="submit" variant="primary" disabled={busy}>
          Unlock
        </Button>
      </div>
      {error && (
        <p className={cx(styles.hint, styles.error)} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
