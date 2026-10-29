"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow } from "@/components/ui/ListRow";
import { Poster } from "@/components/ui/Poster";
import { PosterCard } from "@/components/ui/PosterCard";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusPill, STATUS_LABELS } from "@/components/ui/StatusPill";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Toast, useToast } from "@/components/ui/Toast";
import { posterUrl } from "@/lib/quick-add";
import type { ListStatus } from "@/lib/types";
import styles from "./gallery.module.css";

const EPISODES = 28;
const STATUSES = Object.keys(STATUS_LABELS) as ListStatus[];

export function Gallery() {
  return (
    <div className={styles.panes}>
      <Pane theme="light" />
      <Pane theme="dark" />
    </div>
  );
}

function Pane({ theme }: { theme: "light" | "dark" }) {
  const toast = useToast();
  const [watched, setWatched] = useState(17);
  const [sheetOpen, setSheetOpen] = useState(false);

  function log() {
    const episode = Math.min(EPISODES, watched + 1);
    setWatched(episode);
    toast({ message: `Logged Frieren episode ${episode}`, actionLabel: "Undo", onAction: () => setWatched(episode - 1) });
  }

  return (
    <section data-theme={theme} className={styles.pane} aria-label={`${theme} theme`}>
      <h2 className={styles.paneTitle}>{theme === "light" ? "Light" : "Dark"}</h2>

      <Group title="Button">
        <div className={styles.row}>
          <Button variant="primary">Log episode</Button>
          <Button>Add to library</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Remove</Button>
        </div>
        <div className={styles.row}>
          <Button variant="primary" size="sm" icon="plus">
            Small
          </Button>
          <Button variant="primary" size="lg" icon="check">
            Large
          </Button>
          <Button icon="search" aria-label="Search" />
          <Button disabled>Disabled</Button>
        </div>
      </Group>

      <Group title="StatusPill">
        <div className={styles.row}>
          {STATUSES.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </div>
      </Group>

      <Group title="PosterCard">
        <div className={styles.posters}>
          <PosterCard
            title="Frieren: Beyond Journey’s End"
            src={posterUrl("/dqZENchTd7lp5zht7BdlqM7RBhD.jpg", "w342")}
            status={watched === EPISODES ? "caughtUp" : "watching"}
            progress={watched / EPISODES}
          />
          <PosterCard title="Inception" src={posterUrl("/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg", "w342")} status="completed" subtitle="2010" />
          <PosterCard title="A title without artwork" src={null} status="planToWatch" />
        </div>
        <div className={styles.row}>
          <Button variant="primary" icon="check" onClick={log} disabled={watched === EPISODES}>
            Log next episode
          </Button>
          <span className={styles.caption}>
            {watched} of {EPISODES} watched
          </span>
        </div>
      </Group>

      <Group title="ListRow">
        <ul className={styles.list}>
          <ListRow leading={<Poster src={posterUrl("/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg")} small />} title="Inception" subtitle="2010 · Movie" trailing={<StatusPill status="completed" />} />
          <ListRow
            aria-selected
            role="option"
            leading={<Poster src={null} small />}
            title="Interstellar: A Very Long Title That Has To Truncate Nicely"
            subtitle="2014 · Movie · selected"
            trailing={<Button size="sm" icon="plus">Add</Button>}
          />
        </ul>
      </Group>

      <Group title="Toast">
        <Toast message="Logged Frieren episode 18" actionLabel="Undo" onAction={() => {}} />
        <div className={styles.row}>
          <Button onClick={() => toast({ message: "Added “Inception” to Plan to Watch", actionLabel: "Undo", onAction: () => {} })}>Show a toast</Button>
        </div>
      </Group>

      <Group title="Sheet">
        <div className={styles.row}>
          <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
          <span className={styles.caption}>Bottom sheet on phones, centered on desktop.</span>
        </div>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} label="Mark as watched" title>
          <p className={styles.caption}>Log every episode of season 1 up to episode 18? You can undo this from the toast.</p>
          <div className={styles.row}>
            <Button
              variant="primary"
              onClick={() => {
                setSheetOpen(false);
                toast({ message: "Logged 18 episodes", actionLabel: "Undo", onAction: () => {} });
              }}
            >
              Mark watched
            </Button>
            <Button variant="ghost" onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      </Group>

      <Group title="EmptyState">
        <div className={styles.frame}>
          <EmptyState icon="history" title="No watches logged yet" action={<Button variant="primary">Find something</Button>}>
            Log an episode and it shows up here.
          </EmptyState>
        </div>
      </Group>

      <Group title="Skeleton">
        <div className={styles.skeletonRow}>
          <Skeleton variant="poster" width={46} />
          <span className={styles.skeletonText}>
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width="40%" />
          </span>
          <Skeleton variant="circle" width={32} height={32} />
        </div>
        <div className={styles.posters} aria-label="Loading posters">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="poster" />
          ))}
        </div>
      </Group>

      <Group title="ThemeToggle">
        <ThemeToggle />
      </Group>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      {children}
    </div>
  );
}
