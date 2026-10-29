import type { CSSProperties } from "react";
import { cx } from "./cx";
import styles from "./ui.module.css";

const VARIANTS = { block: undefined, text: styles.skeletonText, poster: styles.skeletonPoster, circle: styles.skeletonCircle };

/** Shimmering placeholder. Hidden from assistive tech; label the loading region instead. */
export function Skeleton({ variant = "block", width, height, className }: { variant?: keyof typeof VARIANTS; width?: CSSProperties["width"]; height?: CSSProperties["height"]; className?: string }) {
  return <span className={cx(styles.skeleton, VARIANTS[variant], className)} style={{ width, height }} aria-hidden="true" />;
}
