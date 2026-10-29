import { hasAiredRegular, titleProgress, type Progress } from "./progress";
import type { Kind, ListStatus, ShowStatus, Title, WatchEvent } from "./types";

// Ports the macOS app's Domain/StatusEngine.swift: the automatic list-status rules.

/**
 * What caused a status recomputation: `log` (a single log or bulk mark), `unmark` (an unmark
 * or deleted event), `refresh` (a metadata refresh), `endRewatch` (a rewatch pass finished or stopped).
 */
export type StatusTrigger = "log" | "unmark" | "refresh" | "endRewatch";

/** Whether no further episodes are expected. A missing status counts as Unknown. */
export const isFinished = (showStatus: ShowStatus | null) => showStatus === "Ended" || showStatus === "Canceled";

export type StatusInput = {
  current: ListStatus;
  kind: Kind;
  progress: Progress;
  showStatus: ShowStatus | null;
};

export function statusAfter(trigger: StatusTrigger, input: StatusInput): ListStatus {
  const { current, kind, progress } = input;
  switch (trigger) {
    case "log":
      // A rewatch keeps its status until the pass finishes (`endRewatch`).
      return current === "rewatching" ? current : fromProgress(input);
    case "endRewatch":
      return fromProgress(input);
    case "refresh":
      return current === "watching" || current === "caughtUp" ? fromProgress(input) : current;
    case "unmark":
      if (kind === "movie") return current === "completed" && progress.eventCount === 0 ? "planToWatch" : current;
      return (current === "caughtUp" || current === "completed") && progress.remaining > 0 ? "watching" : current;
  }
}

/** The status implied by progress alone. */
function fromProgress({ current, kind, progress, showStatus }: StatusInput): ListStatus {
  if (kind === "movie") return progress.eventCount > 0 ? "completed" : current;
  const allAiredWatched = hasAiredRegular(progress) && progress.remaining === 0;
  if (!allAiredWatched) return "watching";
  return isFinished(showStatus) ? "completed" : "caughtUp";
}

/** The status after a metadata refresh, given the refreshed title and its events. */
export function statusAfterRefresh(title: Title, events: WatchEvent[], today: string): ListStatus {
  return statusAfter("refresh", {
    current: title.status,
    kind: title.kind,
    progress: titleProgress(title, events, today),
    showStatus: title.showStatus,
  });
}
