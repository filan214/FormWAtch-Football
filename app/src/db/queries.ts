/**
 * All server-side reads. Every fetcher is wrapped so a missing
 * DATABASE_URL or a transient DB failure renders the route's offline/empty
 * state instead of a 500 — pages stay buildable without credentials.
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  aiInsights,
  anomalies,
  matches,
  pipelineRuns,
  playerMatchStats,
  players,
} from "@/db/schema";
import type { AnomalyType } from "@/types/insight";

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[queries] ${label} failed:`, err);
    return null;
  }
}

export interface FeedFilters {
  type?: AnomalyType;
  team?: string;
  minSeverity: number;
}

export interface FeedRow {
  id: number;
  anomalyType: AnomalyType;
  severity: number;
  matchweek: number | null;
  playerId: number;
  playerName: string;
  team: string | null;
  position: string | null;
  headline: string | null;
  persistenceWeeks: number;
  fdrAdjustedP: number | null;
  asOf: string | null;
}

export async function fetchFeed(filters: FeedFilters): Promise<FeedRow[] | null> {
  return safe("fetchFeed", async () => {
    const db = getDb();
    if (!db) throw new Error("DATABASE_URL not configured");
    const conditions = [
      eq(anomalies.status, "active"),
      gte(anomalies.severity, filters.minSeverity),
    ];
    if (filters.type) conditions.push(eq(anomalies.anomalyType, filters.type));
    if (filters.team) conditions.push(eq(players.team, filters.team));

    const rows = await db
      .select({
        id: anomalies.id,
        anomalyType: anomalies.anomalyType,
        severity: anomalies.severity,
        matchweek: anomalies.matchweek,
        evidence: anomalies.evidence,
        fdrAdjustedP: anomalies.fdrAdjustedP,
        playerId: players.id,
        playerName: players.name,
        team: players.team,
        position: players.position,
        headline: sql<string | null>`${aiInsights.payload}->>'headline'`,
      })
      .from(anomalies)
      .innerJoin(players, eq(anomalies.playerId, players.id))
      .leftJoin(aiInsights, eq(aiInsights.anomalyId, anomalies.id))
      .where(and(...conditions))
      .orderBy(desc(anomalies.severity), desc(anomalies.id));

    return rows.map((r) => ({
      id: r.id,
      anomalyType: r.anomalyType,
      severity: r.severity ?? 0,
      matchweek: r.matchweek,
      playerId: r.playerId,
      playerName: r.playerName,
      team: r.team,
      position: r.position,
      headline: r.headline,
      persistenceWeeks: r.evidence?.persistence_weeks ?? 1,
      fdrAdjustedP: r.fdrAdjustedP,
      asOf: r.evidence?.as_of ?? null,
    }));
  });
}

/** Teams that currently have an active anomaly (for the feed filter). */
export async function fetchActiveTeams(): Promise<string[] | null> {
  return safe("fetchActiveTeams", async () => {
    const db = getDb();
    if (!db) throw new Error("DATABASE_URL not configured");
    const rows = await db
      .selectDistinct({ team: players.team })
      .from(anomalies)
      .innerJoin(players, eq(anomalies.playerId, players.id))
      .where(eq(anomalies.status, "active"));
    return rows
      .map((r) => r.team)
      .filter((t): t is string => Boolean(t))
      .sort();
  });
}

export interface MatchLine {
  date: string;
  opponent: string;
  home: boolean;
  minutes: number;
  goals: number;
  shots: number;
  xg: number;
  xa: number;
  keyPasses: number;
}

/** null = DB unreachable; "not-found" = no such anomaly. */
export async function fetchAnomalyDetail(id: number) {
  return safe("fetchAnomalyDetail", async () => {
    const db = getDb();
    if (!db) throw new Error("DATABASE_URL not configured");

    const [row] = await db
      .select({
        anomaly: anomalies,
        player: players,
        insightPayload: aiInsights.payload,
        insightModel: aiInsights.model,
        insightGeneratedAt: aiInsights.generatedAt,
      })
      .from(anomalies)
      .innerJoin(players, eq(anomalies.playerId, players.id))
      .leftJoin(aiInsights, eq(aiInsights.anomalyId, anomalies.id))
      .where(eq(anomalies.id, id))
      .limit(1);
    if (!row) return "not-found" as const;

    const asOf = row.anomaly.evidence?.as_of;
    const lineConditions = [
      eq(playerMatchStats.playerId, row.player.id),
      eq(playerMatchStats.isQualifying, true),
    ];
    if (asOf) lineConditions.push(lte(matches.date, asOf));

    // Opponent derived from the player's current team — same approximation
    // the narrative layer uses; correct for the recent window this feeds.
    const recent = await db
      .select({
        date: matches.date,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        minutes: playerMatchStats.minutes,
        goals: playerMatchStats.goals,
        shots: playerMatchStats.shots,
        xg: playerMatchStats.xg,
        xa: playerMatchStats.xa,
        keyPasses: playerMatchStats.keyPasses,
      })
      .from(playerMatchStats)
      .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
      .where(and(...lineConditions))
      .orderBy(desc(matches.date))
      .limit(6);

    const matchLines: MatchLine[] = recent.map((m) => {
      const home = m.homeTeam === row.player.team;
      return {
        date: m.date,
        opponent: home ? m.awayTeam : m.homeTeam,
        home,
        minutes: m.minutes,
        goals: m.goals ?? 0,
        shots: m.shots ?? 0,
        xg: m.xg ?? 0,
        xa: m.xa ?? 0,
        keyPasses: m.keyPasses ?? 0,
      };
    });

    return { ...row, matchLines };
  });
}

export interface TimelinePoint {
  matchId: number;
  date: string;
  opponent: string;
  composite: number | null;
  goals: number;
  xgP90: number;
  minutes: number;
}

export interface PlayerAnomaly {
  id: number;
  anomalyType: AnomalyType;
  severity: number;
  status: string | null;
  detectedAt: string | null;
  matchweek: number | null;
  asOf: string | null;
  persistenceWeeks: number;
  changePointDate: string | null;
}

/**
 * The player timeline mirrors the pipeline's composite index
 * (pipeline/src/detectors/changepoint.py): each per-90 involvement metric is
 * z-scored over the player's own qualifying history, then averaged row-wise;
 * zero-variance metrics drop out of the mean.
 */
export async function fetchPlayerTimeline(playerId: number) {
  return safe("fetchPlayerTimeline", async () => {
    const db = getDb();
    if (!db) throw new Error("DATABASE_URL not configured");

    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);
    if (!player) return "not-found" as const;

    const rows = await db
      .select({
        matchId: matches.id,
        date: matches.date,
        season: matches.season,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        minutes: playerMatchStats.minutes,
        goals: playerMatchStats.goals,
        shots: playerMatchStats.shots,
        xg: playerMatchStats.xg,
        keyPasses: playerMatchStats.keyPasses,
        xgBuildup: playerMatchStats.xgBuildup,
      })
      .from(playerMatchStats)
      .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
      .where(
        and(
          eq(playerMatchStats.playerId, playerId),
          eq(playerMatchStats.isQualifying, true),
        ),
      )
      .orderBy(matches.date);

    const per90 = rows.map((r) => ({
      xg: ((r.xg ?? 0) / r.minutes) * 90,
      shots: ((r.shots ?? 0) / r.minutes) * 90,
      keyPasses: ((r.keyPasses ?? 0) / r.minutes) * 90,
      xgBuildup: ((r.xgBuildup ?? 0) / r.minutes) * 90,
    }));
    const keys = ["xg", "shots", "keyPasses", "xgBuildup"] as const;
    const stats = keys.map((k) => {
      const vals = per90.map((p) => p[k]);
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const variance =
        vals.reduce((a, b) => a + (b - mean) ** 2, 0) /
        Math.max(vals.length - 1, 1);
      return { k, mean, std: Math.sqrt(variance) };
    });

    const points: TimelinePoint[] = rows.map((r, i) => {
      const zs = stats
        .filter((s) => s.std > 0)
        .map((s) => (per90[i][s.k] - s.mean) / s.std);
      const composite = zs.length
        ? zs.reduce((a, b) => a + b, 0) / zs.length
        : null;
      return {
        matchId: r.matchId,
        date: r.date,
        opponent: r.homeTeam === player.team ? r.awayTeam : r.homeTeam,
        composite: composite === null ? null : Number(composite.toFixed(3)),
        goals: r.goals ?? 0,
        xgP90: Number(per90[i].xg.toFixed(2)),
        minutes: r.minutes,
      };
    });

    const history = await db
      .select()
      .from(anomalies)
      .where(eq(anomalies.playerId, playerId))
      .orderBy(desc(anomalies.detectedAt));

    const cpMatchIds = history
      .map((a) => a.changePointMatchId)
      .filter((x): x is number => x !== null);
    const cpDates = new Map<number, string>();
    if (cpMatchIds.length) {
      const cpMatches = await db
        .select({ id: matches.id, date: matches.date })
        .from(matches)
        .where(inArray(matches.id, cpMatchIds));
      for (const m of cpMatches) cpDates.set(m.id, m.date);
    }

    const playerAnomalies: PlayerAnomaly[] = history.map((a) => ({
      id: a.id,
      anomalyType: a.anomalyType,
      severity: a.severity ?? 0,
      status: a.status,
      detectedAt: a.detectedAt,
      matchweek: a.matchweek,
      asOf: a.evidence?.as_of ?? null,
      persistenceWeeks: a.evidence?.persistence_weeks ?? 1,
      changePointDate: a.changePointMatchId
        ? (cpDates.get(a.changePointMatchId) ??
          a.evidence?.role_change?.change_point_date ??
          null)
        : (a.evidence?.role_change?.change_point_date ?? null),
    }));

    return { player, points, anomalies: playerAnomalies };
  });
}

export interface LeaderboardRow {
  playerId: number;
  name: string;
  team: string | null;
  position: string | null;
  minutes: number;
  matches: number;
  goals: number;
  xg: number;
  gMinusXg: number;
  goalsP90: number;
  xgP90: number;
  recentXgP90: number | null;
  baselineXgP90: number | null;
  upliftXgP90: number | null;
  activeAnomaly: { id: number; type: AnomalyType; severity: number } | null;
}

/**
 * Season aggregates for the leaderboards, computed in one pass over the
 * current season's qualifying rows (a few thousand — cheaper and clearer
 * than pushing the recent-vs-baseline split into SQL).
 */
export async function fetchLeaderboards() {
  return safe("fetchLeaderboards", async () => {
    const db = getDb();
    if (!db) throw new Error("DATABASE_URL not configured");

    const [latest] = await db
      .select({ season: matches.season })
      .from(matches)
      .orderBy(desc(matches.date))
      .limit(1);
    if (!latest) return { season: null, rows: [] as LeaderboardRow[] };

    const rows = await db
      .select({
        playerId: playerMatchStats.playerId,
        date: matches.date,
        minutes: playerMatchStats.minutes,
        goals: playerMatchStats.goals,
        xg: playerMatchStats.xg,
        name: players.name,
        team: players.team,
        position: players.position,
      })
      .from(playerMatchStats)
      .innerJoin(matches, eq(playerMatchStats.matchId, matches.id))
      .innerJoin(players, eq(playerMatchStats.playerId, players.id))
      .where(
        and(
          eq(playerMatchStats.isQualifying, true),
          eq(matches.season, latest.season),
        ),
      )
      .orderBy(matches.date);

    const active = await db
      .select({
        id: anomalies.id,
        playerId: anomalies.playerId,
        type: anomalies.anomalyType,
        severity: anomalies.severity,
      })
      .from(anomalies)
      .where(eq(anomalies.status, "active"))
      .orderBy(desc(anomalies.severity));
    const activeByPlayer = new Map<
      number,
      { id: number; type: AnomalyType; severity: number }
    >();
    for (const a of active) {
      if (!activeByPlayer.has(a.playerId)) {
        activeByPlayer.set(a.playerId, {
          id: a.id,
          type: a.type,
          severity: a.severity ?? 0,
        });
      }
    }

    const byPlayer = new Map<number, typeof rows>();
    for (const r of rows) {
      const list = byPlayer.get(r.playerId);
      if (list) list.push(r);
      else byPlayer.set(r.playerId, [r]);
    }

    const RECENT = 6; // mirror the detector's recent-form window
    const out: LeaderboardRow[] = [];
    for (const [playerId, list] of byPlayer) {
      const minutes = list.reduce((a, r) => a + r.minutes, 0);
      const goals = list.reduce((a, r) => a + (r.goals ?? 0), 0);
      const xg = list.reduce((a, r) => a + (r.xg ?? 0), 0);
      const recent = list.slice(-RECENT);
      const baseline = list.slice(0, -RECENT);
      const rate = (
        subset: typeof list,
        pick: (r: (typeof list)[number]) => number,
      ) => {
        const mins = subset.reduce((a, r) => a + r.minutes, 0);
        return mins > 0
          ? (subset.reduce((a, r) => a + pick(r), 0) / mins) * 90
          : null;
      };
      const recentXgP90 = recent.length ? rate(recent, (r) => r.xg ?? 0) : null;
      const baselineXgP90 = baseline.length
        ? rate(baseline, (r) => r.xg ?? 0)
        : null;
      out.push({
        playerId,
        name: list[0].name,
        team: list[0].team,
        position: list[0].position,
        minutes,
        matches: list.length,
        goals,
        xg: Number(xg.toFixed(2)),
        gMinusXg: Number((goals - xg).toFixed(2)),
        goalsP90: Number((((goals || 0) / minutes) * 90).toFixed(2)),
        xgP90: Number(((xg / minutes) * 90).toFixed(2)),
        recentXgP90:
          recentXgP90 === null ? null : Number(recentXgP90.toFixed(2)),
        baselineXgP90:
          baselineXgP90 === null ? null : Number(baselineXgP90.toFixed(2)),
        upliftXgP90:
          recentXgP90 !== null && baselineXgP90 !== null
            ? Number((recentXgP90 - baselineXgP90).toFixed(2))
            : null,
        activeAnomaly: activeByPlayer.get(playerId) ?? null,
      });
    }
    return { season: latest.season, rows: out };
  });
}

export interface PipelineStatus {
  finishedAt: string | null;
  status: string | null;
  matchweek: number | null;
  anomaliesCreated: number | null;
}

export async function fetchPipelineStatus(): Promise<PipelineStatus | null> {
  return safe("fetchPipelineStatus", async () => {
    const db = getDb();
    if (!db) throw new Error("DATABASE_URL not configured");
    const [run] = await db
      .select({
        finishedAt: pipelineRuns.finishedAt,
        status: pipelineRuns.status,
        matchweek: pipelineRuns.matchweek,
        anomaliesCreated: pipelineRuns.anomaliesCreated,
      })
      .from(pipelineRuns)
      .orderBy(desc(pipelineRuns.id))
      .limit(1);
    return run ?? null;
  });
}

export interface ExampleAnomaly {
  id: number;
  playerName: string;
  anomalyType: AnomalyType;
  severity: number;
}

/** Live examples linked from the methodology page. */
export async function fetchExampleAnomalies(): Promise<ExampleAnomaly[] | null> {
  return safe("fetchExampleAnomalies", async () => {
    const db = getDb();
    if (!db) throw new Error("DATABASE_URL not configured");
    const rows = await db
      .select({
        id: anomalies.id,
        playerName: players.name,
        anomalyType: anomalies.anomalyType,
        severity: anomalies.severity,
      })
      .from(anomalies)
      .innerJoin(players, eq(anomalies.playerId, players.id))
      .where(eq(anomalies.status, "active"))
      .orderBy(desc(anomalies.severity))
      .limit(3);
    return rows.map((r) => ({ ...r, severity: r.severity ?? 0 }));
  });
}
