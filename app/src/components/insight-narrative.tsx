import { TYPE_META } from "@/lib/anomaly";
import type { AnomalyInsight, AnomalyType } from "@/types/insight";

const CONFIDENCE_STYLE: Record<AnomalyInsight["confidence"], string> = {
  high: "#c6f33f",
  medium: "#fbbf24",
  low: "#8fa297",
};

/** The AI-generated read on an anomaly: plain language first, stats second. */
export function InsightNarrative({
  insight,
  anomalyType,
}: {
  insight: AnomalyInsight;
  anomalyType: AnomalyType;
}) {
  const color = TYPE_META[anomalyType].color;
  return (
    <article className="border-l-2 bg-card" style={{ borderLeftColor: color }}>
      <div className="px-6 py-6 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <p className="microlabel">AI insight · gemini-2.5-flash</p>
          <p
            className="microlabel"
            style={{ color: CONFIDENCE_STYLE[insight.confidence] }}
          >
            ● {insight.confidence} confidence
          </p>
        </div>
        <h2 className="mt-3 font-display text-3xl font-bold uppercase leading-tight tracking-wide sm:text-4xl">
          {insight.headline}
        </h2>
        <p className="mt-4 leading-relaxed text-foreground/90">
          {insight.summary}
        </p>

        <div className="mt-6 rounded-sm border border-border bg-background/60 px-4 py-4">
          <p className="microlabel">The statistics</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {insight.technicalExplanation}
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="microlabel">Outlook</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground/85">
              {insight.outlook}
            </p>
          </div>
          {insight.fantasyImplication ? (
            <div className="rounded-sm bg-primary/10 px-4 py-3">
              <p className="microlabel text-primary">Fantasy angle</p>
              <p className="mt-2 text-sm leading-relaxed text-foreground/85">
                {insight.fantasyImplication}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Rendered when no insight exists or the payload fails Zod validation. */
export function InsightFallback({ anomalyType }: { anomalyType: AnomalyType }) {
  const meta = TYPE_META[anomalyType];
  return (
    <article
      className="border-l-2 bg-card"
      style={{ borderLeftColor: meta.color }}
    >
      <div className="px-6 py-6 sm:px-8">
        <p className="microlabel">AI insight</p>
        <h2 className="mt-3 font-display text-2xl font-semibold uppercase tracking-wide text-muted-foreground">
          Narrative unavailable
        </h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          {meta.blurb} The generated narrative for this anomaly is missing or
          failed validation — the statistical evidence below stands on its
          own.
        </p>
      </div>
    </article>
  );
}
