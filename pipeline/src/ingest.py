"""Understat ingestion for the English Premier League.

FBref permanently removed all Opta-provided advanced stats in January 2026,
so the pipeline sources per-match player metrics from Understat instead:
goals, shots, xG, xA, key passes, plus the buildup-involvement metrics
xGChain/xGBuildup. The schedule carries per-match team xG for the opponent
adjustment. soccerdata caches scraped pages to ``~/soccerdata/data`` and
applies polite rate limiting, so repeated runs avoid re-scraping completed
matches.
"""

import soccerdata as sd

LEAGUE = "ENG-Premier League"


def _make_understat(seasons: list[str]) -> sd.Understat:
    """Construct an Understat client, surfacing connection issues clearly.

    soccerdata handles rate limiting internally; we only guard construction
    so any setup/connection failure becomes an explicit RuntimeError rather
    than leaking a library-specific exception to callers.
    """
    try:
        return sd.Understat(leagues=LEAGUE, seasons=seasons)
    except Exception as e:  # noqa: BLE001 - surface any connection failure clearly
        raise RuntimeError(f"Understat unavailable: {e}") from e


def fetch_epl_stats(seasons: list[str]) -> dict:
    """Fetch per-match EPL player stats and the match schedule.

    Args:
        seasons: Season strings, e.g. ["2024-25", "2025-26"].

    Returns:
        dict with:
          "stats":    DataFrame of per-player per-match statistics
                      (minutes, goals, shots, xg, xa, key_passes,
                      xg_chain, xg_buildup, ...).
          "schedule": DataFrame of the season schedule, including per-match
                      team xG (``home_xg``/``away_xg``) and ``is_result``.

    Raises:
        RuntimeError: if Understat cannot be reached.
    """
    understat = _make_understat(seasons)
    stats = understat.read_player_match_stats()
    schedule = understat.read_schedule()
    return {"stats": stats, "schedule": schedule}


if __name__ == "__main__":
    # Manual smoke test: pull a single season and report the stats shape.
    result = fetch_epl_stats(["2024-25"])
    print("stats shape:", result["stats"].shape)
