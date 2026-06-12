"""Weekly anomaly detection runner — wires the Phase 2 engine into the pipeline.

Productionizes the conventions validated by the Step 2.7 backtest
(pipeline/scripts/backtest.py, results in pipeline/BACKTEST.md), at the
backtest-tuned defaults:

* Evaluation is **as of the latest completed match in the DB**, not the
  wall clock — a re-run on unchanged data is a byte-identical no-op, which
  keeps anomaly evidence (and therefore AI-insight caching) deterministic.
* Eligibility: >= 10 qualifying matches, the most recent within 28 days of
  the as-of date (injured/transferred players drop out of the feed).
* Candidate p-values go through Benjamini-Hochberg FDR at ``scoring.FDR_Q``;
  ROLE_CHANGE bypasses FDR (the PELT penalty is its significance gate) and
  enters severity with ``fdr_p = FDR_Q / 2``.
* One **active** anomaly row per (player, family): the row is updated in
  place while the anomaly persists week over week (``persistence_weeks``
  rides along in the evidence jsonb) and resolved when no longer detected.
  WORKLOAD_SPIKE is its own family and stacks beside a primary anomaly.
"""

import logging
from datetime import timedelta

import numpy as np
import pandas as pd

from .detectors.bayesian import detect
from .detectors.changepoint import composite_index, find_change_points
from .detectors.naive import zscore_flags
from .scoring import (
    BREADTH_METRICS,
    FDR_Q,
    OVERPERF_WINDOW,
    apply_fdr,
    broad_uplift,
    classify,
    overperf_vs_xg,
    role_change,
    severity,
    workload_spike,
)

logger = logging.getLogger(__name__)

MIN_QUALIFYING = 10   # 6 recent + at least 4 baseline matches
RECENCY_DAYS = 28     # last qualifying match must be this close to as_of

METRICS = ["goals", "shots", "key_passes", "xg", "xg_buildup"]
P90_MAP = {
    "goals_p90": "goals", "shots_p90": "shots", "xg_p90": "xg",
    "key_passes_p90": "key_passes", "xg_chain_p90": "xg_chain",
    "xg_buildup_p90": "xg_buildup",
}
FAMILY = {
    "FORM_COLLAPSE": "DOWN", "FINISHING_SLUMP": "DOWN",
    "OVERPERFORMANCE_RISK": "UP", "BREAKOUT": "UP",
    "ROLE_CHANGE": "ROLE", "WORKLOAD_SPIKE": "WORKLOAD",
}


def _r(x, nd: int = 4):
    """Round for evidence jsonb; identical floats across runs keep hashes stable."""
    if x is None:
        return None
    x = float(x)
    return None if np.isnan(x) else round(x, nd)


def _evaluate(g: pd.DataFrame, as_of: pd.Timestamp, prior_up: set | None) -> dict | None:
    """Run the full detector stack for one player.

    Args:
        g: The player's appearances (minutes > 0) in date order, with raw
            metric columns, the P90_MAP per-90 columns, ``date``,
            ``match_id`` and ``is_qualifying``.
        as_of: Evaluation date (latest completed match in the league).
        prior_up: Breadth metrics elevated in this player's surviving
            BREAKOUT evidence from the previous run, if any.

    Returns:
        dict with the typed candidate (or None), the workload result, and
        everything needed to build evidence — or None if ineligible.
    """
    q = g[g["is_qualifying"]]
    if len(q) < MIN_QUALIFYING:
        return None
    if (as_of - q["date"].max()).days > RECENCY_DAYS:
        return None

    minutes = q["minutes"].to_numpy(dtype=float)
    bayes = {m: detect(q[m].to_numpy(dtype=float), minutes) for m in METRICS}

    qp90 = q[list(P90_MAP)]
    change_points = find_change_points(composite_index(qp90))
    rc = role_change(qp90, change_points)
    over = overperf_vs_xg(q.tail(OVERPERF_WINDOW)[["goals", "xg"]])
    uplift = broad_uplift(bayes, prior_up)
    typ = classify(bayes, rc, over, uplift)

    naive_flags, naive_z = zscore_flags(q["goals_p90"])

    result = {
        "type": typ,
        "bayes": bayes,
        "role": rc,
        "overperforming": over,
        "workload": workload_spike(g[["date", "minutes"]], as_of=as_of),
        "naive_z_goals": _r(naive_z.iloc[-1], 2),
        "qualifying_matches": int(len(q)),
    }
    if typ is None:
        return result

    if typ == "BREAKOUT":
        up = [
            m for m in BREADTH_METRICS
            if bayes[m]["flagged"] and bayes[m]["direction"] == "up"
        ]
        # breadth route: strongest breadth metric; scoring-surge route: goals
        result["primary_metric"] = (
            min(up, key=lambda m: bayes[m]["p_value"]) if up else "goals"
        )
        result["up_metrics"] = sorted(up)
    else:
        result["primary_metric"] = "goals"
        result["up_metrics"] = []
    if rc["flagged"]:
        cp = rc["change_point"]
        result["change_point_match_id"] = int(q.iloc[cp]["match_id"])
        result["change_point_date"] = q.iloc[cp]["date"].date().isoformat()
    return result


def _evidence(res: dict, as_of: pd.Timestamp, fdr_p: float | None, weeks: int) -> dict:
    """Self-contained evidence jsonb: everything the UI and the narrative
    layer need without re-running detectors."""
    ev = {
        "as_of": as_of.date().isoformat(),
        "family": FAMILY[res["type"]],
        "persistence_weeks": weeks,
        "qualifying_matches": res["qualifying_matches"],
        "primary_metric": res.get("primary_metric"),
        "fdr_p": _r(fdr_p),
        "naive_z_goals": res["naive_z_goals"],
        "metrics": {
            m: {
                "baseline_rate": _r(r["baseline_rate"]),
                "recent_rate": _r(r["recent_rate"]),
                "baseline_ci": [_r(x) for x in r["baseline_ci"]],
                "recent_ci": [_r(x) for x in r["recent_ci"]],
                "kl": _r(r["kl"]),
                "p_value": _r(r["p_value"], 6),
                "direction": r["direction"],
                "flagged": r["flagged"],
            }
            for m, r in res["bayes"].items()
        },
    }
    if res["up_metrics"]:
        ev["up_metrics"] = res["up_metrics"]
    if res["role"]["flagged"]:
        ev["role_change"] = {
            "d": _r(res["role"]["d"]),
            "dominant": res["role"]["dominant"],
            "diff": {k: _r(v) for k, v in res["role"]["diff"].items()},
            "change_point_date": res["change_point_date"],
        }
    return ev


def _workload_evidence(res: dict, as_of: pd.Timestamp, weeks: int) -> dict:
    wl = res["workload"]
    return {
        "as_of": as_of.date().isoformat(),
        "family": "WORKLOAD",
        "persistence_weeks": weeks,
        "congestion_minutes": _r(wl["congestion"], 0),
        "baseline_congestion": _r(wl["baseline_congestion"], 0),
        "ratio": _r(wl["ratio"], 2),
    }


def _detectors_fired(res: dict) -> list[str]:
    fired = [
        f"bayesian:{m}" for m, r in res["bayes"].items() if r["flagged"]
    ]
    if res["overperforming"]:
        fired.append("overperf_vs_xg")
    if res["role"]["flagged"]:
        fired.append("changepoint+mahalanobis")
    return fired


def _persistence(prev: dict | None, as_of: pd.Timestamp) -> int:
    """Consecutive-week counter, carried in evidence across runs.

    Same as_of (re-run on unchanged data) keeps the counter; a newer as_of
    increments it; no previous active row starts at 1.
    """
    if prev is None:
        return 1
    prev_weeks = int(prev["evidence"].get("persistence_weeks", 1))
    if prev["evidence"].get("as_of") == as_of.date().isoformat():
        return prev_weeks
    return prev_weeks + 1


def run_detection() -> dict:
    """Detect, persist and resolve anomalies against the live DB."""
    from . import db

    stats = pd.DataFrame(db.fetch_all(
        "player_match_stats",
        "player_id,match_id,minutes,goals,shots,xg,key_passes,xg_chain,"
        "xg_buildup,is_qualifying",
    ))
    matches = pd.DataFrame(
        db.fetch_all("matches", "id,season,date,home_team,away_team")
    ).rename(columns={"id": "match_id"})
    matches["date"] = pd.to_datetime(matches["date"])

    df = stats.merge(matches[["match_id", "season", "date"]], on="match_id")
    df = df[df["minutes"] > 0].copy()
    for col, src in P90_MAP.items():
        df[col] = df[src] / df["minutes"] * 90
    as_of = df["date"].max()

    active = {
        (r["player_id"], FAMILY[r["anomaly_type"]]): r
        for r in db.fetch_active_anomalies()
    }
    prior_up = {
        pid: set(row["evidence"]["up_metrics"])
        for (pid, fam), row in active.items()
        if fam == "UP" and row["evidence"].get("up_metrics")
    }

    # Understat has no round numbers: the busiest team's completed-match
    # count in the season of the as-of date stands in for the matchweek.
    season = df.loc[df["date"] == as_of, "season"].iloc[0]
    played = matches[(matches["season"] == season) & (matches["date"] <= as_of)]
    matchweek = (
        int(pd.concat([played["home_team"], played["away_team"]]).value_counts().max())
        if len(played) else None
    )

    candidates, roles, workloads = [], [], []
    eligible = 0
    for pid, g in df.groupby("player_id"):
        res = _evaluate(g.sort_values("date"), as_of, prior_up.get(pid))
        if res is None:
            continue
        eligible += 1
        if res["workload"]["flagged"]:
            workloads.append((pid, res))
        if res["type"] == "ROLE_CHANGE":
            roles.append((pid, res))
        elif res["type"] is not None:
            candidates.append((pid, res))

    adjusted, keep = apply_fdr(
        [res["bayes"][res["primary_metric"]]["p_value"] for _, res in candidates]
    )
    survivors = [
        (pid, res, float(a))
        for (pid, res), a, k in zip(candidates, adjusted, keep)
        if k
    ]
    survivors += [(pid, res, FDR_Q / 2) for pid, res in roles]

    inserts, updates, resolved_keep = [], [], set()
    for pid, res, fdr_p in survivors:
        fam = FAMILY[res["type"]]
        prev = active.get((pid, fam))
        weeks = _persistence(prev, as_of)
        kl = (
            res["role"]["d"] if res["type"] == "ROLE_CHANGE"
            else res["bayes"][res["primary_metric"]]["kl"]
        )
        row = {
            "player_id": int(pid),
            "matchweek": matchweek,
            "anomaly_type": res["type"],
            "severity": severity(kl, weeks, fdr_p),
            "status": "active",
            "detectors_fired": _detectors_fired(res),
            "evidence": _evidence(res, as_of, fdr_p, weeks),
            "change_point_match_id": res.get("change_point_match_id"),
            "fdr_adjusted_p": _r(fdr_p, 6),
        }
        resolved_keep.add((pid, fam))
        if prev is None:
            inserts.append(row)
        elif prev["evidence"] != row["evidence"] or prev["anomaly_type"] != res["type"]:
            updates.append((prev["id"], row))

    for pid, res in workloads:
        prev = active.get((pid, "WORKLOAD"))
        weeks = _persistence(prev, as_of)
        # minutes load has no posterior; scale the ratio overshoot into the
        # KL slot so a 2.5x load saturates the evidence term like KL >= 3
        kl_proxy = 2.0 * (res["workload"]["ratio"] - 1.0)
        row = {
            "player_id": int(pid),
            "matchweek": matchweek,
            "anomaly_type": "WORKLOAD_SPIKE",
            "severity": severity(kl_proxy, weeks, FDR_Q / 2),
            "status": "active",
            "detectors_fired": ["workload_35d"],
            "evidence": _workload_evidence(res, as_of, weeks),
            "change_point_match_id": None,
            "fdr_adjusted_p": None,
        }
        resolved_keep.add((pid, "WORKLOAD"))
        if prev is None:
            inserts.append(row)
        elif prev["evidence"] != row["evidence"]:
            updates.append((prev["id"], row))

    stale = [row["id"] for key, row in active.items() if key not in resolved_keep]

    created = db.insert_anomalies(inserts)
    for anomaly_id, row in updates:
        db.update_anomaly(anomaly_id, row)
    db.resolve_anomalies(stale)

    summary = {
        "as_of": as_of.date().isoformat(),
        "matchweek": matchweek,
        "eligible": eligible,
        "candidates": len(candidates),
        "created": created,
        "updated": len(updates),
        "resolved": len(stale),
        "active": len(survivors) + len(workloads),
    }
    logger.info("Detection: %s", summary)
    return summary
