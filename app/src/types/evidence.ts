/**
 * Shape of `anomalies.evidence` jsonb as written by pipeline/src/detect.py
 * (`_evidence` / `_workload_evidence`). Floats are rounded pipeline-side so
 * the evidence hash — and therefore insight caching — stays stable.
 */

export interface MetricEvidence {
  baseline_rate: number | null;
  recent_rate: number | null;
  baseline_ci: [number | null, number | null];
  recent_ci: [number | null, number | null];
  kl: number | null;
  p_value: number | null;
  direction: "up" | "down";
  flagged: boolean;
}

export interface RoleChangeEvidence {
  d: number;
  dominant: string;
  diff: Record<string, number | null>;
  change_point_date: string;
}

export interface AnomalyEvidence {
  as_of: string;
  family: "UP" | "DOWN" | "ROLE" | "WORKLOAD";
  persistence_weeks: number;
  /** Absent on WORKLOAD_SPIKE evidence. */
  qualifying_matches?: number;
  primary_metric?: string | null;
  fdr_p?: number | null;
  naive_z_goals?: number | null;
  metrics?: Record<string, MetricEvidence>;
  up_metrics?: string[];
  role_change?: RoleChangeEvidence;
  /** WORKLOAD_SPIKE only. */
  congestion_minutes?: number | null;
  baseline_congestion?: number | null;
  ratio?: number | null;
}
