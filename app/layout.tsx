import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/Nav";
import { QuickAdd } from "@/components/QuickAdd";
import { APP_NAME } from "@/lib/app";
import "./globals.css";

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
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <span className="brand">{APP_NAME}</span>
            <QuickAdd />
          </header>
          <Nav />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
