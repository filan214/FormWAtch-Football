"""Tests for the season-catalog guards in ingest (PRD §9.1).

soccerdata caches Understat's season catalog (``leagues.json``) forever, so
a cache restored from a previous season hides the new one and the run
silently re-ingests old data. These tests cover the cache refresh and the
loud failure when a requested season is still missing — no network access.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from src.ingest import check_seasons_available, refresh_season_index


def test_refresh_drops_cached_catalog_only(tmp_path) -> None:
    (tmp_path / "leagues.json").write_text("{}")
    (tmp_path / "league_1_season_2025.json").write_text("{}")

    refresh_season_index(SimpleNamespace(data_dir=tmp_path))

    assert not (tmp_path / "leagues.json").exists()
    # completed-season pages stay cached — only the catalog must refresh
    assert (tmp_path / "league_1_season_2025.json").exists()


def test_refresh_tolerates_empty_cache(tmp_path) -> None:
    refresh_season_index(SimpleNamespace(data_dir=tmp_path))  # no raise


def test_all_requested_seasons_available() -> None:
    check_seasons_available(
        ["2025-26", "2026-27"], ["2025-26", "2026-27"], today=date(2026, 10, 20)
    )


def test_missing_current_season_after_kickoff_window_fails() -> None:
    # The Oct 2026 incident: catalog listed only 2025-26, run "succeeded"
    with pytest.raises(RuntimeError, match="2026-27"):
        check_seasons_available(
            ["2025-26", "2026-27"], ["2024-25", "2025-26"], today=date(2026, 10, 20)
        )


def test_missing_current_season_in_august_is_tolerated() -> None:
    # Understat lists a season only once its first matches exist
    check_seasons_available(
        ["2025-26", "2026-27"], ["2024-25", "2025-26"], today=date(2026, 8, 10)
    )


def test_missing_previous_season_always_fails() -> None:
    with pytest.raises(RuntimeError, match="2025-26"):
        check_seasons_available(
            ["2025-26", "2026-27"], ["2026-27"], today=date(2026, 8, 10)
        )
