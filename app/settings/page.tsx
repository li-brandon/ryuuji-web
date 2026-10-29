import { MetadataSettings } from "@/components/MetadataRefresh";
import { WatchProviderSettings } from "@/components/WatchProviderSettings";
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function SettingsPage() {
  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
        <p>Make Ryuuji yours.</p>
      </header>
      <div className="stack">
        <section className="section">
          <h2>Appearance</h2>
          <p>System follows your device’s light or dark setting. Your choice is saved on this device.</p>
          <ThemeToggle />
        </section>
        <MetadataSettings />
        <WatchProviderSettings />
        <section className="section">
          <h2>Design system</h2>
          <p>Every shared component in light and dark, side by side.</p>
          <Link href="/components" className={buttonClass({}, "self-start")}>
            Open component gallery
          </Link>
        </section>
      </div>
    </>
  );
}
