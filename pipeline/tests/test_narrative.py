"""Tests for the narrative layer — no network, no credentials."""

import json

import pytest

from src import narrative
from src.narrative import (
    build_prompt,
    evidence_hash,
    generate_insight,
    validate_insight,
)

PLAYER = {"id": 7, "name": "Test Striker", "team": "Arsenal", "position": "F"}

ANOMALY = {
    "id": 1,
    "anomaly_type": "BREAKOUT",
    "severity": 78,
    "fdr_adjusted_p": 0.01,
    "detectors_fired": ["bayesian:goals", "bayesian:xg"],
    "evidence": {
        "as_of": "2026-05-24",
        "family": "UP",
        "persistence_weeks": 2,
        "primary_metric": "goals",
        "metrics": {
            "goals": {
                "baseline_rate": 0.4, "recent_rate": 1.1,
                "baseline_ci": [0.3, 0.5], "recent_ci": [0.7, 1.6],
                "kl": 3.2, "p_value": 0.001, "direction": "up", "flagged": True,
            },
        },
    },
}

MATCH_LINES = [
    {"date": "2026-05-24", "opponent": "Chelsea", "minutes": 90,
     "goals": 2, "shots": 5, "xg": 1.4},
]

VALID_PAYLOAD = {
    "headline": "Test Striker's surge is real, not luck",
    "summary": "He is scoring far more than usual and the chances back it up.",
    "technicalExplanation": "Recent rate 1.1/90 sits above the baseline CI of 0.3-0.5.",
    "anomalyType": "BREAKOUT",
    "confidence": "high",
    "keyEvidence": [
        {"metric": "goals", "baseline": 0.4, "recent": 1.1, "unit": "per 90"},
    ],
    "outlook": "Watch whether the xG holds up against stronger opponents.",
    "fantasyImplication": "Strong buy while the underlying numbers hold.",
}


# --- evidence_hash -----------------------------------------------------------

def test_hash_is_deterministic_and_order_insensitive() -> None:
    a = {"x": 1, "y": [1.5, 2.5]}
    b = {"y": [1.5, 2.5], "x": 1}
    assert evidence_hash(a) == evidence_hash(b)
    assert len(evidence_hash(a)) == 16


def test_hash_changes_with_evidence() -> None:
    assert evidence_hash({"x": 1}) != evidence_hash({"x": 2})


# --- validate_insight --------------------------------------------------------

def test_valid_payload_passes() -> None:
    validate_insight(VALID_PAYLOAD, "BREAKOUT")


def test_missing_field_rejected() -> None:
    bad = {k: v for k, v in VALID_PAYLOAD.items() if k != "outlook"}
    with pytest.raises(Exception):
        validate_insight(bad, "BREAKOUT")


def test_bad_confidence_rejected() -> None:
    with pytest.raises(Exception):
        validate_insight({**VALID_PAYLOAD, "confidence": "certain"}, "BREAKOUT")


def test_long_headline_rejected() -> None:
    bad = {**VALID_PAYLOAD, "headline": "one two three four five six seven eight nine ten eleven twelve thirteen"}
    with pytest.raises(ValueError):
        validate_insight(bad, "BREAKOUT")


def test_type_mismatch_rejected() -> None:
    with pytest.raises(ValueError):
        validate_insight(VALID_PAYLOAD, "FORM_COLLAPSE")


def test_quoted_numbers_are_coerced() -> None:
    quoted = json.loads(json.dumps(VALID_PAYLOAD))
    quoted["keyEvidence"][0]["baseline"] = "0.4"
    quoted["keyEvidence"][0]["recent"] = "1.1"
    validate_insight(quoted, "BREAKOUT")
    assert quoted["keyEvidence"][0]["baseline"] == 0.4


def test_fantasy_field_only_for_relevant_types() -> None:
    role = {**VALID_PAYLOAD, "anomalyType": "ROLE_CHANGE"}
    with pytest.raises(ValueError):
        validate_insight(role, "ROLE_CHANGE")
    del role["fantasyImplication"]
    validate_insight(role, "ROLE_CHANGE")


# --- build_prompt ------------------------------------------------------------

def test_prompt_contains_the_essentials() -> None:
    p = build_prompt(PLAYER, ANOMALY, MATCH_LINES)
    assert "Test Striker" in p
    assert "BREAKOUT" in p
    assert "78" in p
    assert "0.40/90" in p and "1.10/90" in p
    assert "vs Chelsea" in p
    assert "Include a fantasyImplication" in p


def test_prompt_forbids_fantasy_for_role_change() -> None:
    anomaly = {**ANOMALY, "anomaly_type": "ROLE_CHANGE"}
    p = build_prompt(PLAYER, anomaly, MATCH_LINES)
    assert "Do NOT include a fantasyImplication" in p


# --- generate_insight retry behavior ----------------------------------------

class _Resp:
    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self._content}}]}


def test_generate_recovers_on_retry(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    responses = iter(["not json at all", json.dumps(VALID_PAYLOAD)])
    calls = []
    monkeypatch.setattr(
        narrative.httpx, "post",
        lambda *a, **kw: calls.append(1) or _Resp(next(responses)),
    )
    assert generate_insight(PLAYER, ANOMALY, MATCH_LINES) == VALID_PAYLOAD
    assert len(calls) == 2


def test_generate_gives_up_after_two_failures(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    calls = []
    monkeypatch.setattr(
        narrative.httpx, "post",
        lambda *a, **kw: calls.append(1) or _Resp("{}"),
    )
    assert generate_insight(PLAYER, ANOMALY, MATCH_LINES) is None
    assert len(calls) == 2
