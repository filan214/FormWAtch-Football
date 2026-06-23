import { metricLabel } from "@/lib/anomaly";
import { fmt, fmtDate, fmtP, fmtSigned } from "@/lib/format";
import type { AnomalyEvidence } from "@/types/evidence";

/**
 * The raw detector output, metric by metric — the page's audit trail.
 * Everything here comes straight from the stored evidence jsonb.
 */
export function EvidencePanel({
  evidence,
  color,
}: {
  evidence: AnomalyEvidence;
  color: string;
}) {
  const metrics = evidence.metrics ?? {};
  const primary = evidence.primary_metric;

  return (
    <div className="space-y-2">
      {Object.entries(metrics).map(([name, m]) => {
        const isPrimary = name === primary;
        return (
          <div
            key={name}
            className="rounded-sm border border-border bg-card px-4 py-3"
            style={isPrimary ? { borderColor: `${color}59` } : undefined}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="microlabel flex items-center gap-2">
                {m.flagged ? (
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                ) : (
                  <span className="inline-block size-1.5 rounded-full bg-border" />
                )}
                {metricLabel(name)}
                {isPrimary ? (
                  <span style={{ color }}> · primary</span>
                ) : null}
              </p>
              <p className="microlabel">
                {m.direction === "up" ? "▲" : "▼"} kl {fmt(m.kl)}
              </p>
            </div>
            <div className="tnum mt-2 grid grid-cols-2 gap-x-4 font-mono text-xs text-muted-foreground">
              <div>
                <p className="text-foreground/80">
                  {fmt(m.baseline_rate)} → {fmt(m.recent_rate)}{" "}
                  <span className="text-muted-foreground">/90</span>
                </p>
                <p className="mt-0.5">
                  CI {fmt(m.baseline_ci[0])}–{fmt(m.baseline_ci[1])} →{" "}
                  {fmt(m.recent_ci[0])}–{fmt(m.recent_ci[1])}
                </p>
              </div>
              <div className="text-right">
                <p>p = {fmtP(m.p_value)}</p>
                <p className="mt-0.5">{m.flagged ? "flagged" : "quiet"}</p>
              </div>
            </div>
          </div>
        );
      })}

      {evidence.role_change ? (
        <div className="rounded-sm border border-border bg-card px-4 py-3">
          <p className="microlabel" style={{ color }}>
            Profile shift · {fmtDate(evidence.role_change.change_point_date)}
          </p>
          <p className="tnum mt-2 font-mono text-xs text-muted-foreground">
            Mahalanobis d = {fmt(evidence.role_change.d)} · biggest mover:{" "}
            {metricLabel(evidence.role_change.dominant)}
          </p>
          <div className="mt-3 space-y-1.5">
            {Object.entries(evidence.role_change.diff)
              .sort(([, a], [, b]) => Math.abs(b ?? 0) - Math.abs(a ?? 0))
              .map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-3 font-mono text-xs"
                >
                  <span className="microlabel">{metricLabel(k)}</span>
                  <span
                    className="tnum"
                    style={{ color: (v ?? 0) >= 0 ? color : "#8fa297" }}
                  >
                    {fmtSigned(v)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {evidence.family === "WORKLOAD" ? (
        <div className="rounded-sm border border-border bg-card px-4 py-3">
          <p className="microlabel" style={{ color }}>
            35-day minutes load
          </p>
          <p className="tnum mt-2 font-mono text-sm text-foreground/85">
            {fmt(evidence.congestion_minutes, 0)} min vs typical{" "}
            {fmt(evidence.baseline_congestion, 0)} (
            {fmt(evidence.ratio, 2)}×)
          </p>
        </div>
      ) : null}

      <div className="rounded-sm border border-border bg-card px-4 py-3">
        <div className="tnum grid grid-cols-2 gap-y-1.5 font-mono text-xs text-muted-foreground">
          <span className="microlabel">FDR-adj p</span>
          <span className="text-right">{fmtP(evidence.fdr_p)}</span>
          <span className="microlabel">Persistence</span>
          <span className="text-right">
            {evidence.persistence_weeks} wk
            {evidence.persistence_weeks === 1 ? "" : "s"}
          </span>
          {evidence.qualifying_matches !== undefined ? (
            <>
              <span className="microlabel">Qualifying matches</span>
              <span className="text-right">{evidence.qualifying_matches}</span>
            </>
          ) : null}
          <span className="microlabel">Naive z (goals)</span>
          <span className="text-right">
            {evidence.naive_z_goals === null ||
            evidence.naive_z_goals === undefined
              ? "no verdict"
              : `${fmt(evidence.naive_z_goals, 2)}σ`}
          </span>
        </div>
      </div>
    </div>
  );
}
