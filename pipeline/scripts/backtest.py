"""Step 2.7 backtest — replay one season weekly and tune the detector knobs.

Usage (from the repo root, with pipeline/.env in place):

    python pipeline/scripts/backtest.py

Replays the 2024-25 season at weekly evaluation dates using only the data
available at each date, runs the full stack (Bayesian detectors -> typing ->
FDR -> severity) through the real production functions, and scores the
engine against a hand-curated list of known form stories from that season.
A grid over ``kl_threshold`` (Bayesian), ``pen`` (PELT) and ``q`` (FDR) is
ranked on recall vs. the known list and weekly flag volume; findings go to
pipeline/BACKTEST.md.

Conventions exercised here (and intended for the Phase 4 runner):
* p-value fed to FDR: the ``goals`` detector p for the goals-driven types;
  for BREAKOUT, the smallest p among the up-flagged breadth metrics.
* ROLE_CHANGE has no p-value; it bypasses FDR (the conservative PELT
  penalty is its significance gate) and enters severity with fdr_p = q/2.
* WORKLOAD_SPIKE stacks separately and is excluded from the 5-15 volume
  target; weekly counts are reported on the side.
* persistence_weeks counts consecutive weekly evaluations (per player and
  anomaly family) the anomaly survived FDR, starting at 1.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.db import sb
from src.detectors.bayesian import detect
from src.detectors.changepoint import composite_index, find_change_points
from src.scoring import (
    BREADTH_METRICS,
    OVERPERF_WINDOW,
    apply_fdr,
    broad_uplift,
    classify,
    overperf_vs_xg,
    role_change,
    severity,
    workload_spike,
)

SEASON = "2024-25"
WEEKS = pd.date_range("2024-11-18", "2025-05-26", freq="7D")  # Mondays
MIN_QUALIFYING = 10   # 6 recent + at least 4 baseline matches
RECENCY_DAYS = 28     # last qualifying match must be this recent

METRICS = ["goals", "shots", "key_passes", "xg", "xg_buildup"]
P90_MAP = {
    "goals_p90": "goals", "shots_p90": "shots", "xg_p90": "xg",
    "key_passes_p90": "key_passes", "xg_chain_p90": "xg_chain",
    "xg_buildup_p90": "xg_buildup",
}
FAMILY = {
    "FORM_COLLAPSE": "DOWN", "FINISHING_SLUMP": "DOWN",
    "OVERPERFORMANCE_RISK": "UP", "BREAKOUT": "UP", "ROLE_CHANGE": "ROLE",
}

KL_GRID = (1.5, 2.5, 4.0, 6.0)
PEN_GRID = (1.5, 3.0, 5.0)
Q_GRID = (0.05, 0.10, 0.15)

# Known 2024-25 form stories. family: UP = breakout/overperformance, DOWN =
# collapse/slump. A case is a hit when the engine emits a post-FDR anomaly
# of the right family within the window (+/- one week).
#
# The list is premise-checked against the data before scoring: a famous
# story only counts as a test case if it is visible as a within-season
# qualifying per-90 contrast. Cases dropped on that rule (first pass):
# Darwin Núñez (1 qualifying match in window — the anomaly was minutes,
# not rate), Son Heung-Min (mild rate decline, story was about minutes and
# availability), Morgan Rogers / Matheus Cunha (windows not supported —
# output was flat or already hot from matchday 1, which the cold-start
# backtest cannot contrast). Chris Wood is kept as an expected structural
# miss: chronic xG overperformance from day one never contrasts with his
# own within-season baseline.
KNOWN_ANOMALIES = [
    ("Cole Palmer", "DOWN", "2025-02-01", "2025-05-10",
     "famous goal drought from mid-January to the end of the season"),
    ("Erling Haaland", "DOWN", "2024-11-18", "2025-01-15",
     "goal drought through Man City's autumn collapse"),
    ("Jamie Vardy", "DOWN", "2024-12-15", "2025-02-28",
     "dried up through Leicester's scoreless-streak collapse"),
    ("Chris Wood", "UP", "2024-12-01", "2025-03-01",
     "career season, massive xG overperformance (expected miss: cold start)"),
    ("Bryan Mbeumo", "UP", "2024-11-18", "2025-01-15",
     "hot start sustained past Christmas, well above xG"),
    ("Alexander Isak", "UP", "2024-12-01", "2025-02-15",
     "scored in eight consecutive league games"),
    ("Mohamed Salah", "UP", "2024-11-18", "2025-01-31",
     "December surge, goal involvement in nearly everything"),
    ("Justin Kluivert", "UP", "2024-11-18", "2025-01-05",
     "Nov-Dec hot streak including a penalty hat-trick vs Wolves"),
    ("Jean-Philippe Mateta", "UP", "2025-02-01", "2025-04-15",
     "second-half scoring surge"),
    ("Marcus Rashford", "UP", "2025-03-01", "2025-05-15",
     "revival on loan at Aston Villa after being frozen out at United"),
    ("Eberechi Eze", "UP", "2025-04-01", "2025-05-20",
     "late-season scoring streak for Palace"),
]


def _fetch_all(table: str, cols: str) -> pd.DataFrame:
    rows, page = [], 0
    while True:
        chunk = (
            sb.table(table).select(cols)
            .range(page * 1000, page * 1000 + 999).execute().data
        )
        rows += chunk
        if len(chunk) < 1000:
            return pd.DataFrame(rows)
        page += 1


def load_season(season: str) -> tuple[dict[int, pd.DataFrame], dict[str, int]]:
    """Per-player season frames (appearances in date order) + name -> id."""
    stats = _fetch_all(
        "player_match_stats",
        "player_id,match_id,minutes,goals,shots,xg,key_passes,xg_chain,"
        "xg_buildup,is_qualifying",
    )
    matches = _fetch_all("matches", "id,season,date").rename(
        columns={"id": "match_id"}
    )
    players = _fetch_all("players", "id,name")

    df = stats.merge(matches, on="match_id")
    df = df[(df["season"] == season) & (df["minutes"] > 0)].copy()
    df["date"] = pd.to_datetime(df["date"])
    for col, src in P90_MAP.items():
        df[col] = df[src] / df["minutes"] * 90
    by_player = {
        pid: g.sort_values("date") for pid, g in df.groupby("player_id")
    }
    return by_player, dict(zip(players["name"], players["id"]))


def premise_check(by_player: dict, pid_of: dict) -> None:
    """Confirm each known story is visible in the data before scoring on it."""
    print("\n=== premise check (qualifying matches, per-90 in window vs before) ===")
    for name, fam, start, end, note in KNOWN_ANOMALIES:
        g = by_player.get(pid_of[name])
        if g is None:
            print(f"  {name}: NO DATA")
            continue
        g = g[g["is_qualifying"]]
        win = g[g["date"].between(start, end)]
        base = g[g["date"] < start]
        if not len(win) or not len(base):
            print(f"  {name}: window n={len(win)}, baseline n={len(base)} — CHECK WINDOW")
            continue

        def p90(d, m):
            return d[m].sum() / d["minutes"].sum() * 90

        print(
            f"  {name:<22} {fam:<4} n={len(base):>2}->{len(win):>2}  "
            f"goals/90 {p90(base, 'goals'):.2f}->{p90(win, 'goals'):.2f}  "
            f"xg/90 {p90(base, 'xg'):.2f}->{p90(win, 'xg'):.2f}  "
            f"G-xG in window {win['goals'].sum() - win['xg'].sum():+.1f}"
        )


def precompute(by_player: dict) -> dict:
    """Threshold-independent detector stats per (week, player).

    ``detect``'s p, KL, CIs and rates do not depend on kl_threshold, and
    PELT is fitted per penalty value here, so the config sweep only has to
    re-derive flags and run the typing layer.
    """
    eval_data: dict[pd.Timestamp, dict[int, dict]] = {}
    for t in WEEKS:
        week: dict[int, dict] = {}
        for pid, g_all in by_player.items():
            g = g_all[g_all["date"] <= t]
            q = g[g["is_qualifying"]]
            if len(q) < MIN_QUALIFYING:
                continue
            if (t - q["date"].max()).days > RECENCY_DAYS:
                continue

            minutes = q["minutes"].to_numpy(dtype=float)
            bayes = {}
            for m in METRICS:
                r = detect(q[m].to_numpy(dtype=float), minutes)
                b_lo, b_hi = r["baseline_ci"]
                r_lo, r_hi = r["recent_ci"]
                r["no_overlap"] = bool(r_hi < b_lo or r_lo > b_hi)
                bayes[m] = r

            qp90 = q[list(P90_MAP)]
            signal = composite_index(qp90)
            rc = {
                pen: role_change(qp90, find_change_points(signal, pen=pen))
                for pen in PEN_GRID
            }
            week[pid] = {
                "bayes": bayes,
                "overperf": overperf_vs_xg(q.tail(OVERPERF_WINDOW)[["goals", "xg"]]),
                "rc": rc,
                "workload": workload_spike(g[["date", "minutes"]], as_of=t),
            }
        eval_data[t] = week
        print(f"  precomputed {t.date()}: {len(week)} eligible players")
    return eval_data


def run_config(eval_data: dict, kl_thr: float, pen: float, q: float):
    """Replay the season for one knob setting; return weekly stats + flags."""
    prior_up: dict[int, set] = {}    # last week's surviving BREAKOUT evidence
    streak: dict[tuple, int] = {}    # (pid, family) -> consecutive weeks
    weekly, records = [], []
    for t in WEEKS:
        week = eval_data[t]
        cands, roles = [], []
        for pid, rec in week.items():
            bayes = {
                m: dict(r, flagged=bool(r["no_overlap"] or r["kl"] >= kl_thr))
                for m, r in rec["bayes"].items()
            }
            uplift = broad_uplift(bayes, prior_up.get(pid))
            typ = classify(bayes, rec["rc"][pen], rec["overperf"], uplift)
            if typ is None:
                continue
            if typ == "ROLE_CHANGE":
                roles.append({"pid": pid, "type": typ, "kl": rec["rc"][pen]["d"], "up": None})
                continue
            if typ == "BREAKOUT":
                up = [
                    m for m in BREADTH_METRICS
                    if bayes[m]["flagged"] and bayes[m]["direction"] == "up"
                ]
                # breadth route: strongest breadth metric; scoring-surge
                # route (goals+xg up, no breadth): the exact goals p
                m_star = min(up, key=lambda m: bayes[m]["p_value"]) if up else "goals"
                up_set = set(up) or None
            else:
                m_star, up_set = "goals", None
            cands.append({
                "pid": pid, "type": typ, "up": up_set,
                "p": bayes[m_star]["p_value"], "kl": bayes[m_star]["kl"],
            })

        adjusted, keep = apply_fdr([c["p"] for c in cands], q=q)
        survivors = [(c, float(a)) for c, a, k in zip(cands, adjusted, keep) if k]
        survivors += [(r, q / 2) for r in roles]   # no p; PELT pen is the gate

        new_prior_up, new_streak, active60 = {}, {}, 0
        for c, fdr_p in survivors:
            fam = FAMILY[c["type"]]
            wk = new_streak[(c["pid"], fam)] = streak.get((c["pid"], fam), 0) + 1
            sev = severity(c["kl"], wk, fdr_p)
            active60 += sev >= 60
            if c["up"]:
                new_prior_up[c["pid"]] = c["up"]
            records.append({
                "week": t, "pid": c["pid"], "type": c["type"], "family": fam,
                "severity": sev, "fdr_p": fdr_p, "survived": True,
            })
        for c, a, k in zip(cands, adjusted, keep):
            if not k:
                records.append({
                    "week": t, "pid": c["pid"], "type": c["type"],
                    "family": FAMILY[c["type"]], "severity": np.nan,
                    "fdr_p": float(a), "survived": False,
                })
        weekly.append({
            "week": t, "eligible": len(week), "candidates": len(cands),
            "survivors": len(survivors), "active60": active60,
            "workload": sum(r["workload"]["flagged"] for r in week.values()),
        })
        prior_up, streak = new_prior_up, new_streak
    return pd.DataFrame(weekly), pd.DataFrame(records)


def score_known(flags: pd.DataFrame, pid_of: dict) -> pd.DataFrame:
    rows = []
    for name, fam, start, end, note in KNOWN_ANOMALIES:
        lo = pd.Timestamp(start) - pd.Timedelta(days=7)
        hi = pd.Timestamp(end) + pd.Timedelta(days=7)
        sub = flags[
            (flags["pid"] == pid_of[name])
            & (flags["family"] == fam)
            & flags["week"].between(lo, hi)
        ] if len(flags) else flags
        surv = sub[sub["survived"]] if len(sub) else sub
        rows.append({
            "name": name, "family": fam,
            "weeks_candidate": len(sub), "weeks_flagged": len(surv),
            "max_severity": surv["severity"].max() if len(surv) else np.nan,
            "types": "/".join(sorted(surv["type"].unique())) if len(surv) else "-",
            "hit": len(surv) > 0,
        })
    return pd.DataFrame(rows)


def main() -> None:
    print(f"loading {SEASON} ...")
    by_player, pid_of = load_season(SEASON)
    for name, *_ in KNOWN_ANOMALIES:
        assert name in pid_of, f"unresolved player name: {name}"
    premise_check(by_player, pid_of)
    if "--premise-only" in sys.argv:
        return

    print("\n=== precompute ===")
    eval_data = precompute(by_player)

    print("\n=== grid search ===")
    summary = []
    for kl_thr in KL_GRID:
        for pen in PEN_GRID:
            for q in Q_GRID:
                weekly, flags = run_config(eval_data, kl_thr, pen, q)
                cases = score_known(flags, pid_of)
                summary.append({
                    "kl": kl_thr, "pen": pen, "q": q,
                    "recall": cases["hit"].mean(),
                    "recall60": (cases["max_severity"] >= 60).mean(),
                    "med_active60": weekly["active60"].median(),
                    "p90_active60": weekly["active60"].quantile(0.9),
                    "med_survivors": weekly["survivors"].median(),
                    "med_candidates": weekly["candidates"].median(),
                })
    grid = pd.DataFrame(summary)
    in_target = grid["med_active60"].between(5, 15)
    grid["ok"] = (grid["recall"] >= 0.70) & in_target
    grid = grid.sort_values(
        ["ok", "recall", "recall60", "med_active60"], ascending=[False, False, False, True]
    )
    print(grid.to_string(index=False))

    best = grid.iloc[0]
    kl_thr, pen, q = float(best["kl"]), float(best["pen"]), float(best["q"])
    print(f"\n=== detail for kl_threshold={kl_thr}, pen={pen}, q={q} ===")
    weekly, flags = run_config(eval_data, kl_thr, pen, q)
    cases = score_known(flags, pid_of)
    print(cases.to_string(index=False))
    print(f"\nrecall: {cases['hit'].mean():.0%}   "
          f"recall@sev>=60: {(cases['max_severity'] >= 60).mean():.0%}")
    print("\nweekly volume:")
    print(weekly.to_string(index=False))

    name_of = {v: k for k, v in pid_of.items()}
    surv = flags[flags["survived"]].copy()
    surv["name"] = surv["pid"].map(name_of)
    top = surv.sort_values("severity", ascending=False).head(15)
    print("\ntop flags league-wide:")
    for _, r in top.iterrows():
        print(f"  {r['severity']:>4.0f}  {r['week'].date()}  {r['type']:<21} {r['name']}")
    by_type = surv["type"].value_counts()
    print(f"\nsurviving flags by type over the season:\n{by_type.to_string()}")


if __name__ == "__main__":
    main()
