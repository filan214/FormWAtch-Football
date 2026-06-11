"""Detector C — multivariate profile shift + league outliers (guide Step 2.4).

Two complementary views of a player's statistical profile as a vector of
per-90 metrics:

* ``mahalanobis_profile`` measures how far the recent profile mean has moved
  from the player's own history, in units that respect the metrics'
  correlations (Ledoit-Wolf shrinkage keeps the covariance invertible even
  for short histories). The returned diff vector says *which* metrics moved
  and in what direction — that shape drives anomaly typing in Step 2.5
  (e.g. ROLE_CHANGE: volume up, shooting flat).
* ``league_isoforest`` fits an IsolationForest over every (player, match)
  vector in the league, catching single-match profiles that are odd for the
  league as a whole rather than for one player.

Feature note: the guide's ``touches_att_box_p90``/``progressive_passes_p90``
died with FBref's Opta cutoff (January 2026); ``xg_chain_p90`` (attacking
involvement) and ``xg_buildup_p90`` (deep buildup involvement) stand in.
Their correlation with the other features is fine here — unlike a naive
composite, Mahalanobis distance models correlations explicitly.
"""

import numpy as np
from sklearn.covariance import LedoitWolf
from sklearn.ensemble import IsolationForest

FEATURES = ["xg_p90", "shots_p90", "xg_chain_p90",
            "xg_buildup_p90", "key_passes_p90", "goals_p90"]


def mahalanobis_profile(history, recent):
    """Distance between recent and historical profile means.

    Args:
        history: Matches × FEATURES matrix (ndarray or DataFrame) of the
            player's baseline qualifying matches.
        recent: Same layout for the recent window.

    Returns:
        (d, diff): the Mahalanobis distance of the mean shift under the
        history's shrunk covariance, and the raw mean-difference vector
        (recent − history) whose shape drives typing.
    """
    lw = LedoitWolf().fit(history)
    diff = recent.mean(axis=0) - history.mean(axis=0)
    vi = np.linalg.inv(lw.covariance_)
    d = float(np.sqrt(diff @ vi @ diff))
    return d, diff   # diff vector = direction → drives typing


def league_isoforest(all_match_vectors):
    """Fit the league-wide per-match outlier model.

    Args:
        all_match_vectors: Every qualifying (player, match) FEATURES vector
            in the league, one row per match appearance.

    Returns:
        Fitted IsolationForest (contamination 2%, deterministic seed);
        ``predict`` marks outliers as -1, ``score_samples`` ranks them.
    """
    return IsolationForest(contamination=0.02, random_state=42).fit(all_match_vectors)
