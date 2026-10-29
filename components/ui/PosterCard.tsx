import Link from "next/link";
import type { ListStatus } from "@/lib/types";
import { Poster } from "./Poster";
import { StatusPill } from "./StatusPill";
import styles from "./ui.module.css";

type Props = {
  title: string;
  src: string | null;
  subtitle?: string;
  status?: ListStatus;
  /** Watched fraction, 0–1. */
  progress?: number;
  href?: string;
};

export function PosterCard({ title, src, subtitle, status, progress, href }: Props) {
  const percent = progress === undefined ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const body = (
    <>
      <span className={styles.cardArt}>
        <Poster src={src} />
        {percent !== null && (
          <span className={styles.progress} role="progressbar" aria-label={`${title} progress`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ inlineSize: `${percent}%` }} />
          </span>
        )}
      </span>
      <span className={styles.cardTitle}>{title}</span>
      {(status || subtitle) && (
        <span className={styles.cardMeta}>
          {status && <StatusPill status={status} />}
          {subtitle}
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className={styles.card}>
      {body}
    </Link>
  ) : (
    <div className={styles.card}>{body}</div>
  );
}
