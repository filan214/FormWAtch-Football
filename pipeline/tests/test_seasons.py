"""Boundary tests for the pure season-math functions (PRD §9.1).

Only current_season() and previous_season() are exercised — no Supabase
or FBref access, so these run anywhere without credentials.
"""

from datetime import date

import pytest

from src.seasons import current_season, previous_season


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 7, 31), "2025-26"),  # last day before new season
        (date(2026, 8, 1), "2026-27"),   # first day of new season
        (date(2026, 1, 1), "2025-26"),   # mid-season, new calendar year
        (date(2026, 5, 31), "2025-26"),  # end of season
        (date(2026, 12, 1), "2026-27"),  # mid-season, same calendar year
    ],
)
def test_current_season_boundaries(today: date, expected: str) -> None:
    assert current_season(today) == expected


@pytest.mark.parametrize(
    ("season", "expected"),
    [
        ("2026-27", "2025-26"),
        ("2025-26", "2024-25"),
        ("2000-01", "1999-00"),  # century rollover formats correctly
    ],
)
def test_previous_season(season: str, expected: str) -> None:
    assert previous_season(season) == expected


def test_round_trip() -> None:
    # previous_season inverts the season the year-boundary math produces
    assert previous_season(current_season(date(2026, 8, 1))) == "2025-26"
