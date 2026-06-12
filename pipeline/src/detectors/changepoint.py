"""Detector B — change-point detection on a composite form index (guide Step 2.3).

Where Detector A asks "is the recent window different?", this detector asks
"did the series split into regimes, and where?" — feeding both ROLE_CHANGE
typing and ``anomalies.change_point_match_id``. The composite collapses a
player's per-90 metrics into one standardized involvement signal so a single
PELT pass can see level shifts across all of them at once.

``xg_buildup_p90`` stands in for the guide's ``progressive_passes_p90``
(an Opta stat FBref dropped in January 2026): xGBuildup measures involvement
in possessions *excluding* the player's own shots and key passes, which is
the closest free analog to progression volume — and unlike xGChain it does
not double-count the xg/key-passes columns already in the composite.
"""

import numpy as np
import ruptures as rpt

MIN_SEGMENT = 4


def composite_index(df_player):
    """Collapse a player's per-90 metrics into one standardized signal.

    Each column is z-scored over the player's own history, then averaged
    row-wise. A metric with zero variance z-scores to NaN everywhere and is
    skipped by the row mean, so it drops out instead of poisoning the signal.

    Args:
        df_player: One player's qualifying matches in match order, with
            xg_p90, shots_p90, key_passes_p90, xg_buildup_p90 columns.

    Returns:
        1-D numpy array, one composite value per match.
    """
    cols = ["xg_p90", "shots_p90", "key_passes_p90", "xg_buildup_p90"]
    z = (df_player[cols] - df_player[cols].mean()) / df_player[cols].std()
    return z.mean(axis=1).to_numpy()


def find_change_points(signal, pen=1.5):
    """Locate regime shifts in a composite signal via PELT (rbf kernel).

    Args:
        signal: 1-D array of composite values in match order.
        pen: PELT penalty; lower finds more (smaller) shifts. Default tuned
            by the 2024-25 backtest (Step 2.7): pen=5 found essentially no
            regimes on real composite signals (std ~0.6), while 1.5 finds
            documented shifts without firing on stationary noise.

    Returns:
        List of change-point indices; each index is the first match of a new
        regime (ruptures reports segment ends, so the series-end sentinel is
        dropped). Empty when the series is too short for two minimum-size
        segments or no shift clears the penalty.
    """
    signal = np.asarray(signal, dtype=float)
    if len(signal) < 2 * MIN_SEGMENT:
        return []
    algo = rpt.Pelt(model="rbf", min_size=MIN_SEGMENT).fit(signal.reshape(-1, 1))
    bkps = algo.predict(pen=pen)
    return bkps[:-1]             # last element is series end, drop it
