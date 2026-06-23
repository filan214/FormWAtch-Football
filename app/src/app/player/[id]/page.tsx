import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, OfflineState } from "@/components/empty-state";
import { FormTimelineChart } from "@/components/form-timeline-chart";
import { PlayerAvatar } from "@/components/player-avatar";
import { TypeBadge } from "@/components/type-badge";
import { fetchPlayerTimeline } from "@/db/queries";
import { severityTier } from "@/lib/anomaly";
import { fmtDate } from "@/lib/format";

export const revalidate = 3600;

export function generateStaticParams() {
  return []; // on-demand ISR
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await fetchPlayerTimeline(Number(id));
  if (!data || data === "not-found") return { title: "Player" };
  return { title: `${data.player.name} — form timeline` };
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  const data = await fetchPlayerTimeline(numericId);
  if (data === "not-found") notFound();
  if (data === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <OfflineState />
      </div>
    );
  }

  const { player, points, anomalies } = data;
  const active = anomalies.filter((a) => a.status === "active");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav className="microlabel">
        <Link href="/" className="transition-colors hover:text-primary">
          ← anomaly board
        </Link>
      </nav>

      <header className="rise mt-6 flex flex-wrap items-center gap-5 border-b border-border pb-8">
        <PlayerAvatar
          name={player.name}
          className="size-16 text-2xl sm:size-20 sm:text-3xl"
        />
        <div className="min-w-0 flex-1">
          <p className="microlabel">
            {player.team ?? "—"}
            {player.position ? ` · ${player.position}` : ""}
            {points.length
              ? ` · ${points.length} qualifying matches on record`
              : ""}
          </p>
          <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-none tracking-tight sm:text-6xl">
            {player.name}
          </h1>
        </div>
        {active.length > 0 ? (
          <div className="flex flex-col items-end gap-2">
            <p className="microlabel">currently flagged</p>
            <div className="flex flex-wrap justify-end gap-2">
              {active.map((a) => (
                <Link key={a.id} href={`/anomaly/${a.id}`}>
                  <TypeBadge type={a.anomalyType} size="sm" />
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      <section className="rise mt-8 rounded-sm border border-border bg-card px-5 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide">
            Form timeline
          </h2>
          <p className="microlabel">
            composite involvement index · z-scored per-90s, averaged
          </p>
        </div>
        {points.length >= 2 ? (
          <div className="mt-4">
            <FormTimelineChart points={points} anomalies={anomalies} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Not enough qualifying matches to draw a timeline yet.
          </p>
        )}
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          This is the exact signal the PELT change-point detector reads: each
          per-90 involvement metric z-scored over the player&#39;s own
          history, then averaged per match. Solid verticals are detected
          regime shifts; dashed verticals mark anomaly evaluation weeks.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">
          Anomaly record
        </h2>
        {anomalies.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Clean sheet"
              detail="No anomaly — active or resolved — on record for this player."
            />
          </div>
        ) : (
          <ol className="mt-4 space-y-2">
            {anomalies.map((a, i) => {
              const tier = severityTier(a.severity);
              return (
                <li key={a.id}>
                  <Link
                    href={`/anomaly/${a.id}`}
                    className="rise group flex items-center gap-4 rounded-sm border border-border bg-card px-4 py-3 transition-colors hover:bg-accent sm:gap-6"
                    style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  >
                    <span
                      className="w-12 shrink-0 text-right font-display text-3xl font-bold tnum"
                      style={{ color: tier.color }}
                    >
                      {a.severity}
                    </span>
                    <TypeBadge type={a.anomalyType} size="sm" />
                    <span className="microlabel hidden sm:inline">
                      {a.asOf ? `as of ${fmtDate(a.asOf)}` : ""}
                      {a.matchweek ? ` · mw ${a.matchweek}` : ""}
                      {` · ${a.persistenceWeeks} wk${a.persistenceWeeks === 1 ? "" : "s"}`}
                    </span>
                    <span className="microlabel ml-auto flex items-center gap-1.5">
                      <span
                        className={
                          a.status === "active"
                            ? "inline-block size-1.5 rounded-full bg-primary"
                            : "inline-block size-1.5 rounded-full bg-muted-foreground/50"
                        }
                      />
                      {a.status ?? "unknown"}
                    </span>
                    <span
                      aria-hidden
                      className="font-display text-xl text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary"
                    >
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
