"use client";

import { useEffect, useId, useRef, useState } from "react";
import { addTitle, isQuickAddShortcut, itemId, moveSelection, posterUrl, searchTitles, type SearchItem } from "@/lib/quick-add";
import { libraryRepository } from "@/lib/storage";
import { TMDBRequestError } from "@/lib/tmdb-client";

// Port of the macOS QuickAddPanel: Cmd/Ctrl-K search-and-add, Return adds as Plan to Watch.

const DEBOUNCE_MS = 300;

type Phase = { kind: "idle" | "searching" | "done" } | { kind: "failed"; message: string };

const errorText = (error: unknown) =>
  error instanceof TMDBRequestError && error.status === 503
    ? `Search is unavailable on this server: ${error.message}.`
    : error instanceof Error
      ? error.message
      : String(error);

export function QuickAdd() {
  const dialog = useRef<HTMLDialogElement>(null);
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isQuickAddShortcut(e)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
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
    dialog.current?.close();
  }

  /** Runs when the dialog closes for any reason (Escape, backdrop, close()). */
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

  async function add(item: SearchItem) {
    const id = itemId(item);
    if (adding.has(id)) return;
    if (inLibrary.has(id)) {
      setMessage(`“${item.name}” is already in your library.`);
      return;
    }
    setMessage(null);
    setAdding((s) => new Set(s).add(id));
    try {
      const { outcome } = await addTitle(await libraryRepository(), item);
      setInLibrary((s) => new Set(s).add(id));
      setMessage(outcome === "added" ? `Added “${item.name}” to Plan to Watch.` : `“${item.name}” is already in your library.`);
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
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => moveSelection(i, e.key === "ArrowDown" ? 1 : -1, results.length));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const item = results[selected];
      if (item) void add(item);
    }
  }

  const active = selected >= 0 ? `${listId}-${selected}` : undefined;

  return (
    <>
      <button type="button" className="search-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Search <kbd>⌘K</kbd>
      </button>
      <dialog
        ref={dialog}
        className="quick-add"
        aria-label="Search movies and shows"
        onClose={reset}
        onClick={(e) => e.target === dialog.current && close()}
      >
        {open && (
          <div className="quick-add-panel">
            <div className="quick-add-field">
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
                autoFocus
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <button type="button" onClick={close}>
                Close
              </button>
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

            {phase.kind === "searching" && <p className="hint">Searching…</p>}
            {phase.kind === "failed" && (
              <p className="hint error" role="alert">
                {phase.message}
              </p>
            )}
            {phase.kind === "done" && !results.length && <p className="hint">No movies or shows match “{query.trim()}”.</p>}
            {phase.kind === "idle" && !needsPasscode && (
              <p className="hint">Type to search TMDB. ↑↓ to move, Return adds as Plan to Watch, Esc closes.</p>
            )}

            <ul id={listId} role="listbox" aria-label="Results" className="results" hidden={!results.length}>
              {results.map((item, i) => {
                const id = itemId(item);
                const status = adding.has(id) ? "Adding…" : inLibrary.has(id) ? "Added" : null;
                return (
                  <li
                    key={id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === selected}
                    className="result"
                    onClick={() => {
                      setSelected(i);
                      void add(item);
                    }}
                  >
                    <Poster path={item.posterPath} />
                    <span className="result-text">
                      <span className="result-name">{item.name}</span>
                      <span className="muted">
                        {[item.year, item.kind === "movie" ? "Movie" : "Show", item.isAnime && "Anime"].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className={status === "Added" ? "badge added" : "badge"}>{status ?? "Add"}</span>
                  </li>
                );
              })}
            </ul>

            <p className="hint" role="status">
              {message}
            </p>
          </div>
        )}
      </dialog>
    </>
  );
}

function PasscodeForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <form className="passcode" onSubmit={submit}>
      <label>
        Enter the passcode to search TMDB
        <input type="password" autoComplete="current-password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} required />
      </label>
      <button type="submit" disabled={busy}>
        Unlock
      </button>
      {error && (
        <p className="hint error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function Poster({ path }: { path: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = posterUrl(path);
  if (!src || failed) return <span className="poster placeholder" aria-hidden="true" />;
  // TMDB serves pre-sized posters, so next/image optimization adds nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="poster" src={src} alt="" width={46} height={69} loading="lazy" onError={() => setFailed(true)} />;
}
