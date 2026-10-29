"use client";

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { STATUS_LABELS } from "@/components/ui/StatusPill";
import { firstWeekdayFor, localCalendar, type Calendar } from "@/lib/calendar";
import {
  allEvents,
  BUCKET_SIZES,
  buckets,
  byGenre,
  byKind,
  byOrigin,
  byStatus,
  filterEvents,
  hours,
  rangeStart,
  scoreHistogram,
  STATS_RANGE_LABELS,
  STATS_RANGES,
  statsTitle,
  summary,
  watches,
  type BucketSize,
  type ScoreBin,
  type StatsBucket,
  type StatsRange,
  type StatsSlice,
} from "@/lib/stats";
import { libraryRepository } from "@/lib/storage";
import type { ListStatus, Title } from "@/lib/types";
import styles from "./stats.module.css";

// Ports the macOS Views/Stats/StatsView (LIB-291) with plain CSS bar charts.

type Loaded = { titles: Title[]; events: ReturnType<typeof allEvents>; now: Date; calendar: Calendar };

const BUCKET_LABELS: Record<BucketSize, string> = { week: "Week", month: "Month" };
const number = new Intl.NumberFormat("en-US");
const hoursFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const bucketFormat: Record<BucketSize, Intl.DateTimeFormat> = {
  week: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }),
  month: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }),
};
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

async function load(): Promise<Loaded> {
  const repo = await libraryRepository();
  const titles = await repo.listTitles();
  const inputs = await Promise.all(titles.map(async (title) => statsTitle(title, await repo.listWatchEvents(title))));
  return { titles, events: allEvents(inputs), now: new Date(), calendar: localCalendar(firstWeekdayFor(navigator.language)) };
}

export function Stats() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [range, setRange] = useState<StatsRange>("threeMonths");
  const [bucketSize, setBucketSize] = useState<BucketSize>("week");

  useEffect(() => {
    let cancelled = false;
    void load().then((loaded) => { if (!cancelled) setData(loaded); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const header = <header className="page-header"><h1>Stats</h1><p>Your watching, by the numbers.</p></header>;
  if (error) return <>{header}<p role="alert">Couldn’t load your stats. Reload to try again.</p></>;
  if (data === null) {
    return <>{header}<div role="status" aria-label="Loading stats" className={styles.loading}><Skeleton height={48} /><Skeleton height={96} /><Skeleton height={220} /></div></>;
  }
  if (data.titles.length === 0) {
    return (
      <>
        {header}
        <EmptyState icon="stats" title="Stats need a few logs">
          Log some episodes and movies to see your watch time, rewatches and favorite genres.
        </EmptyState>
      </>
    );
  }

  const { now, calendar } = data;
  const start = rangeStart(range, now, calendar);
  const events = filterEvents(data.events, start, now);
  const totals = summary(events);
  const series = buckets(events, bucketSize, start, now, calendar);

  return (
    <>
      {header}
      <div className={styles.controls}>
        <Segmented label="Date range" value={range} options={STATS_RANGES} onChange={setRange}
          render={(r) => r === "allTime" ? "All Time" : <><span className="sr-only">Last </span>{STATS_RANGE_LABELS[r].replace("Last ", "")}</>} />
        <Segmented label="Group charts by" value={bucketSize} options={BUCKET_SIZES} onChange={setBucketSize} render={(b) => BUCKET_LABELS[b]} />
      </div>

      <dl className={styles.tiles} aria-label={`Totals, ${STATS_RANGE_LABELS[range]}`}>
        <Tile className={styles.hero} value={hoursFormat.format(hours(totals))} label={plural(hours(totals), "Hour watched", "Hours watched")} />
        <Tile value={number.format(totals.episodes)} label={plural(totals.episodes, "Episode", "Episodes")} />
        <Tile value={number.format(totals.movies)} label={plural(totals.movies, "Movie", "Movies")} />
        <Tile value={number.format(totals.firstWatches)} label={plural(totals.firstWatches, "First watch", "First watches")} />
        <Tile value={number.format(totals.rewatches)} label={plural(totals.rewatches, "Rewatch", "Rewatches")} />
      </dl>

      <div className={styles.grid}>
        {events.length === 0 ? (
          <p className={cx(styles.wide, styles.nothing)}>Nothing watched in this range.</p>
        ) : (
          <>
            <ColumnChart className={styles.wide} title="Episodes & Movies Watched" buckets={series} size={bucketSize} series="watches" />
            <ColumnChart className={styles.wide} title="Hours Watched" buckets={series} size={bucketSize} series="hours" />
            <Breakdown title="By Kind" slices={byKind(events)} />
            <Breakdown title="Anime vs. Other" slices={byOrigin(events)} />
            <Breakdown className={styles.wide} title="By Genre" slices={byGenre(events).slice(0, 12)} />
          </>
        )}
        <StatusCounts statuses={data.titles.map((t) => t.status)} />
        <ScoreChart bins={scoreHistogram(data.titles.map((t) => t.score))} />
      </div>
    </>
  );
}

type SegmentedProps<T extends string> = { label: string; value: T; options: readonly T[]; onChange: (value: T) => void; render: (value: T) => ReactNode };

/** A radio group styled as a 44px segmented control. */
function Segmented<T extends string>({ label, value, options, onChange, render }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={styles.segmented} style={{ "--count": options.length } as CSSProperties}>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option} className={styles.segment}>
          <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
          <span>{render(option)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Tile({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <div className={cx(styles.tile, className)}>
      <dt className={styles.tileLabel}>{label}</dt>
      <dd className={styles.tileValue}>{value}</dd>
    </div>
  );
}

function Section({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={cx("section", styles.section, className)} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <ul className={styles.legend} aria-hidden="true">
      {items.map(([label, color]) => <li key={label}><span className={styles.swatch} style={{ background: color }} />{label}</li>)}
    </ul>
  );
}

const FIRST = "var(--accent)";
const REWATCH = "var(--status-rewatching)";
const HOURS = "var(--status-caughtUp)";
const SCORE = "var(--status-onHold)";
const pct = (value: number, max: number) => `${max > 0 ? (value / max) * 100 : 0}%`;

type ColumnChartProps = { title: string; buckets: StatsBucket[]; size: BucketSize; series: "watches" | "hours"; className?: string };

/** Vertical bars per week or month: first watches stacked under rewatches, or hours. */
function ColumnChart({ title, buckets, size, series, className }: ColumnChartProps) {
  const value = series === "watches" ? watches : hours;
  const max = Math.max(...buckets.map(value), 0);
  const format = (b: StatsBucket) => bucketFormat[size].format(b.start);
  const describe = (b: StatsBucket) =>
    series === "watches" ? `${format(b)}: ${b.firstWatches} first, ${b.rewatches} rewatch` : `${format(b)}: ${hoursFormat.format(hours(b))} h`;
  const ticks = buckets.length > 2 ? [buckets[0], buckets[Math.floor(buckets.length / 2)], buckets.at(-1)!] : buckets;

  return (
    <Section title={title} className={className}>
      {series === "watches" && <Legend items={[["First watch", FIRST], ["Rewatch", REWATCH]]} />}
      <div className={styles.chart} aria-hidden="true">
        <span className={styles.max}>{series === "watches" ? number.format(max) : `${hoursFormat.format(max)} h`}</span>
        <div className={styles.columns} style={{ "--count": buckets.length } as CSSProperties}>
          {buckets.map((b) => (
            <div key={b.start.getTime()} className={styles.column} title={describe(b)}>
              <span className={styles.stack} style={{ height: pct(value(b), max) }}>
                {series === "watches" ? (
                  <>
                    <span style={{ flexGrow: b.firstWatches, background: FIRST }} />
                    <span style={{ flexGrow: b.rewatches, background: REWATCH }} />
                  </>
                ) : (
                  <span style={{ flexGrow: 1, background: HOURS }} />
                )}
              </span>
            </div>
          ))}
        </div>
        <div className={styles.ticks}>{ticks.map((b) => <span key={b.start.getTime()}>{format(b)}</span>)}</div>
      </div>
      <table className="sr-only">
        <caption>{title} per {BUCKET_LABELS[size].toLowerCase()}</caption>
        <thead><tr><th scope="col">{BUCKET_LABELS[size]} of</th>{series === "watches" ? <><th scope="col">First watches</th><th scope="col">Rewatches</th></> : <th scope="col">Hours</th>}</tr></thead>
        <tbody>
          {buckets.filter((b) => watches(b) > 0).map((b) => (
            <tr key={b.start.getTime()}><th scope="row">{format(b)}</th>{series === "watches" ? <><td>{b.firstWatches}</td><td>{b.rewatches}</td></> : <td>{hoursFormat.format(hours(b))}</td>}</tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/** Horizontal bars per slice, first watches then rewatches, annotated with watches and hours. */
function Breakdown({ title, slices, className }: { title: string; slices: StatsSlice[]; className?: string }) {
  const max = Math.max(...slices.map(watches), 0);
  return (
    <Section title={title} className={className}>
      <ul className={styles.bars}>
        {slices.map((slice) => (
          <li key={slice.label} className={styles.bar}>
            <span className={styles.barLabel}>{slice.label}</span>
            <span className={styles.track} aria-hidden="true">
              <span style={{ width: pct(slice.firstWatches, max), background: FIRST }} />
              <span style={{ width: pct(slice.rewatches, max), background: REWATCH }} />
            </span>
            <span className={styles.barValue}>
              {number.format(watches(slice))} · {hoursFormat.format(hours(slice))} h
              <span className="sr-only">, {slice.firstWatches} first {plural(slice.firstWatches, "watch", "watches")}, {slice.rewatches} {plural(slice.rewatches, "rewatch", "rewatches")}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function StatusCounts({ statuses }: { statuses: ListStatus[] }) {
  const counts = byStatus(statuses);
  const max = Math.max(...counts.map((c) => c.count), 0);
  return (
    <Section title="By List Status">
      <ul className={styles.bars}>
        {counts.map(({ status, count }) => (
          <li key={status} className={styles.bar}>
            <span className={styles.barLabel}>{STATUS_LABELS[status]}</span>
            <span className={styles.track} aria-hidden="true"><span style={{ width: pct(count, max), background: `var(--status-${status})` }} /></span>
            <span className={styles.barValue}>{number.format(count)}<span className="sr-only"> {plural(count, "title", "titles")}</span></span>
          </li>
        ))}
      </ul>
      <p className={styles.note}>All titles in your library, regardless of date range.</p>
    </Section>
  );
}

function ScoreChart({ bins }: { bins: ScoreBin[] }) {
  const max = Math.max(...bins.map((b) => b.count), 0);
  return (
    <Section title="Score Distribution">
      {max === 0 ? (
        <p>Score titles in their detail view to see the distribution.</p>
      ) : (
        <>
          <ol className={styles.scores}>
            {bins.map((bin) => (
              <li key={bin.score} className={styles.score}>
                <span className={styles.scoreCount} aria-hidden="true">{bin.count || ""}</span>
                <span className={styles.scoreBar} style={{ height: pct(bin.count, max), background: SCORE }} aria-hidden="true" />
                <span className={styles.scoreLabel}><span className="sr-only">Score </span>{bin.score}<span className="sr-only">: {bin.count} {plural(bin.count, "title", "titles")}</span></span>
              </li>
            ))}
          </ol>
          <p className={styles.note}>All scored titles, regardless of date range.</p>
        </>
      )}
    </Section>
  );
}
