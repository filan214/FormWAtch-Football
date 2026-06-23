/**
 * Gamma posterior reconstruction for the anomaly detail page.
 *
 * The pipeline stores each posterior as a mean rate plus a 90% credible
 * interval (evidence jsonb), not as (alpha, beta) — storing the parameters
 * would change the evidence hash and needlessly invalidate cached insights.
 * Since the posteriors ARE Gamma distributions, the parameters can be
 * recovered: the ratio q95/q05 of a Gamma depends only on alpha, so a
 * bisection on the Wilson–Hilferty quantile approximation pins alpha, and
 * beta = alpha / mean.
 */

const Z90 = 1.6448536269514722; // z for the 5th/95th percentiles

/** Wilson–Hilferty approximation of the Gamma(alpha, beta) p-quantile. */
function gammaQuantile(alpha: number, beta: number, z: number): number {
  const a = 1 / (9 * alpha);
  const t = 1 - a + z * Math.sqrt(a);
  return (alpha / beta) * t * t * t;
}

export interface GammaParams {
  alpha: number;
  beta: number;
}

/**
 * Recover (alpha, beta) from a posterior mean and its 90% CI.
 * Returns null when the CI is degenerate (non-positive bounds).
 */
export function fitGammaFromCi(
  mean: number,
  ciLow: number,
  ciHigh: number,
): GammaParams | null {
  if (!(mean > 0) || !(ciLow > 0) || !(ciHigh > ciLow)) return null;
  const target = ciHigh / ciLow;
  // q95/q05 is monotone decreasing in alpha: bisect on log10(alpha)
  let lo = Math.log10(0.05);
  let hi = Math.log10(50_000);
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const alpha = 10 ** mid;
    const ratio =
      gammaQuantile(alpha, 1, Z90) / gammaQuantile(alpha, 1, -Z90);
    if (ratio > target) lo = mid;
    else hi = mid;
  }
  const alpha = 10 ** ((lo + hi) / 2);
  return { alpha, beta: alpha / mean };
}

/** Lanczos approximation of ln Γ(x), g = 7. */
function logGamma(x: number): number {
  const c = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return (
      Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
    );
  }
  x -= 1;
  let acc = 0.99999999999980993;
  for (let i = 0; i < c.length; i++) acc += c[i] / (x + i + 1);
  const t = x + 7.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (x + 0.5) * Math.log(t) -
    t +
    Math.log(acc)
  );
}

function gammaPdf(x: number, { alpha, beta }: GammaParams): number {
  if (x <= 0) return 0;
  return Math.exp(
    alpha * Math.log(beta) + (alpha - 1) * Math.log(x) - beta * x - logGamma(alpha),
  );
}

export interface CurvePoint {
  x: number;
  baseline: number | null;
  recent: number | null;
}

/**
 * Sample both posterior densities on a shared x grid for the detail-page
 * chart. Densities are normalized to a shared peak of 1 so the two curves
 * read as shapes, not absolute likelihoods.
 */
export function posteriorCurves(
  baseline: GammaParams,
  recent: GammaParams,
  xMax: number,
  n = 160,
): CurvePoint[] {
  const points: CurvePoint[] = [];
  let peak = 0;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * xMax;
    const b = gammaPdf(x, baseline);
    const r = gammaPdf(x, recent);
    peak = Math.max(peak, b, r);
    points.push({ x, baseline: b, recent: r });
  }
  if (peak === 0) return points;
  return points.map((p) => ({
    x: Number(p.x.toFixed(4)),
    baseline: Number(((p.baseline as number) / peak).toFixed(5)),
    recent: Number(((p.recent as number) / peak).toFixed(5)),
  }));
}
