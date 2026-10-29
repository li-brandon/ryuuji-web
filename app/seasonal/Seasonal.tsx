"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { PosterCard } from "@/components/ui/PosterCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusPill } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import { AnimeSeason } from "@/lib/anime-season";
import { addTitle, itemId, posterUrl, titleHref } from "@/lib/quick-add";
import { loadSeasonal, type SeasonalItem } from "@/lib/seasonal";
import { libraryRepository } from "@/lib/storage";
import type { Title } from "@/lib/types";
import styles from "./seasonal.module.css";

type Phase = { kind: "loading" } | { kind: "loaded"; items: SeasonalItem[] } | { kind: "failed"; message: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const premiere = (date: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function Seasonal() {
  const query = useSearchParams();
  const season = AnimeSeason.parse(query.get("season")) ?? AnimeSeason.current();
  const current = AnimeSeason.current();
  const href = (value: AnimeSeason) => {
    const params = new URLSearchParams(query);
    params.set("season", value.slug);
    return `/seasonal?${params}`;
  };
  return <>
    <header className="page-header"><h1>Seasonal</h1><p>Discover TV anime premieres. Find your next favorite.</p></header>
    <nav className={styles.switcher} aria-label="Anime season">
      <Link className={buttonClass({}, styles.step)} href={href(season.previous)} scroll={false} aria-label={`Previous season: ${season.previous.label}`}>←</Link>
      <h2 className={styles.label}>{season.label}</h2>
      <Link className={buttonClass({}, styles.step)} href={href(season.next)} scroll={false} aria-label={`Next season: ${season.next.label}`}>→</Link>
      {season.slug !== current.slug && <Link className={buttonClass({ variant: "ghost" }, styles.current)} href={href(current)} scroll={false}>Current season</Link>}
    </nav>
    <SeasonalResults key={season.slug} season={season} />
  </>;
}

function SeasonalResults({ season }: { season: AnimeSeason }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [titles, setTitles] = useState<Title[]>([]);
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const [addError, setAddError] = useState<string | null>(null);
  const toast = useToast();
  const { year, quarter } = season;
  useEffect(() => {
    let stale = false;
    Promise.all([loadSeasonal(new AnimeSeason(year, quarter)), libraryRepository().then((repo) => repo.listTitles())])
      .then(([items, library]) => { if (!stale) { setTitles(library); setPhase({ kind: "loaded", items }); } })
      .catch((error: unknown) => { if (!stale) setPhase({ kind: "failed", message: errorText(error) }); });
    return () => { stale = true; };
  }, [year, quarter, retry]);

  async function add(item: SeasonalItem) {
    const id = itemId(item);
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setAdding(new Set(pending.current));
    setAddError(null);
    try {
      // Default adds are not logging/status actions; addTitle owns status validation and undo rules.
      const { title, outcome } = await addTitle(await libraryRepository(), item);
      setTitles((previous) => [...previous.filter((existing) => itemId(existing) !== id), title]);
      if (outcome === "added") toast({ message: `Added “${item.name}” to Plan to Watch` });
    } catch (error) {
      setAddError(`Couldn't add “${item.name}”: ${errorText(error)}`);
    } finally {
      pending.current.delete(id);
      setAdding(new Set(pending.current));
    }
  }

  if (phase.kind === "loading") return <SeasonalSkeleton />;
  if (phase.kind === "failed") return <div role="alert"><EmptyState icon="seasonal" title={`Couldn't load ${season.label}`} action={<Button onClick={() => { setPhase({ kind: "loading" }); setRetry((value) => value + 1); }}>Try again</Button>}>{phase.message}</EmptyState></div>;
  if (!phase.items.length) return <EmptyState icon="seasonal" title="No anime found">TMDB lists no TV anime premiering in {season.label} yet.</EmptyState>;
  const inLibrary = new Map(titles.map((title) => [itemId(title), title]));
  return <>
    {addError && <p className={styles.error} role="alert">{addError}</p>}
    <p className={styles.count}>{phase.items.length} premieres · Most popular first</p>
    <ul className={styles.grid} aria-label={`${season.label} premieres`}>
      {phase.items.map((item) => {
        const saved = inLibrary.get(itemId(item));
        return <li key={itemId(item)} className={styles.card}>
          <PosterCard title={item.name} src={posterUrl(item.posterPath, "w342")} subtitle={`Premieres ${premiere(item.date)}`} href={saved ? titleHref(item) : undefined} />
          {saved ? <Link href={titleHref(item)} className={cx(styles.saved, styles.action)} aria-label={`${item.name}: In library, open title`}><span>✓ In library</span><StatusPill status={saved.status} /></Link>
            : <Button className={styles.action} icon="plus" aria-label={`Add ${item.name} to library`} disabled={adding.has(itemId(item))} onClick={() => void add(item)}>{adding.has(itemId(item)) ? "Adding…" : "Add to library"}</Button>}
        </li>;
      })}
    </ul>
  </>;
}

export function SeasonalSkeleton() {
  return <div role="status" aria-label="Loading seasonal premieres" className={styles.grid}>
    {Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.card}><Skeleton variant="poster" /><Skeleton variant="text" width="85%" /><Skeleton variant="text" width="65%" /><Skeleton height={44} /></div>)}
  </div>;
}
