import type { Metadata } from "next";
import Link from "next/link";

import { AnomalyRow } from "@/components/anomaly-row";
import { EmptyState, OfflineState } from "@/components/empty-state";
import { FeedFilters } from "@/components/feed-filters";
import { fetchActiveTeams, fetchFeed } from "@/db/queries";
import { fmtDate } from "@/lib/format";
import { ANOMALY_TYPES, type AnomalyType } from "@/types/insight";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "FormWatch — the EPL anomaly board",
};

function parseFilters(sp: { [key: string]: string | string[] | undefined }) {
  const typeParam = typeof sp.type === "string" ? sp.type : undefined;
  const type = ANOMALY_TYPES.includes(typeParam as AnomalyType)
    ? (typeParam as AnomalyType)
    : undefined;
  const team = typeof sp.team === "string" ? sp.team : undefined;
  const sev = typeof sp.sev === "string" ? sp.sev : "60";
  const minSeverity = sev === "all" ? 0 : Number.parseInt(sev, 10) || 60;
  return { type, team, minSeverity };
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const filters = parseFilters(await searchParams);
  const [rows, teams] = await Promise.all([
    fetchFeed(filters),
    fetchActiveTeams(),
  ]);

  const asOf = rows?.[0]?.asOf ?? null;
  const matchweek = rows?.[0]?.matchweek ?? null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="rise relative overflow-hidden border-b border-border pb-8">
        {/* faint pitch markings: halfway line + centre circle */}
        <svg
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 text-foreground/[0.05]"
          viewBox="0 0 200 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="100" cy="100" r="60" />
          <circle cx="100" cy="100" r="3" fill="currentColor" stroke="none" />
          <line x1="-40" y1="100" x2="240" y2="100" />
        </svg>

        <p className="microlabel">
          English Premier League
          {matchweek ? ` · matchweek ${matchweek}` : ""}
          {asOf ? ` · data through ${fmtDate(asOf)}` : ""}
        </p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-7xl">
          The anomaly
          <br />
          <span className="text-primary">board</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Player form, audited weekly. Gamma-Poisson posteriors nominate the
          movers, Benjamini-Hochberg keeps the false positives out, and every
          surviving anomaly arrives with its statistical evidence attached.
        </p>
        <Link
          href="/how-it-works"
          className="microlabel mt-4 inline-block transition-colors hover:text-primary"
        >
          new here? take the interactive tour →
        </Link>
      </header>

      <div className="sticky top-14 z-40 -mx-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <FeedFilters teams={teams ?? []} count={rows?.length ?? 0} />
      </div>

      <section className="mt-6">
        {rows === null ? (
          <OfflineState />
        ) : rows.length === 0 ? (
          <EmptyState
            title="A quiet week"
            detail="No active anomaly clears the current filters. Lower the severity floor to see the watchlist — or trust that the league is simply behaving."
          />
        ) : (
          <ol className="space-y-2">
            {rows.map((row, i) => (
              <li key={row.id}>
                <AnomalyRow row={row} index={i} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
