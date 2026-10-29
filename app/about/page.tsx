import Image from "next/image";
import Link from "next/link";
import { JustWatchAttribution } from "@/components/WatchProviders";
import { APP_NAME, APP_TAGLINE, TMDB_NOTICE } from "@/lib/app";
import styles from "./about.module.css";

// Port of the macOS AboutView. TMDB's terms: their logo must be less prominent than our own
// branding and sit next to their exact notice.

export default function AboutPage() {
  return (
    <>
      <header className={styles.hero}>
        <span className={styles.mark} aria-hidden="true">
          R
        </span>
        <h1>{APP_NAME}</h1>
        <p>{APP_TAGLINE}</p>
      </header>
      <div className="stack">
        <section className="section" aria-labelledby="about-data">
          <h2 id="about-data">Data</h2>
          <Image src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" width={120} height={16} className={styles.logo} unoptimized />
          <p>{TMDB_NOTICE}</p>
          <p>Titles, episodes, posters and air dates come from The Movie Database.</p>
          <a className={styles.link} href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            Visit themoviedb.org
          </a>
          <JustWatchAttribution />
        </section>
        <section className="section" aria-labelledby="about-use">
          <h2 id="about-use">Non-commercial</h2>
          <p>{APP_NAME} is a personal, non-commercial project. It is free, shows no ads and sells nothing, in line with TMDB’s API terms.</p>
          <p>Your library stays in this browser’s storage on this device. Use Settings to back it up.</p>
          <Link className={styles.link} href="/settings">
            Back to Settings
          </Link>
        </section>
      </div>
    </>
  );
}
