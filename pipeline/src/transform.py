"""Transform rules for per-match player stats.

Implements the data-quality and normalization rules from PRD §4.3:
qualifying-minutes filtering, per-90 rate metrics, and opponent
defensive-strength adjustment.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Appearances shorter than this are garbage-time noise (PRD §4.3).
QUALIFYING_MINUTES = 30

# Attacking/volume metrics expressed per-90.
PER90_METRICS = [
    "goals",
    "shots",
    "xg",
    "xa",
    "key_passes",
    "progressive_passes",
    "progressive_carries",
    "touches_att_box",
]


def mark_qualifying(df: pd.DataFrame) -> pd.DataFrame:
    """Flag appearances of at least ``QUALIFYING_MINUTES`` minutes.

    Adds a boolean ``is_qualifying`` column. Sub-30-minute cameos are excluded
    from baseline computation as garbage-time noise (PRD §4.3).
    """
    df = df.copy()
    df["is_qualifying"] = df["minutes"] >= QUALIFYING_MINUTES
    return df


def add_per90(df: pd.DataFrame) -> pd.DataFrame:
    """Add per-90 rate columns for each metric in ``PER90_METRICS``.

    For every metric ``m`` adds ``{m}_p90 = m / minutes * 90``. Rows with zero
    minutes are skipped — minutes are treated as NaN there so the result is NaN
    rather than a division-by-zero error.
    """
    df = df.copy()
    minutes = df["minutes"].replace(0, np.nan)
    for m in PER90_METRICS:
        df[f"{m}_p90"] = df[m] / minutes * 90
    return df


def compute_opponent_strength(schedule_df: pd.DataFrame) -> pd.Series:
    """Compute each team's defensive-strength index from the schedule.

    A team's index is its average xG conceded per match divided by the league
    average xG conceded per match. 1.0 == exactly league-average defense;
    > 1.0 == leakier (weaker) defense, < 1.0 == stronger defense. Each match
    contributes two "conceded" observations: the home team concedes the away
    xG and vice versa.

    Args:
        schedule_df: Schedule frame with ``home_team``, ``away_team``,
            ``home_xg``, and ``away_xg`` columns.

    Returns:
        Series named ``defense_strength`` indexed by team name.
    """
    sched = schedule_df.dropna(subset=["home_xg", "away_xg"])
    conceded = pd.concat(
        [
            pd.DataFrame(
                {"team": sched["home_team"], "xg_conceded": sched["away_xg"]}
            ),
            pd.DataFrame(
                {"team": sched["away_team"], "xg_conceded": sched["home_xg"]}
            ),
        ],
        ignore_index=True,
    )
    team_avg = conceded.groupby("team")["xg_conceded"].mean()
    league_avg = conceded["xg_conceded"].mean()
    return (team_avg / league_avg).rename("defense_strength")


def add_opponent_adjustment(df: pd.DataFrame, strength: pd.Series) -> pd.DataFrame:
    """Scale per-90 xG by opponent defensive strength.

    Maps each row's opponent onto the defense-strength index and adds
    ``opponent_adjusted_xg = xg_p90 / defense_strength``. Teams missing from
    ``strength`` default to 1.0 (no adjustment) and emit a warning. Assumes
    ``add_per90`` has already produced the ``xg_p90`` column and that ``df``
    has an ``opponent`` team column.
    """
    df = df.copy()
    defense = df["opponent"].map(strength)
    missing = df.loc[defense.isna(), "opponent"].dropna().unique()
    if len(missing):
        logger.warning(
            "No defensive-strength index for opponents %s; defaulting to 1.0",
            sorted(missing),
        )
    defense = defense.fillna(1.0)
    df["opponent_adjusted_xg"] = df["xg_p90"] / defense
    return df
