import { today } from "./air-date";
import { addDays, localCalendar } from "./calendar";
import type { TitleKey } from "./types";
import type { UndoHandle, UndoStack } from "./undo-stack";
import type { UpNextEntry } from "./up-next";
import type { WatchLogService } from "./watch-log";

// The Up Next page's wiring around logging, undo, focus and the day boundary, kept out of the
// component so it can be tested without a DOM.

export const logButtonLabel = ({ title, next }: UpNextEntry) => `Log S${next.season}E${next.number} of ${title.name}`;

/** Logs the entry's next episode and returns the undo step it registered, if any. */
export async function logEntry(service: Pick<WatchLogService, "log">, entry: UpNextEntry, stack: UndoStack): Promise<UndoHandle | undefined> {
  const before = stack.size;
  await service.log(entry.title, entry.next, stack);
  return stack.size > before ? stack.top : undefined;
}

/** Undoes `step` wherever it sits in the stack, or the most recent step without one. False if there was nothing to undo. */
export async function undoLog(stack: UndoStack, step?: UndoHandle): Promise<boolean> {
  if (!(step ?? stack).canUndo) return false;
  await (step ?? stack).undo();
  return true;
}

export type FocusTarget = { row: string } | "toast" | null;

/** After a log, focus the title's new "+" button if it's still up next, else the toast's Undo. */
export function focusAfterLog(entries: UpNextEntry[], key: TitleKey, hasToastAction: boolean): FocusTarget {
  const entry = entries.find(({ title }) => title.tmdbId === key.tmdbId && title.kind === key.kind);
  return entry ? { row: logButtonLabel(entry) } : hasToastAction ? "toast" : null;
}

/** Only move focus when it was lost from the log button (to <body> or nowhere) or is still on it. */
export const shouldRestoreFocus = (active: unknown, origin: unknown, body: unknown) => active === null || active === body || active === origin;

export const msUntilNextMidnight = (now: Date) => addDays(localCalendar(), now, 1).getTime() - now.getTime();

/** Reports today's date now and again after each local midnight. Returns a cancel function. */
export function watchToday(onChange: (day: string) => void, now = () => new Date()): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    onChange(today(now()));
    timer = setTimeout(tick, msUntilNextMidnight(now()));
  };
  tick();
  return () => clearTimeout(timer);
}
