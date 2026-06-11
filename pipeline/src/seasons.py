"""Seasonal continuity (PRD §9).

Three pieces keep the pipeline running across seasons unattended:
dynamic season detection (never hardcode a season string), baseline
carry-forward (last season's posterior becomes this season's prior),
and the pre-season squad refresh (sync ``players.team`` from FBref).

The pure date functions here are unit-tested; the DB- and FBref-touching
functions import their dependencies lazily so this module stays importable
without Supabase credentials or a network connection.
"""

from datetime import date

LEAGUE = "ENG-Premier League"

# Weakly informative Gamma prior for players with no EPL history —
# wide and uncertain, so the system withholds judgment until enough
# matches accumulate (PRD §9.2).
DEFAULT_PRIOR_ALPHA = 1.0
DEFAULT_PRIOR_BETA = 1.0


def current_season(today: date | None = None) -> str:
    """Return the active EPL season for ``today`` (default: actual today).

    The EPL season spans August–May across two calendar years: any date from
    August onward belongs to the season starting that year; January–July
    belongs to the season that started the previous year.

    Examples: date(2026, 8, 1) -> "2026-27"; date(2026, 1, 1) -> "2025-26".
    """
    today = today or date.today()
    if today.month >= 8:
        return f"{today.year}-{(today.year + 1) % 100:02d}"
    return f"{today.year - 1}-{today.year % 100:02d}"


def previous_season(season: str) -> str:
    """Return the season immediately before ``season``.

    Example: "2026-27" -> "2025-26".
    """
    start = int(season.split("-")[0])
    return f"{start - 1}-{start % 100:02d}"


def seasons_to_fetch() -> list[str]:
    """Return the seasons the weekly run should ingest.

    Current season plus the immediately previous one for baseline depth
    (PRD §9.1). Rolls into a new season automatically every August.
    """
    cur = current_season()
    return [previous_season(cur), cur]


def seed_new_season_priors(player_ids: list[int], metrics: list[str]) -> int:
    """Seed new-season baseline priors via carry-forward (PRD §9.2).

    For each (player_id, metric) pair, the most recent ``player_baselines``
    row supplies the Gamma posterior (``gamma_alpha``, ``gamma_beta``) to use
    as the opening prior; players with no history get the weakly informative
    default. Each pair is upserted with ``as_of_date`` = today and
    ``matches_count`` = 0 (no matches played in the new season yet).

    Returns the number of baseline rows upserted.
    """
    # Lazy import: db creates its Supabase client at import time, which
    # requires SUPABASE_* env vars this module must not depend on.
    from .db import sb, upsert_baselines

    as_of = date.today().isoformat()
    rows = []
    for player_id in player_ids:
        for metric in metrics:
            prev = (
                sb.table("player_baselines")
                .select("gamma_alpha,gamma_beta")
                .eq("player_id", player_id)
                .eq("metric", metric)
                .order("as_of_date", desc=True)
                .limit(1)
                .execute()
                .data
            )
            if prev:  # carry forward the veteran's learned rate
                alpha0, beta0 = prev[0]["gamma_alpha"], prev[0]["gamma_beta"]
            else:  # new-to-EPL player -> weakly informative prior
                alpha0, beta0 = DEFAULT_PRIOR_ALPHA, DEFAULT_PRIOR_BETA
            rows.append(
                {
                    "player_id": player_id,
                    "metric": metric,
                    "as_of_date": as_of,
                    "gamma_alpha": alpha0,
                    "gamma_beta": beta0,
                    "matches_count": 0,
                }
            )
    return upsert_baselines(rows)


def refresh_squads() -> int:
    """Sync current EPL rosters from FBref into ``players.team`` (PRD §9.3).

    Run pre-season (late July) so team labels and opponent-adjustment context
    don't go stale. January transfers need no special handling — the weekly
    upsert corrects ``players.team`` when a new match row arrives.

    Returns the number of player rows upserted.
    """
    # Lazy imports: keep this module importable without env vars or the
    # heavyweight scraping stack (see module docstring).
    import pandas as pd
    import soccerdata as sd

    from .db import BATCH_SIZE, sb

    season = current_season()
    try:
        fbref = sd.FBref(leagues=LEAGUE, seasons=[season])
    except Exception as e:  # noqa: BLE001 - surface any connection failure clearly
        raise RuntimeError(f"FBref unavailable: {e}") from e

    df = fbref.read_player_season_stats(stat_type="standard").reset_index()
    df.columns = [
        "_".join(str(c) for c in col).strip("_") if isinstance(col, tuple) else str(col)
        for col in df.columns
    ]

    cols = {str(c).lower(): c for c in df.columns}
    id_col = next((cols[c] for c in ("player_id", "id") if c in cols), None)
    name_col = cols.get("player")
    team_col = cols.get("team")
    if id_col is None or name_col is None or team_col is None:
        raise RuntimeError(
            "Could not locate player id/name/team columns in FBref roster "
            f"data; available columns: {sorted(cols)}"
        )

    roster = df[df[id_col].notna() & df[name_col].notna()]
    # A player who moved clubs appears once per team; keep the last row.
    roster = roster.drop_duplicates(subset=[id_col], keep="last")
    rows = [
        {
            "fbref_id": str(r[id_col]),
            "name": str(r[name_col]),
            "team": None if pd.isna(r[team_col]) else str(r[team_col]),
        }
        for _, r in roster.iterrows()
    ]

    for i in range(0, len(rows), BATCH_SIZE):
        try:
            sb.table("players").upsert(
                rows[i : i + BATCH_SIZE], on_conflict="fbref_id"
            ).execute()
        except Exception as e:  # noqa: BLE001 - re-raise with table context
            raise RuntimeError(f"DB write failed: players — {e}") from e
    return len(rows)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-squads", action="store_true")
    args = parser.parse_args()
    if args.refresh_squads:
        n = refresh_squads()
        print(f"Squad refresh complete. {n} players updated.")
