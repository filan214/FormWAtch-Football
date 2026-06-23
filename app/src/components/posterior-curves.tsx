"use client";

import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { CurvePoint } from "@/lib/gamma";

/**
 * Two Gamma posterior densities — baseline (grey) vs last six matches
 * (type color). Separation between the humps IS the anomaly.
 */
export function PosteriorCurves({
  points,
  color,
  baselineMean,
  recentMean,
}: {
  points: CurvePoint[];
  color: string;
  baselineMean: number;
  recentMean: number;
}) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, "dataMax"]}
            tickFormatter={(v: number) => v.toFixed(1)}
            tick={{
              fill: "#8fa297",
              fontSize: 11,
              fontFamily: "var(--font-spline-mono)",
            }}
            axisLine={{ stroke: "rgba(233,241,234,0.12)" }}
            tickLine={false}
            tickCount={6}
          />
          <YAxis hide domain={[0, 1.08]} />
          <Area
            dataKey="baseline"
            type="monotone"
            stroke="#8fa297"
            strokeWidth={1.5}
            fill="#8fa297"
            fillOpacity={0.12}
            isAnimationActive={false}
            dot={false}
          />
          <Area
            dataKey="recent"
            type="monotone"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.18}
            isAnimationActive={false}
            dot={false}
          />
          <ReferenceLine
            x={baselineMean}
            stroke="#8fa297"
            strokeDasharray="4 4"
            strokeOpacity={0.7}
          />
          <ReferenceLine
            x={recentMean}
            stroke={color}
            strokeDasharray="4 4"
            strokeOpacity={0.8}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
