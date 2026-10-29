"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PosterCard } from "@/components/ui/PosterCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { libraryRepository } from "@/lib/storage";
import type { Title, TitleKey } from "@/lib/types";
import styles from "@/app/library/library.module.css";

export function TitlePlaceholder({ titleKey }: { titleKey: TitleKey }) {
  const [title, setTitle] = useState<Title | null | undefined>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void libraryRepository().then((repo) => repo.getTitle(titleKey)).then((title) => { if (!cancelled) setTitle(title); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [titleKey]);
  return <><Link href="/library">← Back to library</Link>{error ? <p role="alert">Couldn’t load this title. Reload to try again.</p> : title === null ? <Skeleton height={88} /> : title === undefined ? <p>This title is no longer in your library.</p> : <><header className="page-header"><h1>{title.name}</h1></header><div className={styles.detail}><PosterCard title={title.name} status={title.status} src={title.posterPath ? `https://image.tmdb.org/t/p/w342${title.posterPath}` : null} /></div></>}</>;
}
