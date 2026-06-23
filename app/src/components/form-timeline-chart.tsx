"use client";

import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PlayerAnomaly, TimelinePoint } from "@/db/queries";
import { TYPE_META } from "@/lib/anomaly";
import { fmt, fmtDate } from "@/lib/format";

function monthTick(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

/** Nearest plotted match on or before an anomaly's evaluation date. */
function nearestPoint(points: TimelinePoint[], iso: string): string | null {
  let best: string | null = null;
  for (const p of points) {
    if (p.date <= iso) best = p.date;
    else break;
  }
  return best;
}

function TimelineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TimelinePoint }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-sm border border-border bg-popover px-3 py-2 font-mono text-xs shadow-lg">
      <p className="text-foreground">
        {fmtDate(p.date)} · vs {p.opponent}
      </p>
      <p className="mt-1 text-muted-foreground">
        composite {fmt(p.composite)} · {p.goals} G · {fmt(p.xgP90)} xG/90 ·{" "}
        {p.minutes}&#39;
      </p>
    </div>
  );
}

/**
 * Composite involvement index per qualifying match (the same signal the
 * PELT change-point detector reads), with regime shifts and anomaly weeks
 * marked on the time axis.
 */
export function FormTimelineChart({
  points,
  anomalies,
}: {
  points: TimelinePoint[];
  anomalies: PlayerAnomaly[];
}) {
  // season boundaries: first match after a 45+ day gap (the summer break)
  const seasonStarts: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const gap =
      (new Date(points[i].date).getTime() -
        new Date(points[i - 1].date).getTime()) /
      86_400_000;
    if (gap > 45) seasonStarts.push(points[i].date);
  }

  const changePoints = anomalies
    .filter((a) => a.changePointDate)
    .map((a) => ({
      date: nearestPoint(points, a.changePointDate!),
      color: TYPE_META[a.anomalyType].color,
    }))
    .filter((m): m is { date: string; color: string } => m.date !== null);

  const anomalyMarks = anomalies
    .filter((a) => a.asOf && !a.changePointDate)
    .map((a) => ({
      date: nearestPoint(points, a.asOf!),
      color: TYPE_META[a.anomalyType].color,
      short: TYPE_META[a.anomalyType].short,
    }))
    .filter(
      (m): m is { date: string; color: string; short: string } =>
        m.date !== null,
    );

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 18, right: 12, bottom: 4, left: 0 }}
        >
          <XAxis
            dataKey="date"
            tickFormatter={monthTick}
            tick={{
              fill: "#8fa297",
              fontSize: 11,
              fontFamily: "var(--font-spline-mono)",
            }}
            axisLine={{ stroke: "rgba(233,241,234,0.12)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={48}
          />
          <YAxis
            width={36}
            tick={{
              fill: "#8fa297",
              fontSize: 11,
              fontFamily: "var(--font-spline-mono)",
            }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            content={<TimelineTooltip />}
            cursor={{ stroke: "rgba(233,241,234,0.2)" }}
          />
          <ReferenceLine y={0} stroke="rgba(233,241,234,0.15)" />

          {seasonStarts.map((d) => (
            <ReferenceLine
              key={`season-${d}`}
              x={d}
              stroke="rgba(233,241,234,0.25)"
              strokeDasharray="2 6"
              label={{
                value: "new season",
                position: "insideTopLeft",
                fill: "#8fa297",
                fontSize: 10,
                fontFamily: "var(--font-spline-mono)",
              }}
            />
          ))}

          {changePoints.map((m, i) => (
            <ReferenceLine
              key={`cp-${i}`}
              x={m.date}
              stroke={m.color}
              strokeWidth={1.5}
              label={{
                value: "regime shift",
                position: "top",
                fill: m.color,
                fontSize: 10,
                fontFamily: "var(--font-spline-mono)",
              }}
            />
          ))}

          {anomalyMarks.map((m, i) => (
            <ReferenceLine
              key={`mark-${i}`}
              x={m.date}
              stroke={m.color}
              strokeDasharray="3 4"
              strokeOpacity={0.65}
              label={{
                value: m.short,
                position: "top",
                fill: m.color,
                fontSize: 10,
                fontFamily: "var(--font-spline-mono)",
              }}
            />
          ))}

          <Line
            dataKey="composite"
            type="monotone"
            stroke="#c6f33f"
            strokeWidth={1.75}
            dot={{ r: 2, fill: "#c6f33f", strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
