"use client";

import { useState } from "react";

import { severityScore } from "@/lib/demo";
import { severityTier } from "@/lib/anomaly";

function ComponentBar({
  label,
  value,
  max,
  detail,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="microlabel">{label}</span>
        <span className="font-mono text-xs text-foreground/80 tnum">
          {value.toFixed(1)} / {max}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-border/60">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
      <p className="microlabel mt-1 text-[0.625rem]">{detail}</p>
    </div>
  );
}

/** The production severity formula with the knobs exposed. */
export function SeverityBuilder() {
  const [kl, setKl] = useState(2.2);
  const [weeks, setWeeks] = useState(2);
  const [p, setP] = useState(0.04);

  const score = severityScore(kl, weeks, p);
  const tier = severityTier(score.total);

  return (
    <div className="rounded-sm border border-border bg-card px-5 py-5">
      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        <div className="space-y-5">
          <label className="block">
            <span className="microlabel flex justify-between">
              <span>posterior separation (KL divergence)</span>
              <span className="text-foreground tnum">{kl.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={4}
              step={0.1}
              value={kl}
              onChange={(e) => setKl(Number(e.target.value))}
              className="mt-1.5 w-full cursor-pointer"
            />
          </label>
          <label className="block">
            <span className="microlabel flex justify-between">
              <span>consecutive weeks flagged</span>
              <span className="text-foreground tnum">{weeks}</span>
            </span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="mt-1.5 w-full cursor-pointer"
            />
          </label>
          <label className="block">
            <span className="microlabel flex justify-between">
              <span>FDR-adjusted p-value</span>
              <span className="text-foreground tnum">{p.toFixed(3)}</span>
            </span>
            <input
              type="range"
              min={0.001}
              max={0.15}
              step={0.001}
              value={p}
              onChange={(e) => setP(Number(e.target.value))}
              className="mt-1.5 w-full cursor-pointer"
            />
          </label>
        </div>

        <div className="flex flex-col items-center justify-center sm:w-44">
          <p className="microlabel">severity</p>
          <p
            className="font-display text-8xl font-bold leading-none tnum"
            style={{ color: tier.color }}
          >
            {score.total}
          </p>
          <p className="microlabel mt-1" style={{ color: tier.color }}>
            {tier.name}
          </p>
          <p className="microlabel mt-2 text-[0.625rem]">
            {score.total >= 60
              ? "on the board · gets an AI narrative"
              : "below the 60 display floor"}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
        <ComponentBar
          label="evidence · 40"
          value={score.klPart}
          max={40}
          detail="40 · min(KL / 3, 1)"
        />
        <ComponentBar
          label="persistence · 30"
          value={score.weeksPart}
          max={30}
          detail="30 · min(weeks / 3, 1)"
        />
        <ComponentBar
          label="significance · 30"
          value={score.fdrPart}
          max={30}
          detail="30 · (1 − min(p / 0.15, 1))"
        />
      </div>
    </div>
  );
}
