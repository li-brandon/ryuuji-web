"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Up Next" },
  { href: "/library", label: "Library" },
  { href: "/seasonal", label: "Seasonal" },
  { href: "/history", label: "History" },
  { href: "/stats", label: "Stats" },
  { href: "/settings", label: "Settings" },
];

/** Sidebar on desktop, bottom tab bar on phones (see globals.css). */
export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      <ul>
        {ITEMS.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} aria-current={pathname === href ? "page" : undefined}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
