"""Supabase writer with idempotent, batched upserts.

Uses the service-role key (pipeline-only — never expose to the app). All
multi-row writes are chunked at 500 rows to stay under Supabase request-size
limits, and every write surfaces failures as a RuntimeError tagged with the
target table.
"""

import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

# Max rows per upsert request (Supabase request-size limit).
BATCH_SIZE = 500


def upsert_players(rows: list[dict]) -> int:
    """Upsert player rows on conflict of ``understat_id``; return rows written."""
    written = 0
    try:
        for i in range(0, len(rows), BATCH_SIZE):
            chunk = rows[i : i + BATCH_SIZE]
            sb.table("players").upsert(chunk, on_conflict="understat_id").execute()
            written += len(chunk)
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: players — {e}") from e
    return written


def upsert_matches(rows: list[dict]) -> int:
    """Upsert match rows on conflict of ``understat_id``; return rows written."""
    written = 0
    try:
        for i in range(0, len(rows), BATCH_SIZE):
            chunk = rows[i : i + BATCH_SIZE]
            sb.table("matches").upsert(chunk, on_conflict="understat_id").execute()
            written += len(chunk)
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: matches — {e}") from e
    return written


def upsert_stats(rows: list[dict]) -> int:
    """Upsert per-match stats on conflict of ``player_id,match_id``; return rows written."""
    written = 0
    try:
        for i in range(0, len(rows), BATCH_SIZE):
            chunk = rows[i : i + BATCH_SIZE]
            sb.table("player_match_stats").upsert(
                chunk, on_conflict="player_id,match_id"
            ).execute()
            written += len(chunk)
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: player_match_stats — {e}") from e
    return written


def upsert_baselines(rows: list[dict]) -> int:
    """Upsert baselines on conflict of ``player_id,metric,as_of_date``; return rows written."""
    written = 0
    try:
        for i in range(0, len(rows), BATCH_SIZE):
            chunk = rows[i : i + BATCH_SIZE]
            sb.table("player_baselines").upsert(
                chunk, on_conflict="player_id,metric,as_of_date"
            ).execute()
            written += len(chunk)
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: player_baselines — {e}") from e
    return written


def log_pipeline_run(
    started_at,
    finished_at,
    status: str,
    matchweek: int | None,
    rows_written: int,
    anomalies_created: int,
) -> None:
    """Insert (never upsert) a row recording the outcome of a pipeline run."""
    try:
        sb.table("pipeline_runs").insert(
            {
                "started_at": started_at,
                "finished_at": finished_at,
                "status": status,
                "matchweek": matchweek,
                "rows_written": rows_written,
                "anomalies_created": anomalies_created,
            }
        ).execute()
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: pipeline_runs — {e}") from e


def fetch_all(table: str, cols: str) -> list[dict]:
    """Read a whole table (or projection), paginated past PostgREST's cap."""
    out: list[dict] = []
    offset = 0
    page_size = 1000
    while True:
        page = (
            sb.table(table)
            .select(cols)
            .range(offset, offset + page_size - 1)
            .execute()
            .data
        )
        out += page
        if len(page) < page_size:
            return out
        offset += page_size


def fetch_active_anomalies() -> list[dict]:
    """All anomaly rows still marked active, with their evidence."""
    out: list[dict] = []
    offset = 0
    page_size = 1000
    while True:
        page = (
            sb.table("anomalies")
            .select(
                "id,player_id,anomaly_type,severity,evidence,"
                "detectors_fired,fdr_adjusted_p,matchweek,detected_at"
            )
            .eq("status", "active")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
        )
        out += page
        if len(page) < page_size:
            return out
        offset += page_size


def insert_anomalies(rows: list[dict]) -> int:
    """Insert new anomaly rows; return how many were written."""
    written = 0
    try:
        for i in range(0, len(rows), BATCH_SIZE):
            chunk = rows[i : i + BATCH_SIZE]
            sb.table("anomalies").insert(chunk).execute()
            written += len(chunk)
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: anomalies — {e}") from e
    return written


def update_anomaly(anomaly_id: int, fields: dict) -> None:
    """Update one anomaly row in place (persisting anomalies refresh weekly)."""
    try:
        sb.table("anomalies").update(fields).eq("id", anomaly_id).execute()
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: anomalies — {e}") from e


def resolve_anomalies(ids: list[int]) -> None:
    """Mark anomalies that are no longer detected as resolved."""
    if not ids:
        return
    try:
        sb.table("anomalies").update({"status": "resolved"}).in_("id", ids).execute()
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: anomalies — {e}") from e


def fetch_insight_hashes() -> dict[int, str]:
    """anomaly_id -> evidence_hash for every stored insight."""
    rows = fetch_all("ai_insights", "anomaly_id,evidence_hash")
    return {r["anomaly_id"]: r["evidence_hash"] for r in rows}


def upsert_insight(row: dict) -> None:
    """Insert or refresh the cached insight for one anomaly."""
    try:
        sb.table("ai_insights").upsert(row, on_conflict="anomaly_id").execute()
    except Exception as e:  # noqa: BLE001 - re-raise with table context
        raise RuntimeError(f"DB write failed: ai_insights — {e}") from e


def get_last_pipeline_run() -> dict | None:
    """
    Returns the most recent pipeline_run row as a dict, or None if the
    table is empty. Used by the Next.js app's status footer.
    Fields returned: started_at, finished_at, status, matchweek,
    rows_written, anomalies_created.
    """
    result = (
        sb.table("pipeline_runs")
        .select("started_at,finished_at,status,matchweek,rows_written,anomalies_created")
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None
