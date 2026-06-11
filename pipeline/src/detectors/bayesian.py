"""Detector A — Gamma-Poisson Bayesian form detector (guide Step 2.2).

Models a player's per-90 rate for a count metric (goals, shots, key passes)
as a Gamma-distributed Poisson intensity. A baseline posterior built from
older matches is compared against a recency-weighted posterior over the
last few matches; a flag fires when the two credible intervals separate or
the KL divergence between the posteriors crosses a threshold. The Poisson
tail probability of the recent total under the baseline rate serves as the
p-value analog consumed by FDR correction (Step 2.6).

Count metrics (goals, shots, key passes) are the primary domain. The typing
layer (Step 2.5) also feeds xg and xg_buildup through the same posterior as
quasi-counts: the Gamma update, credible intervals and KL stay exact for
continuous totals; only the Poisson tail p-value is approximate there, and
typing never reads it.
"""

import numpy as np
from scipy import stats

PRIOR_ALPHA, PRIOR_BETA = 1.0, 1.0   # weakly informative
RECENT_HALFLIFE = 3                   # matches, exponential decay
CI = 0.90


def gamma_posterior(counts, minutes, alpha0=PRIOR_ALPHA, beta0=PRIOR_BETA, weights=None):
    """Posterior over per-90 rate. exposure in units of 90 minutes."""
    exposure = np.asarray(minutes) / 90.0
    counts = np.asarray(counts, dtype=float)
    if weights is None:
        weights = np.ones_like(counts)
    alpha = alpha0 + np.sum(weights * counts)
    beta = beta0 + np.sum(weights * exposure)
    return alpha, beta


def recent_weights(n, halflife=RECENT_HALFLIFE):
    """Exponential-decay weights for the last ``n`` matches (most recent = 1.0)."""
    ages = np.arange(n - 1, -1, -1)          # most recent age 0
    return 0.5 ** (ages / halflife)


def credible_interval(alpha, beta, ci=CI):
    """Equal-tailed ``ci`` credible interval of Gamma(alpha, rate=beta)."""
    lo = stats.gamma.ppf((1 - ci) / 2, a=alpha, scale=1 / beta)
    hi = stats.gamma.ppf(1 - (1 - ci) / 2, a=alpha, scale=1 / beta)
    return lo, hi


def kl_gamma(a1, b1, a2, b2):
    """KL divergence KL(Gamma(a1, b1) || Gamma(a2, b2)), rate parametrization."""
    from scipy.special import gammaln, digamma
    return ((a1 - a2) * digamma(a1) - gammaln(a1) + gammaln(a2)
            + a2 * (np.log(b1) - np.log(b2)) + a1 * (b2 - b1) / b1)


def detect(counts, minutes, recent_n=6, kl_threshold=1.5):
    """Compare recent form against the baseline posterior for one metric.

    Args:
        counts: Per-match metric counts in match order (qualifying only).
        minutes: Per-match minutes, aligned with ``counts``.
        recent_n: How many trailing matches form the recent window.
        kl_threshold: KL divergence at or above this is flagged.

    Returns:
        dict with flagged, direction, p_value, kl, baseline_ci, recent_ci,
        baseline_rate, recent_rate.
    """
    base_a, base_b = gamma_posterior(counts[:-recent_n], minutes[:-recent_n])
    w = recent_weights(recent_n)
    rec_a, rec_b = gamma_posterior(counts[-recent_n:], minutes[-recent_n:], weights=w)

    b_lo, b_hi = credible_interval(base_a, base_b)
    r_lo, r_hi = credible_interval(rec_a, rec_b)
    no_overlap = (r_hi < b_lo) or (r_lo > b_hi)
    kl = kl_gamma(rec_a, rec_b, base_a, base_b)

    direction = "down" if rec_a / rec_b < base_a / base_b else "up"
    flagged = no_overlap or kl >= kl_threshold
    # p-value analog for FDR: posterior predictive tail probability
    lam_base = base_a / base_b
    total_recent = float(np.sum(counts[-recent_n:]))
    exp_recent = float(np.sum(np.asarray(minutes[-recent_n:]) / 90.0))
    if direction == "down":
        p = stats.poisson.cdf(total_recent, lam_base * exp_recent)
    else:
        p = stats.poisson.sf(total_recent - 1, lam_base * exp_recent)

    return {
        "flagged": bool(flagged), "direction": direction, "p_value": float(p),
        "kl": float(kl),
        "baseline_ci": [float(b_lo), float(b_hi)],
        "recent_ci": [float(r_lo), float(r_hi)],
        "baseline_rate": float(base_a / base_b), "recent_rate": float(rec_a / rec_b),
    }
