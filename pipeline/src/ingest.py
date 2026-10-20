"""Understat ingestion for the English Premier League.

FBref permanently removed all Opta-provided advanced stats in January 2026,
so the pipeline sources per-match player metrics from Understat instead:
goals, shots, xG, xA, key passes, plus the buildup-involvement metrics
xGChain/xGBuildup. The schedule carries per-match team xG for the opponent
adjustment. soccerdata caches scraped pages to ``~/soccerdata/data`` and
applies polite rate limiting, so repeated runs avoid re-scraping completed
matches.

One cache entry must never be trusted: soccerdata reads its season catalog
(``leagues.json``) from cache indefinitely, so a cache restored from last
season hides the new one and the run silently re-ingests old data. The
catalog is dropped before every fetch, and a requested season that is
still missing fails the run loudly.
"""

import logging
from datetime import date

import soccerdata as sd

from .seasons import current_season

logger = logging.getLogger(__name__)

LEAGUE = "ENG-Premier League"

# Understat lists a season only once its first matches exist, so the new
# season may legitimately be absent until kickoff in August.
KICKOFF_GRACE_MONTH = 8


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


def refresh_season_index(understat: sd.Understat) -> None:
    """Delete the cached season catalog so the next read re-fetches it.

    Completed-season and match pages stay cached; only the catalog that
    decides which seasons exist is forced fresh.
    """
    (understat.data_dir / "leagues.json").unlink(missing_ok=True)


def _season_label(code: str) -> str:
    """Normalize soccerdata's season code ('2627') to PRD form ('2026-27')."""
    return f"20{code[:2]}-{code[2:]}"


def check_seasons_available(
    requested: list[str], available: list[str], today: date | None = None
) -> None:
    """Fail loudly if any requested season is missing from Understat.

    The current season is tolerated as missing during August only, before
    its first matches are listed.

    Raises:
        RuntimeError: if a requested season is unavailable outside that window.
    """
    today = today or date.today()
    missing = [s for s in requested if s not in available]
    if not missing:
        return
    if today.month == KICKOFF_GRACE_MONTH and missing == [current_season(today)]:
        logger.warning("Season %s not listed on Understat yet (pre-kickoff)", missing[0])
        return
    raise RuntimeError(
        f"Understat does not list season(s) {missing}; "
        f"available: {sorted(available)}"
    )


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
        RuntimeError: if Understat cannot be reached, or a requested season
            is not listed (see ``check_seasons_available``).
    """
    understat = _make_understat(seasons)
    refresh_season_index(understat)
    listed = understat.read_seasons().index.get_level_values("season")
    check_seasons_available(seasons, [_season_label(s) for s in listed])
    stats = understat.read_player_match_stats()
    schedule = understat.read_schedule()
    return {"stats": stats, "schedule": schedule}


if __name__ == "__main__":
    # Manual smoke test: pull a single season and report the stats shape.
    result = fetch_epl_stats(["2024-25"])
    print("stats shape:", result["stats"].shape)
