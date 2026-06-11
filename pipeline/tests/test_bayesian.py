"""Tests for the Gamma-Poisson detector — pure numpy/scipy, no credentials."""

import numpy as np
import pytest

from src.detectors.bayesian import (
    credible_interval,
    detect,
    gamma_posterior,
    kl_gamma,
    recent_weights,
)


def test_posterior_with_no_data_is_the_prior() -> None:
    alpha, beta = gamma_posterior([], [])
    assert (alpha, beta) == (1.0, 1.0)


def test_posterior_accumulates_counts_and_exposure() -> None:
    # 1 goal + 0 goals over two full matches: alpha = 1+1, beta = 1+2
    alpha, beta = gamma_posterior([1, 0], [90, 90])
    assert alpha == pytest.approx(2.0)
    assert beta == pytest.approx(3.0)


def test_recent_weights_decay_toward_older_matches() -> None:
    w = recent_weights(4, halflife=3)
    assert w[-1] == pytest.approx(1.0)          # most recent
    assert np.all(np.diff(w) > 0)               # strictly increasing with recency
    assert w[0] == pytest.approx(0.5 ** (3 / 3))  # age 3 = one halflife


def test_credible_interval_brackets_the_mean() -> None:
    lo, hi = credible_interval(10.0, 10.0)  # mean rate 1.0
    assert lo < 1.0 < hi


def test_kl_is_zero_for_identical_and_positive_otherwise() -> None:
    assert kl_gamma(5.0, 3.0, 5.0, 3.0) == pytest.approx(0.0)
    assert kl_gamma(20.0, 4.0, 2.0, 4.0) > 0.0


def test_stable_scorer_not_flagged() -> None:
    counts = [1, 0] * 10                        # steady ~0.5 goals/90
    minutes = [90] * 20
    result = detect(counts, minutes)
    assert not result["flagged"]
    assert 0.05 < result["p_value"]


def test_collapse_flagged_down_with_small_p() -> None:
    counts = [1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1] + [0] * 6
    minutes = [90] * 20
    result = detect(counts, minutes)
    assert result["flagged"]
    assert result["direction"] == "down"
    assert result["p_value"] < 0.01
    assert result["recent_rate"] < result["baseline_rate"]
    # the credible intervals themselves separate
    assert result["recent_ci"][1] < result["baseline_ci"][0]


def test_breakout_flagged_up_with_small_p() -> None:
    counts = [0] * 12 + [1, 0] + [2, 1, 2, 2, 1, 2]
    minutes = [90] * 20
    result = detect(counts, minutes)
    assert result["flagged"]
    assert result["direction"] == "up"
    assert result["p_value"] < 0.01
    assert result["recent_rate"] > result["baseline_rate"]


def test_result_shape() -> None:
    result = detect([0, 1] * 8, [90] * 16)
    assert set(result) == {
        "flagged", "direction", "p_value", "kl",
        "baseline_ci", "recent_ci", "baseline_rate", "recent_rate",
    }
    assert isinstance(result["flagged"], bool)
    assert result["direction"] in ("down", "up")
    assert 0.0 <= result["p_value"] <= 1.0
    assert len(result["baseline_ci"]) == 2 and len(result["recent_ci"]) == 2
