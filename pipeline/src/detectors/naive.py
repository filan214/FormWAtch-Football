"""Naive rolling z-score detector (guide Step 2.1).

The control detector: a recent-form average compared against a rolling
baseline in plain z-score units. The Bayesian and change-point detectors
must beat this on the backtest (Step 2.7) to justify their complexity, and
the methodology page shows both side by side, so its flags are stored too.
"""

import numpy as np
import pandas as pd


def zscore_flags(
    series_p90: pd.Series,
    window: int = 10,
    recent: int = 3,
    threshold: float = 2.0,
) -> tuple[pd.Series, pd.Series]:
    """Flag positions where recent form deviates from the rolling baseline.

    The baseline is the mean/std of a ``window``-match rolling block shifted
    back by ``recent`` matches, so the matches being judged never contaminate
    the baseline they are judged against. The recent form is the mean of the
    last ``recent`` matches.

    Args:
        series_p90: A per-90 metric series in match order (qualifying
            matches only), e.g. one player's ``goals_p90``.
        window: Baseline width in matches.
        recent: Recent-form width in matches.
        threshold: |z| at or above this is flagged.

    Returns:
        (flags, z): boolean flag Series and the z-score Series, both aligned
        to ``series_p90``. Positions without a full baseline window — or with
        a zero-variance baseline, which a z-score can't judge — have z = NaN
        and are never flagged.
    """
    base = series_p90.rolling(window).agg(["mean", "std"]).shift(recent)
    recent_avg = series_p90.rolling(recent).mean()
    z = (recent_avg - base["mean"]) / base["std"].replace(0, np.nan)
    return z.abs() >= threshold, z
