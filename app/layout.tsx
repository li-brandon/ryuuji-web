import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { QuickAdd } from "@/components/QuickAdd";
import { ThemeSync, ThemeToggle } from "@/components/ui/ThemeToggle";
import { ToastProvider } from "@/components/ui/Toast";
import { APP_NAME } from "@/lib/app";
import { THEME_SCRIPT } from "@/lib/theme";
import "./tokens.css";
import "./globals.css";

// Inter for UI text, Fraunces for display headings. Self-hosted by next/font at build time.
const text = Inter({ subsets: ["latin"], variable: "--font-text", display: "swap" });
const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: APP_NAME,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The inline script may set data-theme before hydration.
    <html lang="en" className={`${text.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <ToastProvider>
          <a className="skip-link" href="#content">
            Skip to content
          </a>
          <div className="shell">
            <div className="chrome">
              <header className="topbar">
                <Link href="/" className="brand">
                  <span className="brand-mark" aria-hidden="true">
                    R
                  </span>
                  {APP_NAME}
                </Link>
                <QuickAdd />
              </header>
              <Nav />
              <div className="sidebar-footer">
                <ThemeToggle compact />
              </div>
            </div>
            <main id="content" className="content">
              {children}
            </main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
