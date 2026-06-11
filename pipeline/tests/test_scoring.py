"""Tests for the anomaly typing layer — pure pandas/scipy, no credentials."""

import numpy as np
import pandas as pd
import pytest

from src.detectors.multivariate import FEATURES
from src.scoring import (
    broad_uplift,
    classify,
    overperf_vs_xg,
    role_change,
    workload_spike,
)


def _bayes(flagged=False, direction="up", recent=1.0, baseline=1.0, kl=0.0):
    return {
        "flagged": flagged,
        "direction": direction,
        "recent_rate": recent,
        "baseline_rate": baseline,
        "kl": kl,
        "p_value": 0.5,
    }


def _window(goals: list[float], xg: list[float]) -> pd.DataFrame:
    return pd.DataFrame({"goals": goals, "xg": xg})


# --- overperf_vs_xg -------------------------------------------------------

def test_overperf_clear_case() -> None:
    # 7 goals on 2.5 xG: huge margin, tiny tail probability
    assert overperf_vs_xg(_window([1, 1, 1, 1, 1, 1, 1, 0], [0.3] * 8 + []))


def test_overperf_margin_floor_blocks_lucky_small_samples() -> None:
    # 2 goals on 0.05 xG is "significant" but margin 1.95 < 2.0
    assert not overperf_vs_xg(_window([2, 0, 0, 0, 0, 0, 0, 0], [0.05] + [0.0] * 7))


def test_overperf_requires_significance_not_just_margin() -> None:
    # 9 goals on 7.0 xG: margin 2.0 met, but p = sf(8, 7) ~ 0.27
    assert not overperf_vs_xg(_window([2, 2, 2, 1, 1, 1, 0, 0], [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5, 0.5]))


def test_overperf_zero_goals_never_fires() -> None:
    assert not overperf_vs_xg(_window([0] * 8, [0.2] * 8))


# --- broad_uplift ----------------------------------------------------------

def _uplift_results(shots_up=True, kp_up=True, xgb_up=False, goals_dir_up=True, kl=3.0):
    return {
        "shots": _bayes(flagged=shots_up, direction="up", kl=kl),
        "key_passes": _bayes(flagged=kp_up, direction="up", kl=kl),
        "xg_buildup": _bayes(flagged=xgb_up, direction="up", kl=kl),
        "goals": _bayes(recent=1.2 if goals_dir_up else 0.8, baseline=1.0),
        "xg": _bayes(recent=0.9, baseline=1.0),
    }


def test_uplift_with_prior_persistence() -> None:
    assert broad_uplift(_uplift_results(), prior_up_metrics={"shots", "key_passes"})


def test_uplift_rejected_when_prior_week_disagrees() -> None:
    assert not broad_uplift(_uplift_results(), prior_up_metrics={"xg_buildup"})


def test_uplift_no_prior_falls_back_to_kl() -> None:
    assert broad_uplift(_uplift_results(kl=2.5))
    assert not broad_uplift(_uplift_results(kl=1.0))


def test_uplift_needs_breadth() -> None:
    assert not broad_uplift(_uplift_results(kp_up=False, xgb_up=False))


def test_uplift_needs_output_direction() -> None:
    assert not broad_uplift(_uplift_results(goals_dir_up=False))


# --- workload_spike --------------------------------------------------------

def _weekly_log(n: int, minutes: int = 90, start: str = "2025-08-16") -> pd.DataFrame:
    dates = pd.date_range(start, periods=n, freq="7D")
    return pd.DataFrame({"date": dates, "minutes": [minutes] * n})


def test_workload_steady_schedule_not_flagged() -> None:
    result = workload_spike(_weekly_log(30))
    assert not result["flagged"]
    assert result["ratio"] == pytest.approx(1.0, abs=0.2)


def test_workload_congestion_flagged() -> None:
    # weekly rhythm, then a December-style pileup: 11 matches in 33 days
    calm = _weekly_log(20)
    pileup = pd.DataFrame(
        {
            "date": pd.date_range("2026-01-05", periods=11, freq="3D"),
            "minutes": [90] * 11,
        }
    )
    result = workload_spike(pd.concat([calm, pileup], ignore_index=True))
    assert result["flagged"]
    assert result["congestion"] >= 900
    assert result["ratio"] >= 1.5


def test_workload_minutes_floor_blocks_part_timers() -> None:
    # a sub player whose load doubles but stays small
    calm = pd.DataFrame(
        {"date": pd.date_range("2025-08-16", periods=20, freq="7D"), "minutes": [20] * 20}
    )
    pileup = pd.DataFrame(
        {"date": pd.date_range("2026-01-05", periods=10, freq="3D"), "minutes": [60] * 10}
    )
    result = workload_spike(pd.concat([calm, pileup], ignore_index=True))
    assert result["ratio"] >= 1.5
    assert result["congestion"] < 900
    assert not result["flagged"]


# --- role_change -----------------------------------------------------------

def _profile_frame(n: int, rng, shift_at: int | None = None, shift_col: str = "xg_buildup_p90"):
    df = pd.DataFrame(
        np.abs(rng.normal(1.0, 0.2, size=(n, len(FEATURES)))), columns=FEATURES
    )
    if shift_at is not None:
        df.loc[shift_at:, shift_col] += 2.0
    return df


def test_role_change_flags_involvement_shift() -> None:
    rng = np.random.default_rng(5)
    df = _profile_frame(20, rng, shift_at=14)
    result = role_change(df, [14])
    assert result["flagged"]
    assert result["change_point"] == 14
    assert result["d"] >= 1.0
    assert result["dominant"] == "xg_buildup_p90"


def test_role_change_rejects_goals_dominated_shift() -> None:
    rng = np.random.default_rng(5)
    df = _profile_frame(20, rng, shift_at=14, shift_col="goals_p90")
    result = role_change(df, [14])
    assert not result["flagged"]
    assert result["dominant"] == "goals_p90"


def test_role_change_ignores_old_change_points() -> None:
    rng = np.random.default_rng(5)
    df = _profile_frame(30, rng, shift_at=10)
    assert not role_change(df, [10])["flagged"]   # 20 matches ago


def test_role_change_without_change_points() -> None:
    rng = np.random.default_rng(5)
    result = role_change(_profile_frame(20, rng), [])
    assert result == {
        "flagged": False, "change_point": None, "d": None, "diff": None, "dominant": None,
    }


# --- classify precedence ----------------------------------------------------

def _typing_results(goals_flag=False, goals_dir="down", xg_flag=False, xg_dir="down"):
    return {
        "goals": _bayes(flagged=goals_flag, direction=goals_dir),
        "xg": _bayes(flagged=xg_flag, direction=xg_dir),
    }


def test_role_change_beats_everything() -> None:
    bayes = _typing_results(goals_flag=True, xg_flag=True)   # would be FORM_COLLAPSE
    assert classify(bayes, {"flagged": True}, True, True) == "ROLE_CHANGE"


def test_form_collapse() -> None:
    assert classify(_typing_results(goals_flag=True, xg_flag=True)) == "FORM_COLLAPSE"


def test_finishing_slump_when_xg_intact() -> None:
    assert classify(_typing_results(goals_flag=True, xg_flag=False)) == "FINISHING_SLUMP"


def test_overperformance_needs_the_poisson_test() -> None:
    bayes = _typing_results(goals_flag=True, goals_dir="up")
    assert classify(bayes, overperforming=True) == "OVERPERFORMANCE_RISK"
    assert classify(bayes, overperforming=False) is None


def test_breakout_is_last_resort() -> None:
    assert classify(_typing_results(), uplift=True) == "BREAKOUT"


def test_nothing_fires_returns_none() -> None:
    assert classify(_typing_results()) is None
