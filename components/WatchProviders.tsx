"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { posterUrl } from "@/lib/quick-add";
import { libraryRepository } from "@/lib/storage";
import { refreshWatchProviders } from "@/lib/watch-provider-client";
import { DEFAULT_PREFERENCES, parsePreferences, preferenceSnapshot, subscribeWatchPreferences } from "@/lib/watch-preferences";
import { JUSTWATCH_URL, providerBadges, watchLink } from "@/lib/watch-providers";
import type { ProviderInfo, Title, WatchProviderData } from "@/lib/types";
import styles from "./watch-providers.module.css";

const serverSnapshot = () => JSON.stringify(DEFAULT_PREFERENCES);
export function useWatchPreferences() {
  return parsePreferences(useSyncExternalStore(subscribeWatchPreferences, preferenceSnapshot, serverSnapshot));
}

// Detail and badges may mount together; share the same request for a title and region.
const pending = new Map<string, Promise<void>>();
function useProviderData(title: Title, region: string) {
  const [loaded, setLoaded] = useState<WatchProviderData | null>(null);
  const fromTitle = title.providerData?.region === region ? title.providerData : null;
  const cached = loaded?.region === region && (!fromTitle || loaded.fetchedAt > fromTitle.fetchedAt) ? loaded : fromTitle;
  const { tmdbId, kind } = title;
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    const id = `${kind}-${tmdbId}-${region}`;
    let request = pending.get(id);
    if (!request) {
      request = libraryRepository().then((repo) => refreshWatchProviders(repo, { kind, tmdbId }, region)).finally(() => pending.delete(id));
      pending.set(id, request);
    }
    void request.then(async () => {
      const current = await (await libraryRepository()).getTitle({ kind, tmdbId });
      if (!cancelled) setLoaded(current?.providerData ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [cached, region, tmdbId, kind]);
  return cached;
}

export function ProviderLogo({ provider }: { provider: ProviderInfo }) {
  const [failed, setFailed] = useState(false);
  const src = posterUrl(provider.logoPath, "w92");
  return <>{src && !failed && (
    // TMDB already provides appropriately sized images; names remain visible if artwork fails.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.logo} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  )}<span>{provider.name}</span></>;
}
export function JustWatchAttribution() {
  return <a className={styles.attribution} href={JUSTWATCH_URL} target="_blank" rel="noreferrer">Streaming data by JustWatch</a>;
}
export function WatchProviderBadges({ title }: { title: Title }) {
  const preferences = useWatchPreferences();
  const data = useProviderData(title, preferences.region);
  const badges = providerBadges(data, preferences.region, new Set(preferences.services));
  if (!badges.shown.length) return null;
  return <span className={styles.badges}>{badges.shown.map((provider) => <span key={provider.id} className={styles.badge} role="img" aria-label={`On ${provider.name}`} title={`On ${provider.name} · Streaming data by JustWatch`}><ProviderLogo provider={provider} /></span>)}{badges.overflow > 0 && <span>+{badges.overflow} more</span>}</span>;
}
export function WhereToWatch({ title }: { title: Title }) {
  const { region, services } = useWatchPreferences();
  const data = useProviderData(title, region);
  const groups = [{ label: "Stream", providers: data?.providers ?? [] }, { label: "Rent", providers: data?.rent ?? [] }, { label: "Buy", providers: data?.buy ?? [] }];
  return <section className={styles.section} aria-labelledby="where-to-watch">
    <h2 id="where-to-watch">Where to watch <span className={styles.region}>{region}</span></h2>
    {data ? groups.some((group) => group.providers.length) ? groups.map(({ label, providers }) => providers.length > 0 && <div key={label} className={styles.group}><h3>{label}</h3><ul className={styles.providers}>{providers.map((provider) => <li key={provider.id} className={services.includes(provider.id) ? styles.selected : styles.provider}><ProviderLogo provider={provider} />{services.includes(provider.id) && <span className={styles.mine}>My service</span>}</li>)}</ul></div>) : <p>No streaming, rental or purchase options listed in {region}.</p> : <p>Availability isn’t cached for {region}. Connect to TMDB or use Refresh to try again.</p>}
    {data?.link && <a className={styles.attribution} href={watchLink(data.link)} target="_blank" rel="noreferrer">Watch options on TMDB</a>}
    <JustWatchAttribution />
  </section>;
}
