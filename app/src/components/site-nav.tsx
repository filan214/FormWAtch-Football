"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Anomaly board" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/methodology", label: "Methodology" },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-0.5">
          <span className="font-display text-2xl font-bold uppercase tracking-tight">
            Form
          </span>
          <span className="inline-block h-5 w-2 -skew-x-12 bg-primary transition-transform group-hover:skew-x-12" />
          <span className="font-display text-2xl font-bold uppercase tracking-tight text-muted-foreground transition-colors group-hover:text-foreground">
            Watch
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/anomaly")
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "microlabel rounded-sm px-2.5 py-1.5 transition-colors hover:text-foreground sm:px-3",
                  active && "bg-accent text-primary hover:text-primary",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
