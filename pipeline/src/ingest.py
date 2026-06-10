"""FBref ingestion for the English Premier League.

Pulls per-match player statistics and the match schedule via the
``soccerdata`` FBref integration. soccerdata caches scraped pages to
``~/soccerdata/data`` and applies its own polite rate limiting
(~1 request / 3s, per PRD §4.2), so repeated runs avoid re-scraping.
"""

import soccerdata as sd
import pandas as pd

LEAGUE = "ENG-Premier League"

# Stat tables pulled from FBref and joined into a single per-match frame.
STAT_TYPES = ("summary", "passing", "possession")


def _make_fbref(seasons: list[str]) -> sd.FBref:
    """Construct an FBref client, surfacing connection issues clearly.

    soccerdata handles rate limiting internally; we only guard construction
    so any setup/connection failure becomes an explicit RuntimeError rather
    than leaking a library-specific exception to callers.
    """
    try:
        return sd.FBref(leagues=LEAGUE, seasons=seasons)
    except Exception as e:  # noqa: BLE001 - surface any connection failure clearly
        raise RuntimeError(f"FBref unavailable: {e}") from e


def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten FBref's MultiIndex columns into single underscore-joined names."""
    df = df.copy()
    df.columns = [
        "_".join(str(c) for c in col).strip("_") for col in df.columns
    ]
    return df


def _join_stat_tables(
    summary: pd.DataFrame, passing: pd.DataFrame, possession: pd.DataFrame
) -> pd.DataFrame:
    """Join the three stat tables on their shared (match, player) index.

    All three tables share FBref's row index (league/season/game/team/player),
    which uniquely identifies a player within a match. Only columns new to each
    subsequent table are kept, so shared fields (e.g. minutes) are not duplicated.
    """
    stats = summary
    for other in (passing, possession):
        new_cols = [c for c in other.columns if c not in stats.columns]
        stats = stats.join(other[new_cols])
    return stats


def fetch_epl_stats(seasons: list[str]) -> dict:
    """Fetch joined per-match EPL player stats and the match schedule.

    Pulls the summary, passing, and possession stat tables for the given
    seasons, flattens FBref's MultiIndex columns, and joins them on the shared
    (match, player) index.

    Args:
        seasons: Season strings, e.g. ["2024-25", "2025-26"].

    Returns:
        dict with:
          "stats":    DataFrame of joined per-match player statistics.
          "schedule": DataFrame of the season schedule (fbref.read_schedule()).

    Raises:
        RuntimeError: if FBref cannot be reached.
    """
    fbref = _make_fbref(seasons)

    frames = {}
    for stat_type in STAT_TYPES:
        df = fbref.read_player_match_stats(stat_type=stat_type)
        frames[stat_type] = _flatten_columns(df)

    stats = _join_stat_tables(
        frames["summary"], frames["passing"], frames["possession"]
    )
    schedule = fbref.read_schedule()

    return {"stats": stats, "schedule": schedule}


if __name__ == "__main__":
    # Manual smoke test: pull a single season and report the stats shape.
    result = fetch_epl_stats(["2024-25"])
    print("stats shape:", result["stats"].shape)
