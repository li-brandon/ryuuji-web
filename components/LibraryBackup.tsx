"use client";

import { useRef, useState } from "react";
import { Button } from "./ui/Button";
import { exportLibrary, previewImport, type ImportPlan } from "@/lib/library-import";
import { libraryRepository } from "@/lib/storage";
import { useMetadataScheduler } from "./MetadataRefresh";

export function LibraryBackup() {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const scheduler = useMetadataScheduler();
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t access the library. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="section" aria-labelledby="backup-heading">
    <h2 id="backup-heading">Backup &amp; import</h2>
    <p>Save your library as JSON, or import a Ryuuji backup or macOS library export. Includes titles, watch history, theme and watch preferences.</p>
    <Button className="self-start" disabled={busy} onClick={() => void run(async () => {
      const file = await exportLibrary(await libraryRepository());
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `ryuuji-library-${file.exportedAt.slice(0, 10)}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    })}>Export library</Button>
    <input ref={input} id="library-file" type="file" accept=".json,application/json" hidden disabled={busy} onChange={(event) => {
      const file = event.target.files?.[0];
      setPlan(null); event.target.value = "";
      if (file) void run(async () => { setPlan(await previewImport(await libraryRepository(), await file.text())); });
    }} />
    <Button className="self-start" disabled={busy} onClick={() => input.current?.click()}>Import file</Button>
    {plan && <div className="stack" role="region" aria-label="Import preview">
      <h3>Import preview</h3>
      <p>{plan.counts.titlesToAdd} titles to add · {plan.counts.titlesToMerge} titles to merge · {plan.counts.titlesUnchanged} titles unchanged</p>
      <p>{plan.counts.eventsToAdd} events to add · {plan.counts.eventsAlreadyPresent} events already present · {plan.counts.conflicts} conflicts</p>
      <p>Incoming non-empty choices win when modification times are unavailable. Empty incoming values never erase local choices. Conflicting event IDs keep the existing event.</p>
      <div style={{ maxHeight: "20rem", overflowY: "auto", fontSize: "0.875rem", overflowWrap: "anywhere" }} tabIndex={0} aria-label="Import details">
        <ul>{plan.titleDiffs.map((title) => <li key={`${title.kind}:${title.tmdbId}`}>
          <strong>{title.name} ({title.kind}:{title.tmdbId})</strong>
          <ul>{title.changes.map((change) => <li key={change.field}>{change.field}: {displayValue(change.oldValue)} → {displayValue(change.newValue)}</li>)}
            {title.discarded.map((item) => <li key={`discarded-${item.field}`}>Discarded {item.field}: {displayValue(item.value)} — {item.reason}</li>)}
          </ul>
          {!title.changes.length && !title.discarded.length && <span> No title fields change.</span>}
        </li>)}</ul>
        {plan.settingsChanges.length > 0 && <><h4>Settings</h4><ul>{plan.settingsChanges.map((change) => <li key={change.field}>{change.field}: {displayValue(change.oldValue)} → {displayValue(change.newValue)}</li>)}</ul></>}
      </div>
      <Button variant="primary" className="self-start" disabled={busy || !scheduler} onClick={() => void run(async () => {
        const result = await (await libraryRepository()).importLibrary(plan);
        scheduler?.queueTitles([...result.titles, ...result.events]);
        setPlan(null); setMessage(result.titles.length || result.events.length || result.settingsChanges.length ? "Library and settings imported. Metadata refresh queued." : "Your library is already up to date. Nothing changed.");
      })}>Confirm import</Button>
      <Button className="self-start" disabled={busy} onClick={() => { setPlan(null); setError(""); }}>Cancel</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{busy ? "Working…" : message}</p>
  </section>;
}

function displayValue(value: unknown): string {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}
