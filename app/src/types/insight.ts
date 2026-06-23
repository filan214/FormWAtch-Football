/**
 * Zod schema for `ai_insights.payload` (PRD §6.2 AnomalyInsight). Every
 * payload is parsed through this before rendering; a parse failure renders
 * the fallback card instead of crashing the page.
 */
import { z } from "zod";

export const ANOMALY_TYPES = [
  "FORM_COLLAPSE",
  "FINISHING_SLUMP",
  "BREAKOUT",
  "OVERPERFORMANCE_RISK",
  "WORKLOAD_SPIKE",
  "ROLE_CHANGE",
] as const;

export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export const insightSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  technicalExplanation: z.string(),
  anomalyType: z.enum(ANOMALY_TYPES),
  confidence: z.enum(["low", "medium", "high"]),
  keyEvidence: z
    .array(
      z.object({
        metric: z.string(),
        baseline: z.number(),
        recent: z.number(),
        unit: z.string(),
      }),
    )
    .min(1),
  outlook: z.string(),
  fantasyImplication: z.string().optional(),
});

export type AnomalyInsight = z.infer<typeof insightSchema>;

export function parseInsight(payload: unknown): AnomalyInsight | null {
  const result = insightSchema.safeParse(payload);
  return result.success ? result.data : null;
}
