import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OfflineState } from "@/components/empty-state";
import { EvidenceBars, type EvidenceBarDatum } from "@/components/evidence-bars";
import { EvidencePanel } from "@/components/evidence-panel";
import {
  InsightFallback,
  InsightNarrative,
} from "@/components/insight-narrative";
import { MatchesTable } from "@/components/matches-table";
import { PlayerAvatar } from "@/components/player-avatar";
import { PosteriorCurves } from "@/components/posterior-curves";
import { TypeBadge } from "@/components/type-badge";
import { fetchAnomalyDetail } from "@/db/queries";
import { TYPE_META, metricLabel, severityTier } from "@/lib/anomaly";
import { fmtDate, fmtP } from "@/lib/format";
import { fitGammaFromCi, posteriorCurves } from "@/lib/gamma";
import { parseInsight } from "@/types/insight";

export const revalidate = 3600;

export function generateStaticParams() {
  return []; // on-demand ISR; anomaly ids change weekly
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await fetchAnomalyDetail(Number(id));
  if (!detail || detail === "not-found") return { title: "Anomaly" };
  return {
    title: `${detail.player.name} — ${TYPE_META[detail.anomaly.anomalyType].label}`,
  };
}

export default async function AnomalyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  const detail = await fetchAnomalyDetail(numericId);
  if (detail === "not-found") notFound();
  if (detail === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <OfflineState />
      </div>
    );
  }

  const { anomaly, player, insightPayload, matchLines } = detail;
  const meta = TYPE_META[anomaly.anomalyType];
  const tier = severityTier(anomaly.severity ?? 0);
  const evidence = anomaly.evidence;
  const insight = insightPayload ? parseInsight(insightPayload) : null;

  // Posterior curves for the primary metric, reconstructed from stored CIs
  const primaryName = evidence?.primary_metric ?? null;
  const primary =
    primaryName && evidence?.metrics ? evidence.metrics[primaryName] : null;
  let curves = null;
  if (
    primary &&
    primary.baseline_rate &&
    primary.recent_rate &&
    primary.baseline_ci[0] &&
    primary.baseline_ci[1] &&
    primary.recent_ci[0] &&
    primary.recent_ci[1]
  ) {
    const base = fitGammaFromCi(
      primary.baseline_rate,
      primary.baseline_ci[0],
      primary.baseline_ci[1],
    );
    const recent = fitGammaFromCi(
      primary.recent_rate,
      primary.recent_ci[0],
      primary.recent_ci[1],
    );
    if (base && recent) {
      const xMax =
        Math.max(primary.baseline_ci[1], primary.recent_ci[1]) * 1.35;
      curves = {
        points: posteriorCurves(base, recent, xMax),
        baselineMean: primary.baseline_rate,
        recentMean: primary.recent_rate,
      };
    }
  }

  // Comparison bars: prefer the insight's keyEvidence, fall back to the
  // flagged evidence metrics so the chart survives a missing narrative.
  const bars: EvidenceBarDatum[] = insight
    ? insight.keyEvidence.map((e) => ({
        metric: metricLabel(e.metric),
        baseline: e.baseline,
        recent: e.recent,
        unit: e.unit,
      }))
    : Object.entries(evidence?.metrics ?? {})
        .filter(([, m]) => m.flagged)
        .map(([name, m]) => ({
          metric: metricLabel(name),
          baseline: m.baseline_rate ?? 0,
          recent: m.recent_rate ?? 0,
          unit: "per 90",
        }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav className="microlabel">
        <Link href="/" className="transition-colors hover:text-primary">
          ← anomaly board
        </Link>
      </nav>

      <header className="rise mt-6 flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
        <div className="flex items-center gap-5">
          <PlayerAvatar
            name={player.name}
            color={meta.color}
            className="size-16 text-2xl sm:size-20 sm:text-3xl"
          />
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <TypeBadge type={anomaly.anomalyType} />
              <span className="microlabel">
                {player.team ?? "—"}
                {player.position ? ` · ${player.position}` : ""}
                {anomaly.matchweek ? ` · mw ${anomaly.matchweek}` : ""}
                {evidence?.as_of ? ` · as of ${fmtDate(evidence.as_of)}` : ""}
              </span>
            </div>
            <h1 className="mt-2 font-display text-4xl font-bold uppercase leading-none tracking-tight sm:text-6xl">
              {player.name}
            </h1>
            <Link
              href={`/player/${player.id}`}
              className="microlabel mt-3 inline-block transition-colors hover:text-primary"
            >
              full form timeline →
            </Link>
          </div>
        </div>
        <div className="text-right">
          <p className="microlabel">severity</p>
          <p
            className="font-display text-7xl font-bold leading-none tnum sm:text-8xl"
            style={{ color: tier.color }}
          >
            {anomaly.severity}
          </p>
          <p className="microlabel mt-1">{tier.name}</p>
        </div>
      </header>

      {anomaly.detectorsFired?.length ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="microlabel">detectors fired</span>
          {anomaly.detectorsFired.map((d) => (
            <span
              key={d}
              className="rounded-sm border border-border bg-card px-2 py-1 font-mono text-[0.6875rem] text-foreground/80"
            >
              {d}
            </span>
          ))}
          <span className="microlabel ml-auto">
            fdr-adjusted p {fmtP(anomaly.fdrAdjustedP)}
          </span>
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          {insight ? (
            <InsightNarrative
              insight={insight}
              anomalyType={anomaly.anomalyType}
            />
          ) : (
            <InsightFallback anomalyType={anomaly.anomalyType} />
          )}

          {bars.length > 0 ? (
            <section className="rounded-sm border border-border bg-card px-5 py-5">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-display text-xl font-semibold uppercase tracking-wide">
                  Baseline vs recent
                </h2>
                <p className="microlabel">
                  <span className="text-foreground/60">■</span> baseline{" "}
                  <span style={{ color: meta.color }}>■</span> last 6
                </p>
              </div>
              <div className="mt-4">
                <EvidenceBars data={bars} color={meta.color} />
              </div>
              <p className="microlabel mt-2">{bars[0]?.unit ?? "per 90"}</p>
            </section>
          ) : null}

          {matchLines.length > 0 ? (
            <section className="rounded-sm border border-border bg-card px-5 py-5">
              <h2 className="font-display text-xl font-semibold uppercase tracking-wide">
                The matches behind it
              </h2>
              <p className="microlabel mt-1">
                last {matchLines.length} qualifying appearances before the
                evaluation date
              </p>
              <div className="mt-3">
                <MatchesTable data={matchLines} />
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-8">
          {curves && primaryName ? (
            <section className="rounded-sm border border-border bg-card px-5 py-5">
              <h2 className="font-display text-xl font-semibold uppercase tracking-wide">
                The two posteriors
              </h2>
              <p className="microlabel mt-1">
                {metricLabel(primaryName)} rate /90 · baseline vs last 6
              </p>
              <PosteriorCurves
                points={curves.points}
                color={meta.color}
                baselineMean={curves.baselineMean}
                recentMean={curves.recentMean}
              />
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Gamma posterior densities reconstructed from the stored 90%
                credible intervals. When the colored hump pulls clear of the
                grey one, the form change is real — not sampling noise.
              </p>
            </section>
          ) : null}

          <section>
            <h2 className="microlabel mb-2">Evidence, metric by metric</h2>
            {evidence ? (
              <EvidencePanel evidence={evidence} color={meta.color} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No evidence recorded.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
