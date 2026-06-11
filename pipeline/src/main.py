"""Weekly pipeline orchestrator (Phase 1).

Ingest FBref stats for the current + previous season, apply transform
rules, upsert players/matches/stats into Supabase, seed any missing
current-season baseline priors, and record the run in ``pipeline_runs``.

Detection is Phase 2 — anomalies are always 0 here. Scraped column names
come from FBref via soccerdata and may drift between library versions, so
all column lookups go through candidate lists that fail loudly with the
list of available columns rather than silently writing wrong data.
"""

import logging
import re
from datetime import date, datetime, timezone

import pandas as pd
from dotenv import load_dotenv

from . import db
from .ingest import fetch_epl_stats
from .seasons import current_season, seasons_to_fetch, seed_new_season_priors
from .transform import (
    PER90_METRICS,
    add_opponent_adjustment,
    add_per90,
    compute_opponent_strength,
    mark_qualifying,
)

logger = logging.getLogger(__name__)

# Candidate flattened column names per canonical field, ordered by
# preference. Lookups are case-insensitive with whitespace -> underscore.
PLAYER_ID_CANDIDATES = ["player_id", "id"]

STATS_COLUMNS = {
    "game": ["game"],
    "team": ["team"],
    "player": ["player"],
    "minutes": ["min", "minutes"],
    "goals": ["performance_gls", "gls", "goals"],
    "assists": ["performance_ast", "ast", "assists"],
    "shots": ["performance_sh", "sh", "shots"],
    "xg": ["expected_xg", "xg"],
    "xa": ["expected_xag", "expected_xa", "xag", "xa"],
    "key_passes": ["passes_kp", "kp", "key_passes"],
    "progressive_passes": ["passes_prgp", "performance_prgp", "prgp", "progressive_passes"],
    "progressive_carries": ["carries_prgc", "prgc", "progressive_carries"],
    "touches_att_box": ["touches_att_pen", "att_pen", "touches_att_box"],
}

SCHEDULE_COLUMNS = {
    "game": ["game"],
    "season": ["season"],
    "date": ["date"],
    "home_team": ["home_team"],
    "away_team": ["away_team"],
    "home_xg": ["home_xg"],
    "away_xg": ["away_xg"],
}

PAGE_SIZE = 1000  # PostgREST caps response rows; paginate reads


def _norm(name: str) -> str:
    return re.sub(r"\s+", "_", str(name).strip().lower())


def _resolve_column(df: pd.DataFrame, candidates: list[str], what: str) -> str:
    """Return the actual column matching one of ``candidates``, or fail loudly."""
    normalized = {_norm(c): c for c in df.columns}
    for cand in candidates:
        if cand in normalized:
            return normalized[cand]
    raise RuntimeError(
        f"Could not resolve column for '{what}'; "
        f"available columns: {sorted(normalized)}"
    )


def _resolve_optional(df: pd.DataFrame, candidates: list[str]) -> str | None:
    try:
        return _resolve_column(df, candidates, candidates[0])
    except RuntimeError:
        return None


def _rename_canonical(df: pd.DataFrame, columns: dict[str, list[str]]) -> pd.DataFrame:
    """Rename resolved source columns to their canonical names.

    Pre-existing columns that already carry a canonical name but were not
    the resolved source are dropped, so the rename can't create duplicates.
    """
    rename = {
        _resolve_column(df, cands, canon): canon for canon, cands in columns.items()
    }
    clobbered = [c for s, c in rename.items() if c in df.columns and s != c]
    return df.drop(columns=clobbered).rename(columns=rename)


def _flatten_reset(df: pd.DataFrame) -> pd.DataFrame:
    """reset_index and flatten any tuple column names left over."""
    df = df.reset_index()
    df.columns = [
        "_".join(str(c) for c in col).strip("_") if isinstance(col, tuple) else str(col)
        for col in df.columns
    ]
    return df


def _season_label(value) -> str:
    """Normalize soccerdata's season id ('2425') to PRD form ('2024-25')."""
    s = str(value)
    if len(s) == 4 and s.isdigit():
        return f"20{s[:2]}-{s[2:]}"
    return s


# --- value cleaning: scraped frames hold numpy/NaN values; Supabase needs JSON ---

def _int_or_zero(v) -> int:
    return 0 if pd.isna(v) else int(float(v))


def _float_or_zero(v) -> float:
    return 0.0 if pd.isna(v) else float(v)


def _int_or_none(v) -> int | None:
    return None if pd.isna(v) else int(float(v))


def _float_or_none(v) -> float | None:
    return None if pd.isna(v) else float(v)


def _str_or_none(v) -> str | None:
    return None if pd.isna(v) else str(v)


def _date_iso(v) -> str:
    if isinstance(v, str):
        return v[:10]
    return pd.Timestamp(v).date().isoformat()


def _normalize_schedule(schedule: pd.DataFrame) -> pd.DataFrame:
    """Canonicalize the schedule frame and assign each match an fbref_id."""
    sched = _rename_canonical(_flatten_reset(schedule), SCHEDULE_COLUMNS)

    week_col = _resolve_optional(sched, ["week", "wk", "matchweek"])
    if week_col and week_col != "week":
        sched = sched.rename(columns={week_col: "week"})
    elif week_col is None:
        sched["week"] = pd.NA

    # Prefer FBref's match id; the game index string (date + teams) is a
    # stable unique fallback.
    gid_col = _resolve_optional(sched, ["game_id"])
    if gid_col:
        ids = sched[gid_col].where(sched[gid_col].notna(), sched["game"])
    else:
        ids = sched["game"]
    sched["match_fbref_id"] = ids.astype(str)
    return sched


def _normalize_stats(stats: pd.DataFrame, sched: pd.DataFrame) -> pd.DataFrame:
    """Canonicalize stats columns and attach match context (date, opponent)."""
    df = _rename_canonical(_flatten_reset(stats), STATS_COLUMNS)

    match_cols = sched[["game", "match_fbref_id", "date", "home_team", "away_team"]]
    df = df.merge(match_cols, on="game", how="left", suffixes=("", "_sched"))

    is_home = df["team"] == df["home_team"]
    is_away = df["team"] == df["away_team"]
    unmatched = int((~(is_home | is_away)).sum())
    if unmatched:
        logger.warning(
            "%d stat rows have a team not matching schedule home/away; "
            "their opponent is unknown (adjustment defaults to 1.0)",
            unmatched,
        )
    df["opponent"] = df["away_team"].where(is_home, df["home_team"].where(is_away))
    return df


def _build_player_rows(df: pd.DataFrame) -> list[dict]:
    """One row per player; the latest appearance supplies the current team."""
    pid_col = _resolve_column(df, PLAYER_ID_CANDIDATES, "player fbref id")
    pos_col = _resolve_optional(df, ["pos", "position"])

    latest = (
        df[df[pid_col].notna() & df["player"].notna()]
        .sort_values("date", na_position="first")
        .drop_duplicates(subset=[pid_col], keep="last")
    )
    rows = []
    for _, r in latest.iterrows():
        row = {
            "fbref_id": str(r[pid_col]),
            "name": str(r["player"]),
            "team": _str_or_none(r["team"]),
        }
        if pos_col:
            row["position"] = _str_or_none(r[pos_col])
        rows.append(row)
    return rows


def _build_match_rows(sched: pd.DataFrame) -> list[dict]:
    """Match rows for upsert; future fixtures are included (xG stays null)."""
    rows: dict[str, dict] = {}
    for _, r in sched.iterrows():
        if pd.isna(r["date"]) or pd.isna(r["home_team"]) or pd.isna(r["away_team"]):
            continue
        fbref_id = str(r["match_fbref_id"])
        rows[fbref_id] = {
            "fbref_id": fbref_id,
            "season": _season_label(r["season"]),
            "matchweek": _int_or_none(r["week"]),
            "date": _date_iso(r["date"]),
            "home_team": str(r["home_team"]),
            "away_team": str(r["away_team"]),
            "home_xg": _float_or_none(r["home_xg"]),
            "away_xg": _float_or_none(r["away_xg"]),
        }
    return list(rows.values())


def _build_stat_rows(
    df: pd.DataFrame, players_map: dict[str, int], matches_map: dict[str, int]
) -> list[dict]:
    """Per-match stat rows keyed by DB foreign keys, deduped on (player, match)."""
    pid_col = _resolve_column(df, PLAYER_ID_CANDIDATES, "player fbref id")
    rows: dict[tuple[int, int], dict] = {}
    skipped = 0
    for _, r in df.iterrows():
        player_id = players_map.get(str(r[pid_col]))
        match_id = matches_map.get(str(r["match_fbref_id"]))
        if player_id is None or match_id is None or pd.isna(r["minutes"]):
            skipped += 1
            continue
        rows[(player_id, match_id)] = {
            "player_id": player_id,
            "match_id": match_id,
            "minutes": _int_or_zero(r["minutes"]),
            "goals": _int_or_zero(r["goals"]),
            "assists": _int_or_zero(r["assists"]),
            "shots": _int_or_zero(r["shots"]),
            "xg": _float_or_zero(r["xg"]),
            "xa": _float_or_zero(r["xa"]),
            "key_passes": _int_or_zero(r["key_passes"]),
            "progressive_passes": _int_or_zero(r["progressive_passes"]),
            "progressive_carries": _int_or_zero(r["progressive_carries"]),
            "touches_att_box": _int_or_zero(r["touches_att_box"]),
            "opponent_adjusted_xg": _float_or_none(r["opponent_adjusted_xg"]),
            "is_qualifying": bool(r["is_qualifying"]),
        }
    if skipped:
        logger.warning(
            "Skipped %d stat rows lacking a player/match mapping or minutes", skipped
        )
    return list(rows.values())


def _fetch_id_map(table: str) -> dict[str, int]:
    """Read back fbref_id -> db id for FK mapping, paginated."""
    out: dict[str, int] = {}
    offset = 0
    while True:
        page = (
            db.sb.table(table)
            .select("id,fbref_id")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
            .data
        )
        out.update({r["fbref_id"]: r["id"] for r in page})
        if len(page) < PAGE_SIZE:
            return out
        offset += PAGE_SIZE


def _seed_missing_baselines(player_db_ids: list[int], season: str) -> int:
    """Seed priors for (player, metric) pairs with no current-season baseline."""
    season_start = date(int(season[:4]), 8, 1).isoformat()
    have: set[tuple[int, str]] = set()
    offset = 0
    while True:
        page = (
            db.sb.table("player_baselines")
            .select("player_id,metric")
            .gte("as_of_date", season_start)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
            .data
        )
        have.update((r["player_id"], r["metric"]) for r in page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    # Group players by their exact missing-metric set so each group seeds
    # only what it lacks — re-seeding a pair that already has a baseline
    # this season would add a spurious extra row.
    groups: dict[tuple[str, ...], list[int]] = {}
    for pid in player_db_ids:
        missing = tuple(m for m in PER90_METRICS if (pid, m) not in have)
        if missing:
            groups.setdefault(missing, []).append(pid)

    seeded = 0
    for metrics, pids in groups.items():
        seeded += seed_new_season_priors(pids, list(metrics))
    return seeded


def _latest_matchweek(sched: pd.DataFrame, season: str) -> int | None:
    """Highest week with a played match (xG present) in the given season."""
    cur = sched[sched["season"].map(_season_label) == season]
    played = cur[cur["home_xg"].notna()]
    weeks = played["week"].dropna()
    if weeks.empty:
        return None
    return int(float(weeks.max()))


def main() -> None:
    load_dotenv()
    started = datetime.now(timezone.utc).isoformat()
    rows_written = 0
    matchweek = None
    try:
        seasons = seasons_to_fetch()
        logger.info("Ingesting seasons %s", seasons)
        data = fetch_epl_stats(seasons)

        sched = _normalize_schedule(data["schedule"])
        stats = _normalize_stats(data["stats"], sched)
        stats = mark_qualifying(stats)
        stats = add_per90(stats)
        strength = compute_opponent_strength(sched)
        stats = add_opponent_adjustment(stats, strength)

        player_rows = _build_player_rows(stats)
        rows_written += db.upsert_players(player_rows)
        rows_written += db.upsert_matches(_build_match_rows(sched))

        players_map = _fetch_id_map("players")
        matches_map = _fetch_id_map("matches")
        rows_written += db.upsert_stats(
            _build_stat_rows(stats, players_map, matches_map)
        )

        season = current_season()
        player_db_ids = [
            players_map[r["fbref_id"]]
            for r in player_rows
            if r["fbref_id"] in players_map
        ]
        rows_written += _seed_missing_baselines(player_db_ids, season)

        matchweek = _latest_matchweek(sched, season)
        finished = datetime.now(timezone.utc).isoformat()
        db.log_pipeline_run(started, finished, "success", matchweek, rows_written, 0)
        print(
            f"Pipeline complete. Rows written: {rows_written}. "
            "Anomalies: 0 (detection not yet implemented)."
        )
    except Exception:
        finished = datetime.now(timezone.utc).isoformat()
        try:
            db.log_pipeline_run(started, finished, "failed", matchweek, rows_written, 0)
        except Exception:  # noqa: BLE001 - the failure log must not mask the cause
            logger.exception("Could not log failed run to pipeline_runs")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
