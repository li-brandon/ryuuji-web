"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Up Next", icon: "upNext" },
  { href: "/library", label: "Library", icon: "library" },
  { href: "/seasonal", label: "Seasonal", icon: "seasonal" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/stats", label: "Stats", icon: "stats" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

/** Sidebar on desktop, bottom tab bar on phones (see globals.css). */
export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      <ul>
        {ITEMS.map(({ href, label, icon }) => (
          <li key={href}>
            <Link href={href} aria-current={pathname === href ? "page" : undefined}>
              <span className="nav-icon">
                <Icon name={icon} size={22} />
              </span>
              <span className="nav-label">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
