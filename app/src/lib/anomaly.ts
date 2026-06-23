import type { AnomalyType } from "@/types/insight";

/** Visual identity per anomaly type: substitution-board color coding. */
export const TYPE_META: Record<
  AnomalyType,
  { label: string; short: string; color: string; blurb: string }
> = {
  BREAKOUT: {
    label: "Breakout",
    short: "BRK",
    color: "#a3e635",
    blurb: "Underlying and output metrics up together — a new level forming.",
  },
  FINISHING_SLUMP: {
    label: "Finishing slump",
    short: "FIN",
    color: "#fbbf24",
    blurb: "Goals down while xG holds — chances still coming, finishing cold.",
  },
  FORM_COLLAPSE: {
    label: "Form collapse",
    short: "CLP",
    color: "#f87171",
    blurb: "Output and underlying numbers both declined — a genuine slump.",
  },
  OVERPERFORMANCE_RISK: {
    label: "Overperformance risk",
    short: "OVR",
    color: "#fb923c",
    blurb: "Scoring well above xG — a regression candidate.",
  },
  ROLE_CHANGE: {
    label: "Role change",
    short: "ROL",
    color: "#7dd3fc",
    blurb: "A regime shift in the involvement profile — shape, not output.",
  },
  WORKLOAD_SPIKE: {
    label: "Workload spike",
    short: "WRK",
    color: "#c4b5fd",
    blurb: "Trailing 35-day minutes load well above the player's own norm.",
  },
};

export const METRIC_LABELS: Record<string, string> = {
  goals: "Goals",
  shots: "Shots",
  key_passes: "Key passes",
  xg: "xG",
  xg_chain: "xG chain",
  xg_buildup: "xG buildup",
  goals_p90: "Goals /90",
  shots_p90: "Shots /90",
  key_passes_p90: "Key passes /90",
  xg_p90: "xG /90",
  xg_chain_p90: "xG chain /90",
  xg_buildup_p90: "xG buildup /90",
};

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric.replaceAll("_", " ");
}

export function severityTier(severity: number): {
  name: string;
  color: string;
} {
  if (severity >= 80) return { name: "SEVERE", color: "#f87171" };
  if (severity >= 60) return { name: "STRONG", color: "#c6f33f" };
  if (severity >= 40) return { name: "MODERATE", color: "#fbbf24" };
  return { name: "WATCH", color: "#8fa297" };
}
