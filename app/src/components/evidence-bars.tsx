"use client";

import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

export interface EvidenceBarDatum {
  metric: string;
  baseline: number;
  recent: number;
  unit: string;
}

/** Baseline vs recent horizontal bars, one row per keyEvidence metric. */
export function EvidenceBars({
  data,
  color,
}: {
  data: EvidenceBarDatum[];
  color: string;
}) {
  const height = data.length * 64 + 16;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
          barCategoryGap="28%"
        >
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="metric"
            width={104}
            axisLine={false}
            tickLine={false}
            tick={{
              fill: "#8fa297",
              fontSize: 11,
              fontFamily: "var(--font-spline-mono)",
            }}
          />
          <Bar
            dataKey="baseline"
            name="baseline"
            fill="#39443b"
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="baseline"
              position="right"
              formatter={(v: unknown) => Number(v).toFixed(2)}
              style={{
                fill: "#8fa297",
                fontSize: 11,
                fontFamily: "var(--font-spline-mono)",
              }}
            />
          </Bar>
          <Bar
            dataKey="recent"
            name="recent"
            fill={color}
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="recent"
              position="right"
              formatter={(v: unknown) => Number(v).toFixed(2)}
              style={{
                fill: color,
                fontSize: 11,
                fontFamily: "var(--font-spline-mono)",
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
