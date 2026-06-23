import type { Metadata } from "next";

import { OfflineState } from "@/components/empty-state";
import { LeaderboardTabs } from "@/components/leaderboard-tables";
import { fetchLeaderboards } from "@/db/queries";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Leaderboards",
};

export default async function LeaderboardsPage() {
  const data = await fetchLeaderboards();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="rise border-b border-border pb-8">
        <p className="microlabel">
          {data?.season ? `EPL ${data.season}` : "EPL"} · qualifying
          appearances only (≥ 30 minutes)
        </p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-7xl">
          Leader<span className="text-primary">boards</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Season-scale context around the weekly anomaly board: who is beating
          their expected numbers, whose underlying volume just jumped, and who
          the regression bath is being drawn for.
        </p>
      </header>

      <section className="rise mt-8" style={{ animationDelay: "120ms" }}>
        {data === null ? <OfflineState /> : <LeaderboardTabs rows={data.rows} />}
      </section>
    </div>
  );
}
