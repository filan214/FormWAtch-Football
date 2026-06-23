"use client";

import { useMemo, useState } from "react";

import { bhCutoff, simulateWeek } from "@/lib/demo";

const WIDTH = 640;
const HEIGHT = 230;
const PAD = { left: 24, right: 16, top: 12, bottom: 28 };

/**
 * One detection week as a scatter of p-values against the BH line.
 * Drag q and watch the gate swing.
 */
export function FdrGate() {
  const [q, setQ] = useState(0.15);
  const [seed, setSeed] = useState(3);

  const week = useMemo(() => simulateWeek(seed), [seed]);
  const cutoff = bhCutoff(week.pValues, q);
  const m = week.pValues.length;

  const x = (rank: number) =>
    PAD.left + (rank / (m - 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (p: number) =>
    PAD.top + (1 - p) * (HEIGHT - PAD.top - PAD.bottom);

  return (
    <div className="rounded-sm border border-border bg-card px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="microlabel">
          a week of {m} nominated candidates · most are honest noise
        </p>
        <button
          type="button"
          onClick={() => setSeed((s) => s + 1)}
          className="microlabel cursor-pointer rounded-sm border border-primary/50 bg-primary/10 px-3 py-1.5 text-primary transition-colors hover:bg-primary/20"
        >
          ↻ new week
        </button>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-4 w-full"
        role="img"
        aria-label={`Benjamini-Hochberg gate: ${cutoff + 1} of ${m} candidates survive at q = ${q.toFixed(2)}`}
      >
        {/* BH line: p = q · rank / m */}
        <line
          x1={x(0)}
          y1={y(q / m)}
          x2={x(m - 1)}
          y2={y(q)}
          stroke="#c6f33f"
          strokeDasharray="5 4"
          strokeWidth="1.5"
        />
        {week.pValues.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p)}
            r={i <= cutoff ? 3.2 : 2.2}
            fill={i <= cutoff ? "#c6f33f" : "#39443b"}
          />
        ))}
        <text
          x={x(m - 1)}
          y={y(q) - 8}
          textAnchor="end"
          fill="#c6f33f"
          fontSize="11"
          fontFamily="var(--font-spline-mono)"
        >
          the BH line · slope q/m
        </text>
        <text
          x={PAD.left}
          y={HEIGHT - 8}
          fill="#8fa297"
          fontSize="10"
          fontFamily="var(--font-spline-mono)"
        >
          candidates ranked by p-value →
        </text>
        <text
          x={PAD.left}
          y={PAD.top + 8}
          fill="#8fa297"
          fontSize="10"
          fontFamily="var(--font-spline-mono)"
        >
          p = 1
        </text>
      </svg>

      <label className="mt-3 block">
        <span className="microlabel flex items-center justify-between">
          <span>false discovery rate q — drag me</span>
          <span className="font-display text-2xl font-bold text-foreground tnum">
            {q.toFixed(2)}
          </span>
        </span>
        <input
          type="range"
          min={0.01}
          max={0.3}
          step={0.01}
          value={q}
          onChange={(e) => setQ(Number(e.target.value))}
          className="mt-2 w-full cursor-pointer"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <p className="microlabel">
          <span className="font-display text-2xl font-bold text-primary tnum">
            {cutoff + 1}
          </span>{" "}
          of {m} survive the gate
        </p>
        <p className="microlabel ml-auto max-w-xs text-right">
          production runs at q = 0.15 — strict enough to kill the junk,
          loose enough to keep slow-burn slumps alive
        </p>
      </div>
    </div>
  );
}
