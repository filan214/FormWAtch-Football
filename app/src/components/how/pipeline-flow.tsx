"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

const STAGES = [
  {
    title: "Ingest",
    label: "Tuesdays 06:00 UTC",
    desc: "A GitHub Actions cron pulls every EPL player-match line from Understat — minutes, goals, shots, xG, key passes, buildup involvement — and upserts it idempotently into Postgres. Re-running never duplicates a row.",
  },
  {
    title: "Normalize",
    label: "per-90 + rules",
    desc: "Raw counts become per-90 rates. Appearances under 30 minutes never enter a baseline (garbage-time noise), and a player needs 10 qualifying matches — with the latest inside 28 days — before the detectors will even look at them.",
  },
  {
    title: "Detect",
    label: "three detectors",
    desc: "Gamma-Poisson posteriors ask “is the recent window different?”, PELT change-point detection asks “did the timeline split into regimes?”, and Mahalanobis profile distance asks “did the shape of their game move?”. Their agreement pattern types the anomaly.",
  },
  {
    title: "Gate & score",
    label: "FDR · severity",
    desc: "Every nominated candidate's p-value goes through Benjamini-Hochberg across the whole week at q = 0.15. Survivors get a 0–100 severity from posterior separation, persistence, and how comfortably they cleared the gate.",
  },
  {
    title: "Narrate",
    label: "severity ≥ 60",
    desc: "High-severity anomalies get a structured-JSON explanation from Gemini via OpenRouter — validated against a strict schema, cached by a hash of the evidence. Unchanged evidence never triggers a second API call.",
  },
  {
    title: "Publish",
    label: "this dashboard",
    desc: "The board you're reading queries Postgres directly through a read-only connection and revalidates hourly. Anomalies stay active week to week until the signal fades, then resolve into the player's history.",
  },
] as const;

export function PipelineFlow() {
  const [selected, setSelected] = useState(0);

  return (
    <div>
      <div className="relative -mx-1 overflow-x-auto px-1 pb-2">
        <ol className="flex min-w-max items-stretch gap-2">
          {STAGES.map((stage, i) => (
            <li key={stage.title} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(i)}
                aria-expanded={selected === i}
                className={cn(
                  "group w-36 cursor-pointer rounded-sm border px-3 py-3 text-left transition-colors",
                  selected === i
                    ? "border-primary/60 bg-accent"
                    : "border-border bg-card hover:border-ring/40",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block size-1.5 rounded-full motion-reduce:animate-none",
                      selected === i ? "bg-primary" : "bg-muted-foreground/50",
                    )}
                    style={{
                      animation:
                        selected === i
                          ? undefined
                          : `blip 4.2s linear ${i * 0.7}s infinite`,
                    }}
                  />
                  <span className="microlabel">{String(i + 1).padStart(2, "0")}</span>
                </span>
                <span
                  className={cn(
                    "mt-1 block font-display text-lg font-semibold uppercase tracking-wide",
                    selected === i ? "text-primary" : "text-foreground",
                  )}
                >
                  {stage.title}
                </span>
                <span className="microlabel mt-0.5 block text-[0.625rem]">
                  {stage.label}
                </span>
              </button>
              {i < STAGES.length - 1 ? (
                <span aria-hidden className="text-muted-foreground/50">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-3 min-h-24 rounded-sm border border-border bg-card px-5 py-4">
        <p className="text-sm leading-relaxed text-foreground/85">
          {STAGES[selected].desc}
        </p>
      </div>
    </div>
  );
}
