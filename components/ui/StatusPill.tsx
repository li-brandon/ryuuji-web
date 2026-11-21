import type { CSSProperties } from "react";
import { STATUS_LABELS, type ListStatus } from "@/lib/types";
import { cx } from "./cx";
import styles from "./ui.module.css";

export { STATUS_LABELS };

export function StatusPill({ status, className }: { status: ListStatus; className?: string }) {
  return (
    <span className={cx(styles.pill, className)} style={{ "--hue": `var(--status-${status})` } as CSSProperties}>
      <span>{STATUS_LABELS[status]}</span>
    </span>
  );
}
