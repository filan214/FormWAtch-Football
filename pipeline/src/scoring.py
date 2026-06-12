"""Anomaly typing logic (guide Step 2.5) — combine detector outputs.

Maps detector outputs onto the six anomaly types. One *primary* anomaly per
player per matchweek, decided by precedence (structural explanations beat
performance explanations — if the role changed, the form numbers moving is
expected, not anomalous):

    ROLE_CHANGE > FORM_COLLAPSE > FINISHING_SLUMP
                > OVERPERFORMANCE_RISK > BREAKOUT

WORKLOAD_SPIKE lives in a different domain (schedule congestion, not
output), is exempt from precedence, and may coexist with one primary
anomaly — the runner emits it as a separate anomaly record.

The Bayesian results consumed here cover the count metrics (goals, shots,
key_passes) plus quasi-count runs over xg and xg_buildup: the Gamma
posterior, credible intervals and KL are exact for continuous totals; only
the Poisson tail p-value is approximate there, and typing never uses it.
Understat substitutions carry through from Step 2.4: xg_chain_p90 and
xg_buildup_p90 replace the extinct touches_att_box_p90 and
progressive_passes_p90 everywhere.
"""

import numpy as np
import pandas as pd
from scipy import stats

from .detectors.multivariate import FEATURES, mahalanobis_profile

# Overperformance (Poisson tail of goals given xG over the recent window)
OVERPERF_WINDOW = 8          # qualifying matches
OVERPERF_P = 0.05
OVERPERF_MARGIN = 2.0        # goals above xG; effect-size floor

# Breakout breadth + persistence
BREADTH_METRICS = ("shots", "key_passes", "xg_buildup")
BREADTH_MIN = 2
PERSISTENCE_KL = 2.0         # fallback when no prior week's evidence exists

# Workload (minutes are not Poisson counts; this is a documented heuristic)
WORKLOAD_DAYS = 35
WORKLOAD_RATIO = 1.5
WORKLOAD_MIN_MINUTES = 900

# Role change
ROLE_WINDOW = 8              # change point must fall in the last N matches
ROLE_MIN_D = 1.0
ROLE_SHAPE_METRICS = ("xg_buildup_p90", "xg_chain_p90", "key_passes_p90")

# FDR + severity (Step 2.6); weights sum to 100, caps mark saturation points
# q tuned by the 2024-25 backtest (Step 2.7): 0.15 keeps slow-burn slumps
# (Palmer, Vardy) alive through BH without letting weekly volume leave the
# 5-15 band; 0.10 dropped recall from 9/11 to 8/11 known anomalies.
FDR_Q = 0.15                  # Benjamini-Hochberg false-discovery rate
SEV_KL_WEIGHT = 40.0
SEV_PERSISTENCE_WEIGHT = 30.0
SEV_FDR_WEIGHT = 30.0
SEV_KL_CAP = 3.0              # KL at or above this earns the full 40
SEV_PERSISTENCE_CAP = 3.0     # weeks

# Primary-anomaly precedence, first match wins. WORKLOAD_SPIKE is exempt.
PRECEDENCE = (
    "ROLE_CHANGE",
    "FORM_COLLAPSE",
    "FINISHING_SLUMP",
    "OVERPERFORMANCE_RISK",
    "BREAKOUT",
)


def overperf_vs_xg(recent_window: pd.DataFrame) -> bool:
    """Is the player scoring significantly above xG over the recent window?

    Poisson tail test, consistent with the project's statistical character:
    observed goals against a Poisson with rate = total xG. Significance alone
    is not enough — a margin floor stops tiny xG samples with one lucky goal
    from triggering.

    Args:
        recent_window: The last ``OVERPERF_WINDOW`` qualifying matches, with
            ``goals`` and ``xg`` columns.
    """
    lam = float(recent_window["xg"].sum())
    observed = float(recent_window["goals"].sum())
    p = stats.poisson.sf(observed - 1, lam)
    return bool(p <= OVERPERF_P and observed - lam >= OVERPERF_MARGIN)


def broad_uplift(bayes_results: dict, prior_up_metrics=None) -> bool:
    """Breakout requires breadth, output direction, and persistence.

    * Breadth: at least ``BREADTH_MIN`` of ``BREADTH_METRICS`` flagged "up"
      by the Bayesian detector.
    * Output: goals or xg directionally up (recent_rate > baseline_rate;
      a flag is not required).
    * Persistence: at least ``BREADTH_MIN`` of the currently-up metrics were
      also elevated in the previous week's run (``prior_up_metrics``, read
      from prior anomaly evidence). With no prior-week data, the strongest
      currently-up metric must show KL >= ``PERSISTENCE_KL`` instead.

    Args:
        bayes_results: metric -> ``bayesian.detect()`` output.
        prior_up_metrics: metrics elevated last week, or None if unknown.
    """
    up = [
        m
        for m in BREADTH_METRICS
        if m in bayes_results
        and bayes_results[m]["flagged"]
        and bayes_results[m]["direction"] == "up"
    ]
    if len(up) < BREADTH_MIN:
        return False

    output_up = any(
        bayes_results[m]["recent_rate"] > bayes_results[m]["baseline_rate"]
        for m in ("goals", "xg")
        if m in bayes_results
    )
    if not output_up:
        return False

    if prior_up_metrics is not None:
        return len(set(up) & set(prior_up_metrics)) >= BREADTH_MIN
    return max(bayes_results[m]["kl"] for m in up) >= PERSISTENCE_KL


def workload_spike(match_log: pd.DataFrame, as_of=None) -> dict:
    """Flag schedule congestion: a trailing-35-day minutes load well above
    the player's own norm.

    Heuristic by design — minutes are bounded and scheduled, not Poisson
    counts, so no posterior is fitted. Congestion is the minutes total over
    the trailing ``WORKLOAD_DAYS``; the baseline is the player's median
    35-day rolling sum across the season's match dates.

    Args:
        match_log: One season of the player's appearances — *all* of them,
            including sub-30-minute cameos — with ``date`` and ``minutes``.
        as_of: Evaluation date; defaults to the last match date.

    Returns:
        dict with flagged, congestion, baseline_congestion, ratio.
    """
    log = match_log.copy()
    log["date"] = pd.to_datetime(log["date"])
    log = log.sort_values("date")
    end = pd.Timestamp(as_of) if as_of is not None else log["date"].max()

    def window_sum(until: pd.Timestamp) -> float:
        in_window = (log["date"] > until - pd.Timedelta(days=WORKLOAD_DAYS)) & (
            log["date"] <= until
        )
        return float(log.loc[in_window, "minutes"].sum())

    congestion = window_sum(end)
    baseline = float(np.median([window_sum(d) for d in log["date"]]))
    ratio = congestion / baseline if baseline > 0 else float("inf")
    flagged = congestion >= WORKLOAD_RATIO * baseline and congestion >= WORKLOAD_MIN_MINUTES
    return {
        "flagged": bool(flagged),
        "congestion": congestion,
        "baseline_congestion": baseline,
        "ratio": ratio,
    }


def role_change(df_player: pd.DataFrame, change_points: list) -> dict:
    """Type a recent regime shift as a role change (shape, not output).

    Requires all three of: a change point within the last ``ROLE_WINDOW``
    matches; Mahalanobis d >= ``ROLE_MIN_D`` between the pre- and
    post-change-point profiles; and a diff vector whose largest absolute
    component is an involvement metric (``ROLE_SHAPE_METRICS``), not goals —
    a shape change driven by positioning, not scoring output.

    Args:
        df_player: Qualifying matches in match order with FEATURES columns.
        change_points: Output of ``find_change_points`` (each index is the
            first match of a new regime).

    Returns:
        dict with flagged, change_point, d, diff, dominant.
    """
    result = {
        "flagged": False,
        "change_point": None,
        "d": None,
        "diff": None,
        "dominant": None,
    }
    n = len(df_player)
    recent = [cp for cp in change_points if 0 < cp < n and cp >= n - ROLE_WINDOW]
    if not recent:
        return result

    cp = max(recent)  # the most recent regime start
    d, diff = mahalanobis_profile(
        df_player.iloc[:cp][list(FEATURES)], df_player.iloc[cp:][list(FEATURES)]
    )
    dominant = diff.abs().idxmax()
    result.update(
        change_point=int(cp),
        d=float(d),
        diff={k: float(v) for k, v in diff.items()},
        dominant=str(dominant),
        flagged=bool(d >= ROLE_MIN_D and dominant in ROLE_SHAPE_METRICS),
    )
    return result


def classify(
    bayes_results: dict,
    role_change_result: dict | None = None,
    overperforming: bool = False,
    uplift: bool = False,
) -> str | None:
    """Return the primary anomaly type, or None if nothing fires.

    Evaluates the PRECEDENCE order top-down; the first rule that matches
    wins. ``xg`` here is Understat's true per-match xG run through the
    Bayesian detector as a quasi-count (the guide's ``xg_proxy_shots``
    predates having real xG). WORKLOAD_SPIKE is handled separately by the
    runner and stacks with whatever this returns.

    Args:
        bayes_results: metric -> ``bayesian.detect()`` output; needs at
            least ``goals`` and ``xg`` entries.
        role_change_result: ``role_change()`` output, if computed.
        overperforming: ``overperf_vs_xg()`` over the recent window.
        uplift: ``broad_uplift()`` outcome.
    """
    if role_change_result and role_change_result.get("flagged"):
        return "ROLE_CHANGE"

    goals, xg = bayes_results["goals"], bayes_results["xg"]
    goals_down = goals["flagged"] and goals["direction"] == "down"
    xg_down = xg["flagged"] and xg["direction"] == "down"
    goals_up = goals["flagged"] and goals["direction"] == "up"
    xg_up = xg["flagged"] and xg["direction"] == "up"

    if goals_down and xg_down:
        return "FORM_COLLAPSE"
    if goals_down and not xg_down:
        return "FINISHING_SLUMP"
    if goals_up and overperforming:
        return "OVERPERFORMANCE_RISK"
    if (goals_up and xg_up) or uplift:
        # Second BREAKOUT route (added by the 2024-25 backtest): a scoring
        # surge backed by rising xG is a genuine form improvement even when
        # the involvement-breadth gate misses it — pure strikers (Isak,
        # Mateta in 2024-25) surge in goals and xG without moving shots
        # volume, key passes or buildup enough to clear broad_uplift.
        return "BREAKOUT"
    return None


def apply_fdr(p_values, q: float = FDR_Q) -> tuple[np.ndarray, np.ndarray]:
    """Benjamini-Hochberg correction over one matchweek's candidate anomalies.

    Hundreds of players are tested every week, so raw detector p-values
    overstate the evidence; BH controls the expected share of false
    discoveries among the anomalies that get through.

    Args:
        p_values: Raw p-values, one per candidate anomaly.
        q: Target false-discovery rate.

    Returns:
        ``(adjusted, rejected)``: BH-adjusted p-values in input order and the
        boolean keep-mask ``adjusted <= q``.
    """
    p = np.asarray(p_values, dtype=float)
    if p.size == 0:
        return p, np.zeros(0, dtype=bool)
    adjusted = stats.false_discovery_control(p, method="bh")
    return adjusted, adjusted <= q


def severity(kl: float, persistence_weeks: float, fdr_p: float) -> int:
    """0-100 severity: evidence strength + persistence + significance.

    Three capped components: KL divergence between recent and baseline
    posteriors (how far form moved), how many consecutive weeks the anomaly
    has been active, and how far the FDR-adjusted p sits below ``FDR_Q``.

    Args:
        kl: KL divergence from the Bayesian detector.
        persistence_weeks: Consecutive weeks this anomaly has been active.
        fdr_p: BH-adjusted p-value from ``apply_fdr``.
    """
    s = (
        SEV_KL_WEIGHT * min(kl / SEV_KL_CAP, 1)
        + SEV_PERSISTENCE_WEIGHT * min(persistence_weeks / SEV_PERSISTENCE_CAP, 1)
        + SEV_FDR_WEIGHT * (1 - min(fdr_p / FDR_Q, 1))
    )
    return int(round(s))
