import type { CSSProperties } from "react";
import type { ListStatus } from "@/lib/types";
import { cx } from "./cx";
import styles from "./ui.module.css";

export const STATUS_LABELS: Record<ListStatus, string> = {
  planToWatch: "Plan to Watch",
  watching: "Watching",
  rewatching: "Rewatching",
  caughtUp: "Caught Up",
  onHold: "On Hold",
  dropped: "Dropped",
  completed: "Completed",
};

export function StatusPill({ status, className }: { status: ListStatus; className?: string }) {
  return (
    <span className={cx(styles.pill, className)} style={{ "--hue": `var(--status-${status})` } as CSSProperties}>
      <span>{STATUS_LABELS[status]}</span>
    </span>
  );
}
