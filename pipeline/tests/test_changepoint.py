"""Tests for the change-point detector — pure numpy/ruptures, no credentials."""

import numpy as np
import pandas as pd
import pytest

from src.detectors.changepoint import MIN_SEGMENT, composite_index, find_change_points

COLS = ["xg_p90", "shots_p90", "key_passes_p90", "xg_buildup_p90"]


def _player_frame(rows: list[list[float]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=COLS)


def test_composite_is_mean_of_column_zscores() -> None:
    df = _player_frame(
        [
            [0.2, 2.0, 1.0, 0.3],
            [0.4, 3.0, 2.0, 0.5],
            [0.6, 4.0, 3.0, 0.7],
        ]
    )
    signal = composite_index(df)
    expected = ((df - df.mean()) / df.std()).mean(axis=1).to_numpy()
    np.testing.assert_allclose(signal, expected)
    assert signal.shape == (3,)
    # middle row sits at every column's mean -> composite exactly 0
    assert signal[1] == pytest.approx(0.0)


def test_composite_skips_zero_variance_metric() -> None:
    df = _player_frame(
        [
            [0.2, 2.0, 1.0, 0.0],
            [0.4, 3.0, 2.0, 0.0],   # xg_buildup_p90 constant -> NaN z-scores
            [0.6, 4.0, 3.0, 0.0],
        ]
    )
    signal = composite_index(df)
    assert np.isfinite(signal).all()


def test_short_series_returns_no_change_points() -> None:
    assert find_change_points(np.zeros(2 * MIN_SEGMENT - 1)) == []


def test_flat_noise_returns_no_change_points() -> None:
    rng = np.random.default_rng(42)
    signal = rng.normal(0.0, 0.3, size=30)
    assert find_change_points(signal) == []


def test_level_shift_is_located() -> None:
    rng = np.random.default_rng(7)
    # 15 matches around 0, then 15 around 3 -> regime starts at index 15
    signal = np.concatenate(
        [rng.normal(0.0, 0.3, size=15), rng.normal(3.0, 0.3, size=15)]
    )
    bkps = find_change_points(signal)
    assert bkps == [15]


def test_two_shifts_are_located() -> None:
    rng = np.random.default_rng(11)
    signal = np.concatenate(
        [
            rng.normal(0.0, 0.3, size=12),
            rng.normal(3.0, 0.3, size=12),
            rng.normal(-2.0, 0.3, size=12),
        ]
    )
    bkps = find_change_points(signal)
    # exact placement jitters by a match or two in noise; require one
    # breakpoint near each true shift
    assert len(bkps) == 2
    assert abs(bkps[0] - 12) <= 2
    assert abs(bkps[1] - 24) <= 2


def test_series_end_sentinel_is_dropped() -> None:
    rng = np.random.default_rng(3)
    signal = rng.normal(0.0, 0.3, size=2 * MIN_SEGMENT)
    bkps = find_change_points(signal)
    assert len(signal) not in bkps


def test_accepts_plain_list_input() -> None:
    assert find_change_points([0.0] * 30) == []
