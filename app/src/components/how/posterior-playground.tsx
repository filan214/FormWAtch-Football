"use client";

import { useMemo, useState } from "react";

import { PosteriorCurves } from "@/components/posterior-curves";
import { gammaKl } from "@/lib/demo";
import { type GammaParams, gammaCi90, posteriorCurves } from "@/lib/gamma";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

const KL_THRESHOLD = 1.5;

const ARCHETYPES = [
  {
    key: "veteran",
    label: "Proven striker",
    sub: "120 career matches, 0.45 G/90",
    baseline: { alpha: 55, beta: 121 } as GammaParams,
  },
  {
    key: "second",
    label: "Second-season player",
    sub: "30 matches, 0.45 G/90",
    baseline: { alpha: 14.5, beta: 31 } as GammaParams,
  },
  {
    key: "rookie",
    label: "Newly promoted",
    sub: "8 matches, 0.45 G/90",
    baseline: { alpha: 4.6, beta: 9 } as GammaParams,
  },
] as const;

function ciBar(
  ci: [number, number],
  xMax: number,
  color: string,
  label: string,
) {
  return (
    <div className="flex items-center gap-3">
      <span className="microlabel w-16 shrink-0">{label}</span>
      <div className="relative h-2 flex-1 rounded-full bg-border/60">
        <div
          className="absolute h-full rounded-full"
          style={{
            left: `${(ci[0] / xMax) * 100}%`,
            width: `${((ci[1] - ci[0]) / xMax) * 100}%`,
            backgroundColor: color,
            opacity: 0.85,
          }}
        />
      </div>
      <span className="microlabel w-24 shrink-0 text-right tnum">
        {fmt(ci[0])}–{fmt(ci[1])}
      </span>
    </div>
  );
}

/**
 * Drag the recent form, watch the beliefs separate. The recent posterior
 * is a weak prior plus the chosen last-6 record — the same conjugate
 * arithmetic the pipeline runs, minus its exponential weighting.
 */
export function PosteriorPlayground() {
  const [archetype, setArchetype] = useState(0);
  const [goals, setGoals] = useState(6);

  const baseline = ARCHETYPES[archetype].baseline;
  const recent: GammaParams = { alpha: 1 + goals, beta: 7 };

  const { points, kl, baseCi, recCi, xMax } = useMemo(() => {
    const baseCi = gammaCi90(baseline.alpha, baseline.beta);
    const recCi = gammaCi90(recent.alpha, recent.beta);
    const xMax = Math.max(baseCi[1], recCi[1]) * 1.4;
    return {
      points: posteriorCurves(baseline, recent, xMax),
      kl: gammaKl(recent, baseline),
      baseCi,
      recCi,
      xMax,
    };
  }, [baseline, recent.alpha, recent.beta]);

  const nominated = kl >= KL_THRESHOLD;
  const overlap = recCi[0] < baseCi[1] && baseCi[0] < recCi[1];
  const baselineMean = baseline.alpha / baseline.beta;
  const recentMean = recent.alpha / recent.beta;

  return (
    <div className="rounded-sm border border-border bg-card px-5 py-5">
      <div className="flex flex-wrap gap-2">
        {ARCHETYPES.map((a, i) => (
          <button
            key={a.key}
            type="button"
            onClick={() => setArchetype(i)}
            aria-pressed={archetype === i}
            className={cn(
              "cursor-pointer rounded-sm border px-3 py-2 text-left transition-colors",
              archetype === i
                ? "border-primary/60 bg-accent"
                : "border-border bg-background hover:border-ring/40",
            )}
          >
            <span
              className={cn(
                "block font-display text-sm font-semibold uppercase tracking-wide",
                archetype === i ? "text-primary" : "text-foreground",
              )}
            >
              {a.label}
            </span>
            <span className="microlabel mt-0.5 block text-[0.625rem]">
              {a.sub}
            </span>
          </button>
        ))}
      </div>

      <label className="mt-5 block">
        <span className="microlabel flex items-center justify-between">
          <span>goals in the last 6 matches — drag me</span>
          <span className="font-display text-2xl font-bold text-foreground tnum">
            {goals}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={9}
          step={1}
          value={goals}
          onChange={(e) => setGoals(Number(e.target.value))}
          className="mt-2 w-full cursor-pointer"
        />
      </label>

      <PosteriorCurves
        points={points}
        color={nominated ? "#c6f33f" : "#8fa297"}
        baselineMean={baselineMean}
        recentMean={recentMean}
      />

      <div className="mt-2 space-y-2">
        {ciBar(baseCi, xMax, "#8fa297", "baseline")}
        {ciBar(recCi, xMax, nominated ? "#c6f33f" : "#e9f1ea", "last 6")}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="microlabel">
          kl divergence{" "}
          <span
            className="font-display text-2xl font-bold tnum"
            style={{ color: nominated ? "#c6f33f" : "#8fa297" }}
          >
            {fmt(kl)}
          </span>{" "}
          / {KL_THRESHOLD} to nominate
        </p>
        <p className="microlabel">
          90% intervals{" "}
          <span className={overlap ? "text-muted-foreground" : "text-primary"}>
            {overlap ? "overlap" : "separated"}
          </span>
        </p>
        <p
          className={cn(
            "microlabel ml-auto rounded-sm border px-2.5 py-1",
            nominated
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border text-muted-foreground",
          )}
        >
          {nominated ? "nominated → sent to the FDR gate" : "quiet — within belief"}
        </p>
      </div>

      {goals === 0 && archetype === 0 ? (
        <p className="mt-3 rounded-sm border border-border bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Notice how a six-match blank barely moves the needle even for a
          proven scorer — droughts are statistically hard to prove on six
          matches of evidence. This is the documented down-side power limit
          on the methodology page.
        </p>
      ) : null}
      <p className="microlabel mt-4">
        simplified for illustration: the real engine weights recent matches
        exponentially and tests five metrics per player
      </p>
    </div>
  );
}
