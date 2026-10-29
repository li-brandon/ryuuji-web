"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/Button";
import { JustWatchAttribution, ProviderLogo, useWatchPreferences } from "./WatchProviders";
import { libraryRepository } from "@/lib/storage";
import { tmdbFetch } from "@/lib/tmdb-client";
import { refreshWatchProviders } from "@/lib/watch-provider-client";
import { loadProviderCatalog, saveProviderCatalog, saveWatchPreferences } from "@/lib/watch-preferences";
import { mergeProviderCatalog, providerListSchema, regionsSchema } from "@/lib/watch-providers";
import type { ProviderInfo } from "@/lib/types";
import styles from "./watch-providers.module.css";

export function WatchProviderSettings() {
  const preferences = useWatchPreferences();
  const { region, services } = preferences;
  const [regions, setRegions] = useState<ReturnType<typeof regionsSchema.parse>["results"]>([]);
  const [catalog, setCatalog] = useState<{ region: string; providers: ProviderInfo[] }>({ region: "", providers: [] });
  const [search, setSearch] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      setCatalog({ region, providers: loadProviderCatalog(region) });
      const results = await Promise.allSettled([
        tmdbFetch<unknown>("watch/providers/regions", { language: "en-US" }).then((response) => regionsSchema.parse(response).results),
        Promise.all(["movie", "tv"].map(async (kind) => providerListSchema.parse(await tmdbFetch<unknown>(`watch/providers/${kind}`, { watch_region: region, language: "en-US" })))).then((lists) => mergeProviderCatalog(lists, region)),
      ]);
      if (cancelled) return;
      const [regionResult, providerResult] = results;
      if (regionResult.status === "fulfilled") setRegions(regionResult.value.sort((a, b) => a.english_name.localeCompare(b.english_name)));
      if (providerResult.status === "fulfilled") {
        setCatalog({ region, providers: providerResult.value });
        saveProviderCatalog(region, providerResult.value);
      }
      setError(results.some((result) => result.status === "rejected"));
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [region, attempt]);
  async function changeRegion(next: string) {
    saveWatchPreferences({ ...preferences, region: next });
    // Refresh sequentially to avoid flooding the proxy. Earlier region requests cannot replace this cache.
    try {
      const repo = await libraryRepository();
      for (const title of await repo.listTitles()) await refreshWatchProviders(repo, title, next).catch(() => {});
    } catch { /* Region preferences remain saved while offline. */ }
  }
  const providers = catalog.region === region ? catalog.providers : [];
  const filtered = providers.filter((provider) => provider.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="section" aria-labelledby="watch-settings">
    <h2 id="watch-settings">Where to watch</h2>
    <p>Choose your region and subscriptions. Your choices are saved on this device.</p>
    <div className={styles.controls}>
      <label>Region<select value={region} onChange={(event) => void changeRegion(event.target.value)}>
        {!regions.some((item) => item.iso_3166_1 === region) && <option value={region}>{region}</option>}
        {regions.map((item) => <option key={item.iso_3166_1} value={item.iso_3166_1}>{item.english_name} ({item.iso_3166_1})</option>)}
      </select></label>
      <fieldset><legend>My services</legend><p>{services.length ? `${services.length} selected.` : "Pick the services you subscribe to."} Titles show badges for these services.</p>
        <label>Search services<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className={styles.services} aria-busy={loading}>
          {filtered.map((provider) => <label className={styles.service} key={provider.id}><input type="checkbox" checked={services.includes(provider.id)} onChange={(event) => saveWatchPreferences({ region, services: event.target.checked ? [...new Set([...services, provider.id])] : services.filter((id) => id !== provider.id) })} /><ProviderLogo provider={provider} /></label>)}
          {!filtered.length && <p>{loading ? "Loading services…" : providers.length ? "No services match your search." : error ? "Services are unavailable. Your selections are saved." : "No services listed for this region."}</p>}
        </div>
      </fieldset>
      {error && <div role="status"><p>Couldn’t load the latest regions or services from TMDB.</p><Button onClick={() => setAttempt((value) => value + 1)}>Retry</Button></div>}
      <JustWatchAttribution />
    </div>
  </section>;
}
