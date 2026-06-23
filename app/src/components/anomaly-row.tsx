import Link from "next/link";

import { PlayerAvatar } from "@/components/player-avatar";
import { TypeBadge } from "@/components/type-badge";
import type { FeedRow } from "@/db/queries";
import { TYPE_META, severityTier } from "@/lib/anomaly";
import { fmtP } from "@/lib/format";

/** One entry on the anomaly board: severity numeral first, scoreboard style. */
export function AnomalyRow({ row, index }: { row: FeedRow; index: number }) {
  const meta = TYPE_META[row.anomalyType];
  const tier = severityTier(row.severity);

  return (
    <Link
      href={`/anomaly/${row.id}`}
      className="rise group block border-l-2 bg-card transition-colors hover:bg-accent"
      style={{
        borderLeftColor: meta.color,
        animationDelay: `${Math.min(index, 12) * 45}ms`,
      }}
    >
      <div className="flex items-center gap-4 px-4 py-4 sm:gap-6 sm:px-6">
        <div className="w-16 shrink-0 sm:w-20">
          <p
            className="font-display text-5xl font-bold leading-none tnum sm:text-6xl"
            style={{ color: tier.color }}
          >
            {row.severity}
          </p>
          <div className="mt-1.5 h-0.5 w-full bg-border">
            <div
              className="meter-grow h-full"
              style={{
                width: `${row.severity}%`,
                backgroundColor: tier.color,
              }}
            />
          </div>
          <p className="microlabel mt-1 text-[0.625rem]">{tier.name}</p>
        </div>

        <PlayerAvatar
          name={row.playerName}
          color={meta.color}
          className="hidden sm:flex"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <TypeBadge type={row.anomalyType} size="sm" />
            <span className="microlabel">
              {row.team ?? "—"}
              {row.position ? ` · ${row.position}` : ""}
            </span>
          </div>
          <p className="mt-1 truncate font-display text-2xl font-semibold uppercase tracking-wide sm:text-3xl">
            {row.playerName}
          </p>
          <p className="mt-0.5 truncate text-sm italic text-muted-foreground">
            {row.headline ?? meta.blurb}
          </p>
        </div>

        <div className="hidden shrink-0 text-right md:block">
          <p className="microlabel">
            {row.persistenceWeeks} wk{row.persistenceWeeks === 1 ? "" : "s"}{" "}
            active
          </p>
          <p className="microlabel mt-1">
            fdr p {fmtP(row.fdrAdjustedP)}
          </p>
        </div>

        <span
          aria-hidden
          className="shrink-0 font-display text-2xl text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary"
        >
          →
        </span>
      </div>
    </Link>
  );
}
