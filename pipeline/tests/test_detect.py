"""Tests for the detection runner's pure parts — no DB, no credentials."""

import numpy as np
import pandas as pd
import pytest

from src.detect import (
    FAMILY,
    P90_MAP,
    _detectors_fired,
    _evaluate,
    _evidence,
    _persistence,
    _r,
)


def _frame(goals: list[float], xg: list[float]) -> pd.DataFrame:
    n = len(goals)
    df = pd.DataFrame({
        "date": pd.date_range("2026-01-05", periods=n, freq="7D"),
        "match_id": range(1, n + 1),
        "minutes": [90] * n,
        "goals": goals,
        "xg": xg,
        "shots": [2] * n,
        "key_passes": [1] * n,
        "xg_chain": [0.5] * n,
        "xg_buildup": [0.3] * n,
        "is_qualifying": [True] * n,
    })
    for col, src in P90_MAP.items():
        df[col] = df[src] / df["minutes"] * 90
    return df


# --- _evaluate ---------------------------------------------------------------

def test_too_few_qualifying_matches_ineligible() -> None:
    g = _frame([0] * 8, [0.2] * 8)
    assert _evaluate(g, g["date"].max(), None) is None


def test_stale_player_ineligible() -> None:
    g = _frame([0] * 16, [0.2] * 16)
    as_of = g["date"].max() + pd.Timedelta(days=40)
    assert _evaluate(g, as_of, None) is None


def test_quiet_player_has_no_type() -> None:
    rng = np.random.default_rng(3)
    goals = rng.poisson(0.3, size=20).tolist()
    g = _frame(goals, [0.3] * 20)
    res = _evaluate(g, g["date"].max(), None)
    assert res is not None
    assert res["type"] is None
    assert not res["workload"]["flagged"]   # steady weekly schedule
    assert set(res["bayes"]) == {"goals", "shots", "key_passes", "xg", "xg_buildup"}


def test_scoring_surge_types_as_breakout() -> None:
    goals = [0] * 14 + [2] * 6
    xg = [0.2] * 14 + [1.8] * 6
    g = _frame(goals, xg)
    res = _evaluate(g, g["date"].max(), None)
    assert res["type"] == "BREAKOUT"
    assert res["primary_metric"] in ("goals", "shots", "key_passes", "xg_buildup")


# --- _persistence ------------------------------------------------------------

def test_persistence_rules() -> None:
    as_of = pd.Timestamp("2026-05-24")
    assert _persistence(None, as_of) == 1
    same_week = {"evidence": {"as_of": "2026-05-24", "persistence_weeks": 3}}
    assert _persistence(same_week, as_of) == 3
    older = {"evidence": {"as_of": "2026-05-17", "persistence_weeks": 3}}
    assert _persistence(older, as_of) == 4


# --- helpers -----------------------------------------------------------------

def test_round_helper_handles_nan_and_none() -> None:
    assert _r(None) is None
    assert _r(float("nan")) is None
    assert _r(0.123456) == 0.1235


def test_evidence_and_detectors_fired() -> None:
    goals = [0] * 14 + [2] * 6
    xg = [0.2] * 14 + [1.8] * 6
    g = _frame(goals, xg)
    as_of = g["date"].max()
    res = _evaluate(g, as_of, None)

    ev = _evidence(res, as_of, fdr_p=0.02, weeks=2)
    assert ev["as_of"] == as_of.date().isoformat()
    assert ev["family"] == FAMILY[res["type"]]
    assert ev["persistence_weeks"] == 2
    assert ev["fdr_p"] == 0.02
    assert set(ev["metrics"]) == {"goals", "shots", "key_passes", "xg", "xg_buildup"}
    for r in ev["metrics"].values():
        assert {"baseline_rate", "recent_rate", "baseline_ci", "recent_ci",
                "kl", "p_value", "direction", "flagged"} <= set(r)

    fired = _detectors_fired(res)
    assert "bayesian:goals" in fired
    assert "bayesian:xg" in fired
