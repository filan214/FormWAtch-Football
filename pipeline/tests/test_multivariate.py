"""Tests for the multivariate detector — pure numpy/sklearn, no credentials."""

import numpy as np
import pandas as pd
import pytest

from src.detectors.multivariate import FEATURES, league_isoforest, mahalanobis_profile

RNG = np.random.default_rng(42)


def _correlated_history(n: int = 40) -> np.ndarray:
    """Synthetic per-90 vectors with realistic cross-metric correlation."""
    base = RNG.normal(0.0, 1.0, size=(n, 1))
    noise = RNG.normal(0.0, 0.5, size=(n, len(FEATURES)))
    return np.abs(1.0 + 0.8 * base + noise)  # all metrics co-move


def test_features_are_the_understat_per90_set() -> None:
    assert len(FEATURES) == 6
    understat_p90 = {
        "goals_p90", "shots_p90", "xg_p90", "xa_p90",
        "key_passes_p90", "xg_chain_p90", "xg_buildup_p90",
    }
    assert set(FEATURES) <= understat_p90


def test_no_shift_gives_near_zero_distance() -> None:
    history = _correlated_history(60)
    d, diff = mahalanobis_profile(history, history)
    assert d == pytest.approx(0.0, abs=1e-9)
    np.testing.assert_allclose(diff, 0.0, atol=1e-12)


def test_shift_direction_is_reported_in_diff() -> None:
    history = _correlated_history(60)
    recent = history[-8:].copy()
    recent[:, 1] += 2.0   # shots_p90 jumps
    d, diff = mahalanobis_profile(history, recent)
    assert d > 0.0
    assert diff[1] > 0.0
    assert np.argmax(np.abs(diff)) == 1


def test_bigger_shift_gives_bigger_distance() -> None:
    history = _correlated_history(60)
    base = history[-8:].copy()
    small, big = base.copy(), base.copy()
    small[:, 0] += 0.5
    big[:, 0] += 2.5
    d_small, _ = mahalanobis_profile(history, small)
    d_big, _ = mahalanobis_profile(history, big)
    assert d_big > d_small > 0.0


def test_short_history_fewer_rows_than_features_is_finite() -> None:
    # Ledoit-Wolf shrinkage keeps the covariance invertible when n < p
    history = _correlated_history(4)
    recent = _correlated_history(3)
    d, _ = mahalanobis_profile(history, recent)
    assert np.isfinite(d)


def test_dataframe_input_works() -> None:
    history = pd.DataFrame(_correlated_history(40), columns=FEATURES)
    recent = pd.DataFrame(_correlated_history(6), columns=FEATURES)
    d, diff = mahalanobis_profile(history, recent)
    assert np.isfinite(d)
    assert list(diff.index) == FEATURES   # direction stays labeled


def test_isoforest_flags_planted_outlier() -> None:
    vectors = _correlated_history(500)
    outlier = np.full((1, len(FEATURES)), 25.0)   # absurd per-90 profile
    model = league_isoforest(np.vstack([vectors, outlier]))
    assert model.predict(outlier)[0] == -1
    # a typical row stays an inlier
    assert model.predict(vectors[:1])[0] == 1


def test_isoforest_outlier_fraction_tracks_contamination() -> None:
    vectors = _correlated_history(1000)
    model = league_isoforest(vectors)
    frac = float(np.mean(model.predict(vectors) == -1))
    assert 0.005 <= frac <= 0.05   # ~2% by construction
