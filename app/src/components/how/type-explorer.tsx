"use client";

import { useState } from "react";

import { TYPE_META } from "@/lib/anomaly";
import type { AnomalyType } from "@/types/insight";
import { cn } from "@/lib/utils";

interface TypeStory {
  type: AnomalyType;
  output: string; // SVG polyline points for the output metric (goals)
  underlying: string; // SVG polyline points for the underlying metric (xG)
  reads: string;
  fantasy: boolean;
}

const STORIES: TypeStory[] = [
  {
    type: "BREAKOUT",
    output: "4,26 18,24 32,20 46,16 60,10 74,6",
    underlying: "4,28 18,25 32,22 46,18 60,13 74,9",
    reads:
      "Goals AND the underlying numbers rise together — or the whole involvement profile lifts at once. The improvement is fed by real chances, so it is likely to stick.",
    fantasy: true,
  },
  {
    type: "FINISHING_SLUMP",
    output: "4,10 18,12 32,18 46,24 60,27 74,28",
    underlying: "4,14 18,13 32,14 46,13 60,14 74,13",
    reads:
      "Goals dry up while xG holds steady — the chances still arrive, the finishing went cold. Historically the type most likely to self-correct.",
    fantasy: true,
  },
  {
    type: "FORM_COLLAPSE",
    output: "4,10 18,13 32,18 46,23 60,27 74,29",
    underlying: "4,12 18,15 32,19 46,23 60,26 74,28",
    reads:
      "Output and underlying numbers decline together — service, involvement and finishing all fell. The genuine slump.",
    fantasy: false,
  },
  {
    type: "OVERPERFORMANCE_RISK",
    output: "4,24 18,18 32,12 46,8 60,6 74,5",
    underlying: "4,22 18,21 32,22 46,21 60,22 74,21",
    reads:
      "Goals run far ahead of xG over the recent window. Finishing streaks like this historically regress — the classic sell-high signal.",
    fantasy: true,
  },
  {
    type: "ROLE_CHANGE",
    output: "4,22 32,22 38,12 74,12",
    underlying: "4,12 32,12 38,20 74,20",
    reads:
      "A change point splits the timeline and the involvement profile shifts shape — more buildup, fewer shots, or the reverse. Output may not move at all; the job did.",
    fantasy: false,
  },
  {
    type: "WORKLOAD_SPIKE",
    output: "4,26 18,24 32,22 46,16 60,9 74,4",
    underlying: "4,26 18,25 32,24 46,23 60,23 74,22",
    reads:
      "Trailing 35-day minutes far above the player's own norm — a rotation and soft-tissue risk flag rather than a form verdict. Dormant on league-only data, kept for completeness.",
    fantasy: false,
  },
];

function Glyph({ story, active }: { story: TypeStory; active: boolean }) {
  const color = TYPE_META[story.type].color;
  return (
    <svg viewBox="0 0 78 32" className="h-8 w-20" aria-hidden>
      <polyline
        points={story.underlying}
        fill="none"
        stroke={active ? "#8fa297" : "#39443b"}
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <polyline
        points={story.output}
        fill="none"
        stroke={active ? color : "#566158"}
        strokeWidth="2"
      />
    </svg>
  );
}

/** The six stories the detectors can tell, with their metric signatures. */
export function TypeExplorer() {
  const [selected, setSelected] = useState(0);
  const story = STORIES[selected];
  const meta = TYPE_META[story.type];

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STORIES.map((s, i) => (
          <button
            key={s.type}
            type="button"
            onClick={() => setSelected(i)}
            aria-pressed={selected === i}
            className={cn(
              "cursor-pointer rounded-sm border px-3 py-3 text-left transition-colors",
              selected === i
                ? "bg-accent"
                : "border-border bg-card hover:border-ring/40",
            )}
            style={
              selected === i
                ? { borderColor: `${TYPE_META[s.type].color}80` }
                : undefined
            }
          >
            <Glyph story={s} active={selected === i} />
            <span
              className="microlabel mt-2 block text-[0.625rem]"
              style={selected === i ? { color: TYPE_META[s.type].color } : undefined}
            >
              {TYPE_META[s.type].label}
            </span>
          </button>
        ))}
      </div>

      <div
        className="mt-3 rounded-sm border-l-2 bg-card px-5 py-4"
        style={{ borderLeftColor: meta.color }}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p
            className="font-display text-xl font-semibold uppercase tracking-wide"
            style={{ color: meta.color }}
          >
            {meta.label}
          </p>
          <p className="microlabel">
            <span style={{ color: meta.color }}>—</span> output ·{" "}
            <span className="text-muted-foreground">- -</span> underlying (xG)
          </p>
          {story.fantasy ? (
            <p className="microlabel ml-auto text-primary">
              gets a fantasy angle in its narrative
            </p>
          ) : null}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/85">
          {story.reads}
        </p>
      </div>
    </div>
  );
}
