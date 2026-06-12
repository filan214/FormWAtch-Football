"""AI narrative layer (guide Steps 3.1-3.2) — OpenRouter insights.

One structured-JSON insight per active anomaly at severity >= 60, cached in
``ai_insights`` keyed by a hash of the anomaly evidence: unchanged evidence
on a re-run regenerates nothing. The payload mirrors the app's Zod
``AnomalyInsight`` schema (PRD §6.2) and is validated with jsonschema before
caching; on parse/validation failure the call is retried once, then the
anomaly is simply left without an insight (the UI renders a fallback).
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone

import httpx
import jsonschema

logger = logging.getLogger(__name__)

MODEL = "google/gemini-2.5-flash"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MIN_SEVERITY = 60
FANTASY_TYPES = {"FINISHING_SLUMP", "OVERPERFORMANCE_RISK", "BREAKOUT"}
ANOMALY_TYPES = [
    "FORM_COLLAPSE", "FINISHING_SLUMP", "BREAKOUT",
    "OVERPERFORMANCE_RISK", "WORKLOAD_SPIKE", "ROLE_CHANGE",
]

SYSTEM = """You are a football analytics writer. Respond ONLY with valid JSON
matching the provided schema. No markdown, no preamble."""

# jsonschema mirror of the app-side Zod AnomalyInsight schema (PRD §6.2)
INSIGHT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "headline", "summary", "technicalExplanation", "anomalyType",
        "confidence", "keyEvidence", "outlook",
    ],
    "properties": {
        "headline": {"type": "string"},
        "summary": {"type": "string"},
        "technicalExplanation": {"type": "string"},
        "anomalyType": {"enum": ANOMALY_TYPES},
        "confidence": {"enum": ["low", "medium", "high"]},
        "keyEvidence": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["metric", "baseline", "recent", "unit"],
                "properties": {
                    "metric": {"type": "string"},
                    "baseline": {"type": "number"},
                    "recent": {"type": "number"},
                    "unit": {"type": "string"},
                },
            },
        },
        "outlook": {"type": "string"},
        "fantasyImplication": {"type": "string"},
    },
}


def evidence_hash(evidence: dict) -> str:
    """Stable 16-hex digest of the anomaly evidence; the cache key."""
    return hashlib.sha256(
        json.dumps(evidence, sort_keys=True).encode()
    ).hexdigest()[:16]


def _coerce_numbers(payload: dict) -> dict:
    """Gemini intermittently quotes keyEvidence numbers; coerce before
    validating so '0.61' doesn't burn the retry."""
    for item in payload.get("keyEvidence", []):
        for k in ("baseline", "recent"):
            if isinstance(item.get(k), str):
                try:
                    item[k] = float(item[k])
                except ValueError:
                    pass  # leave it; jsonschema will reject with context
    return payload


def validate_insight(payload: dict, anomaly_type: str) -> None:
    """Schema check plus the contract bits jsonschema can't express."""
    jsonschema.validate(_coerce_numbers(payload), INSIGHT_SCHEMA)
    if len(payload["headline"].split()) > 12:
        raise ValueError(f"headline over 12 words: {payload['headline']!r}")
    if payload["anomalyType"] != anomaly_type:
        raise ValueError(
            f"anomalyType {payload['anomalyType']} != anomaly {anomaly_type}"
        )
    if payload.get("fantasyImplication") and anomaly_type not in FANTASY_TYPES:
        raise ValueError(f"fantasyImplication not allowed for {anomaly_type}")


def _metric_lines(evidence: dict) -> str:
    lines = []
    for m, r in evidence.get("metrics", {}).items():
        flag = " [flagged]" if r["flagged"] else ""
        lines.append(
            f"- {m}: baseline {r['baseline_rate']:.2f}/90 "
            f"(90% CI {r['baseline_ci'][0]:.2f}-{r['baseline_ci'][1]:.2f}) -> "
            f"recent {r['recent_rate']:.2f}/90 "
            f"(CI {r['recent_ci'][0]:.2f}-{r['recent_ci'][1]:.2f}), "
            f"direction {r['direction']}{flag}"
        )
    return "\n".join(lines)


def build_prompt(player: dict, anomaly: dict, match_lines: list[dict]) -> str:
    """Assemble the user prompt per guide Step 3.2."""
    ev = anomaly["evidence"]
    typ = anomaly["anomaly_type"]

    matches = "\n".join(
        f"- {m['date']} vs {m['opponent']}: {m['minutes']}', "
        f"{m['goals']} goals, {m['xg']:.2f} xG, {m['shots']} shots"
        for m in match_lines
    )
    extras = []
    if ev.get("role_change"):
        rc = ev["role_change"]
        extras.append(
            f"Profile shift detected on {rc['change_point_date']} "
            f"(Mahalanobis d={rc['d']:.2f}, biggest mover: {rc['dominant']})."
        )
    if ev.get("family") == "WORKLOAD":
        extras.append(
            f"Trailing-35-day load: {ev['congestion_minutes']:.0f} minutes vs "
            f"a typical {ev['baseline_congestion']:.0f} (x{ev['ratio']:.2f})."
        )
    fantasy_rule = (
        "Include a fantasyImplication field (one sentence for FPL managers)."
        if typ in FANTASY_TYPES
        else "Do NOT include a fantasyImplication field."
    )

    return f"""Write an insight for this football form anomaly.

PLAYER: {player.get('name')} ({player.get('position') or 'unknown position'}, {player.get('team') or 'unknown team'})
ANOMALY: {typ}, severity {anomaly['severity']}/100, active for {ev.get('persistence_weeks', 1)} week(s)
DETECTORS FIRED: {', '.join(anomaly.get('detectors_fired') or [])}
FDR-ADJUSTED P: {anomaly.get('fdr_adjusted_p')}

EVIDENCE (per-90 rates, Bayesian posterior, baseline vs last 6 matches):
{_metric_lines(ev)}
{chr(10).join(extras)}

LAST {len(match_lines)} MATCHES:
{matches}

Respond with JSON only, exactly these fields:
- headline: max 12 words, punchy, no player stats dump
- summary: 2-3 sentences in plain language a casual fan understands; no jargon
- technicalExplanation: 2-3 sentences referencing the statistical evidence above (credible intervals, baseline vs recent rates, the change point if present)
- anomalyType: "{typ}"
- confidence: "high" if the evidence is overwhelming (tiny p, several weeks persistent), "medium" if solid, "low" if borderline
- keyEvidence: 2-4 items, each {{"metric", "baseline", "recent", "unit"}} using the numbers above (unit "per 90" for rates); baseline and recent must be JSON numbers, not strings
- outlook: 1-2 sentences on what to watch next
{fantasy_rule}

Explain plain language first, technical second. Do not invent facts not in the evidence (no injury or transfer claims)."""


def _call_openrouter(prompt: str) -> dict:
    r = httpx.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "response_format": {"type": "json_object"},
            # without an explicit cap OpenRouter pre-authorizes the model's
            # full 65k output window, which 402s on small credit balances
            "max_tokens": 2000,
        },
        timeout=60,
    )
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"]
    return json.loads(text.replace("```json", "").replace("```", "").strip())


def generate_insight(player: dict, anomaly: dict, match_lines: list[dict]) -> dict | None:
    """Generate and validate one insight; one retry, then give up (None)."""
    prompt = build_prompt(player, anomaly, match_lines)
    for attempt in (1, 2):
        try:
            payload = _call_openrouter(prompt)
            validate_insight(payload, anomaly["anomaly_type"])
            return payload
        except Exception as e:  # noqa: BLE001 - any parse/validation/HTTP failure
            logger.warning(
                "Insight attempt %d failed for anomaly %s: %s",
                attempt, anomaly.get("id"), e,
            )
    return None


def _last_match_lines(player_id: int, team: str | None, n: int = 6) -> list[dict]:
    """The player's last ``n`` qualifying match lines, opponent included.

    The player's side in each match isn't stored, so the current team from
    ``players`` decides the opponent — right for recent matches, which is
    all this feeds.
    """
    from . import db

    rows = (
        db.sb.table("player_match_stats")
        .select("minutes,goals,shots,xg,matches(date,home_team,away_team)")
        .eq("player_id", player_id)
        .eq("is_qualifying", True)
        .execute()
        .data
    )
    rows.sort(key=lambda r: r["matches"]["date"])
    out = []
    for r in rows[-n:]:
        m = r["matches"]
        opponent = m["away_team"] if m["home_team"] == team else m["home_team"]
        out.append({
            "date": m["date"],
            "opponent": opponent,
            "minutes": r["minutes"],
            "goals": r["goals"],
            "shots": r["shots"],
            "xg": float(r["xg"]),
        })
    return out


def sync_insights(min_severity: int = MIN_SEVERITY) -> dict:
    """Generate insights for active anomalies that lack a current one.

    Skips anomalies whose stored ``evidence_hash`` already matches — the
    checkpoint behavior: a re-run on unchanged data regenerates nothing.
    """
    from . import db

    anomalies = [
        a for a in db.fetch_active_anomalies()
        if (a["severity"] or 0) >= min_severity
    ]
    cached = db.fetch_insight_hashes()
    players = {p["id"]: p for p in db.fetch_all("players", "id,name,team,position")}

    generated = skipped = failed = 0
    for a in anomalies:
        h = evidence_hash(a["evidence"])
        if cached.get(a["id"]) == h:
            skipped += 1
            continue
        player = players.get(a["player_id"], {})
        lines = _last_match_lines(a["player_id"], player.get("team"))
        payload = generate_insight(player, a, lines)
        if payload is None:
            failed += 1
            continue
        db.upsert_insight({
            "anomaly_id": a["id"],
            "payload": payload,
            "model": MODEL,
            "evidence_hash": h,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })
        generated += 1

    summary = {"eligible": len(anomalies), "generated": generated,
               "skipped": skipped, "failed": failed}
    logger.info("Insights: %s", summary)
    return summary
