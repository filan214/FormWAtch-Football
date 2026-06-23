/**
 * Read-only Drizzle mirror of the pipeline-owned schema
 * (pipeline/migrations/001_initial_schema.sql + 002_understat_source.sql).
 * The app never writes; migrations live with the Python pipeline.
 */
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { AnomalyEvidence } from "@/types/evidence";

export const anomalyType = pgEnum("anomaly_type", [
  "FORM_COLLAPSE",
  "FINISHING_SLUMP",
  "BREAKOUT",
  "OVERPERFORMANCE_RISK",
  "WORKLOAD_SPIKE",
  "ROLE_CHANGE",
]);

export const players = pgTable("players", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  understatId: text("understat_id").notNull(),
  name: text("name").notNull(),
  team: text("team"),
  position: text("position"),
  birthDate: date("birth_date"),
  photoUrl: text("photo_url"),
});

export const matches = pgTable("matches", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  understatId: text("understat_id").notNull(),
  season: text("season").notNull(),
  matchweek: integer("matchweek"),
  date: date("date").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeXg: numeric("home_xg", { mode: "number" }),
  awayXg: numeric("away_xg", { mode: "number" }),
});

export const playerMatchStats = pgTable("player_match_stats", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  playerId: bigint("player_id", { mode: "number" }).notNull(),
  matchId: bigint("match_id", { mode: "number" }).notNull(),
  minutes: integer("minutes").notNull(),
  goals: integer("goals"),
  assists: integer("assists"),
  shots: integer("shots"),
  xg: numeric("xg", { mode: "number" }),
  xa: numeric("xa", { mode: "number" }),
  keyPasses: integer("key_passes"),
  xgChain: numeric("xg_chain", { mode: "number" }),
  xgBuildup: numeric("xg_buildup", { mode: "number" }),
  opponentAdjustedXg: numeric("opponent_adjusted_xg", { mode: "number" }),
  isQualifying: boolean("is_qualifying"),
});

export const anomalies = pgTable("anomalies", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  playerId: bigint("player_id", { mode: "number" }).notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true, mode: "string" }),
  matchweek: integer("matchweek"),
  anomalyType: anomalyType("anomaly_type").notNull(),
  severity: integer("severity"),
  status: text("status"),
  detectorsFired: jsonb("detectors_fired").$type<string[]>(),
  evidence: jsonb("evidence").$type<AnomalyEvidence>(),
  changePointMatchId: bigint("change_point_match_id", { mode: "number" }),
  fdrAdjustedP: numeric("fdr_adjusted_p", { mode: "number" }),
});

export const aiInsights = pgTable("ai_insights", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  anomalyId: bigint("anomaly_id", { mode: "number" }).notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  model: text("model"),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "string" }),
  evidenceHash: text("evidence_hash"),
});

export const pipelineRuns = pgTable("pipeline_runs", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  status: text("status"),
  matchweek: integer("matchweek"),
  rowsWritten: integer("rows_written"),
  anomaliesCreated: integer("anomalies_created"),
  logUrl: text("log_url"),
});
