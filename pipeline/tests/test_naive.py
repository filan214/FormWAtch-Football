"""Tests for the naive z-score detector — pure pandas, no credentials."""

import numpy as np
import pandas as pd

from src.detectors.naive import zscore_flags

# 12 stable matches around 1.0 with nonzero variance.
STABLE = [0.9, 1.1] * 6


def test_stable_series_never_flags() -> None:
    series = pd.Series(STABLE + [1.0, 0.9, 1.1])
    flags, _ = zscore_flags(series)
    assert not flags.any()


def test_breakout_flags_with_positive_z() -> None:
    series = pd.Series(STABLE + [5.0, 5.0, 5.0])
    flags, z = zscore_flags(series)
    assert bool(flags.iloc[-1])
    assert z.iloc[-1] > 2.0


def test_collapse_flags_with_negative_z() -> None:
    series = pd.Series(STABLE + [0.0, 0.0, 0.0])
    flags, z = zscore_flags(series)
    assert bool(flags.iloc[-1])
    assert z.iloc[-1] < -2.0


def test_short_history_never_flags() -> None:
    # window(10) + recent(3) > 8 observations -> no complete baseline
    series = pd.Series([0.0, 3.0] * 4)
    flags, z = zscore_flags(series)
    assert not flags.any()
    assert z.isna().all()


def test_zero_variance_baseline_never_flags() -> None:
    # Identical baseline values give std = 0; a z-score is undefined there,
    # so even an extreme jump must not flag.
    series = pd.Series([1.0] * 12 + [9.0, 9.0, 9.0])
    flags, z = zscore_flags(series)
    assert not flags.any()


def test_output_aligns_with_input_index() -> None:
    series = pd.Series(STABLE + [5.0, 5.0, 5.0], index=range(100, 115))
    flags, z = zscore_flags(series)
    assert list(flags.index) == list(series.index)
    assert list(z.index) == list(series.index)
