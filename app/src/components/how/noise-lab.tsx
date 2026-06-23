"use client";

import { useMemo, useState } from "react";

import { simulateSeason } from "@/lib/demo";
import { cn } from "@/lib/utils";

const TRUE_RATE = 0.45;

/**
 * The false-alarm machine: simulate a striker whose true rate never
 * changes, and watch the naive z-score cry wolf while the Bayesian
 * engine stays quiet.
 */
export function NoiseLab() {
  const [seed, setSeed] = useState(7);
  const [tally, setTally] = useState({ seasons: 1, naive: -1, bayes: -1 });

  const season = useMemo(() => simulateSeason(seed, TRUE_RATE), [seed]);
  const naiveCount = season.naiveFlags.filter(Boolean).length;
  const bayesCount = season.bayesNominations.filter(Boolean).length;

  // first render seeds the tally lazily so SSR and hydration agree
  const totals =
    tally.naive === -1
      ? { seasons: 1, naive: naiveCount, bayes: bayesCount }
      : tally;

  function rerun() {
    const next = seed + 1;
    const fresh = simulateSeason(next, TRUE_RATE);
    setTally({
      seasons: totals.seasons + 1,
      naive: totals.naive + fresh.naiveFlags.filter(Boolean).length,
      bayes: totals.bayes + fresh.bayesNominations.filter(Boolean).length,
    });
    setSeed(next);
  }

  return (
    <div className="rounded-sm border border-border bg-card px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="microlabel">
          one simulated season · true rate fixed at {TRUE_RATE} goals/90 ·
          every flag is a false alarm
        </p>
        <button
          type="button"
          onClick={rerun}
          className="microlabel cursor-pointer rounded-sm border border-primary/50 bg-primary/10 px-3 py-1.5 text-primary transition-colors hover:bg-primary/20"
        >
          ↻ simulate another season
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {season.goals.map((g, i) => {
          const naive = season.naiveFlags[i];
          const bayes = season.bayesNominations[i];
          return (
            <div
              key={i}
              title={`match ${i + 1}: ${g} goal${g === 1 ? "" : "s"}${naive ? " — naive z fires" : ""}${bayes ? " — Bayesian nominates" : ""}`}
              className={cn(
                "flex size-9 items-center justify-center rounded-sm border font-mono text-xs tnum",
                g > 0
                  ? "border-border bg-secondary text-foreground"
                  : "border-border/60 bg-background text-muted-foreground/60",
                naive && "border-destructive ring-1 ring-destructive/60",
                bayes && "border-primary ring-1 ring-primary/60",
              )}
            >
              {g}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-sm border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="font-display text-3xl font-bold text-destructive tnum">
            {naiveCount}
          </p>
          <p className="microlabel mt-0.5">
            naive |z| ≥ 2 alarms this season{" "}
            <span className="text-destructive">(red rings)</span>
          </p>
        </div>
        <div className="rounded-sm border border-primary/40 bg-primary/5 px-4 py-3">
          <p className="font-display text-3xl font-bold text-primary tnum">
            {bayesCount}
          </p>
          <p className="microlabel mt-0.5">
            Bayesian nominations — and each would still face the FDR gate
          </p>
        </div>
      </div>

      <p className="microlabel mt-4">
        running tally across {totals.seasons} simulated season
        {totals.seasons === 1 ? "" : "s"}: naive {totals.naive} · bayesian{" "}
        {totals.bayes}
      </p>
    </div>
  );
}
