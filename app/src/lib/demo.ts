/**
 * Self-contained math for the /how-it-works interactive illustrations.
 * Everything here runs client-side on synthetic data — it mirrors the
 * pipeline's logic for teaching purposes but never touches real data.
 */
import { type GammaParams, logGamma } from "@/lib/gamma";

/** Deterministic PRNG so server HTML and hydration agree (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth Poisson sampler — fine for the small λ of football counts. */
export function poisson(lambda: number, rng: () => number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

/** Digamma ψ(x): recurrence up to x ≥ 6, then the asymptotic series. */
export function digamma(x: number): number {
  let result = 0;
  while (x < 6) {
    result -= 1 / x;
    x += 1;
  }
  const inv = 1 / x;
  const inv2 = inv * inv;
  return (
    result +
    Math.log(x) -
    0.5 * inv -
    inv2 * (1 / 12 - inv2 * (1 / 120 - inv2 / 252))
  );
}

/** Closed-form KL( Gamma(p) ‖ Gamma(q) ) for shape/rate parameterization. */
export function gammaKl(p: GammaParams, q: GammaParams): number {
  return (
    (p.alpha - q.alpha) * digamma(p.alpha) -
    logGamma(p.alpha) +
    logGamma(q.alpha) +
    q.alpha * (Math.log(p.beta) - Math.log(q.beta)) +
    (p.alpha * (q.beta - p.beta)) / p.beta
  );
}

/**
 * The pipeline's naive control detector, mirrored exactly
 * (pipeline/src/detectors/naive.py): a 10-match rolling baseline shifted
 * back 3, judged against the last-3 mean, flagged at |z| ≥ 2.
 */
export function naiveZFlags(
  series: number[],
  window = 10,
  recent = 3,
  threshold = 2,
): boolean[] {
  return series.map((_, i) => {
    const end = i - recent + 1; // baseline block ends `recent` behind i
    const start = end - window;
    if (start < 0) return false;
    const block = series.slice(start, end);
    const mean = block.reduce((a, b) => a + b, 0) / window;
    const sd = Math.sqrt(
      block.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1),
    );
    if (sd === 0) return false;
    const recentMean =
      series.slice(i - recent + 1, i + 1).reduce((a, b) => a + b, 0) / recent;
    return Math.abs((recentMean - mean) / sd) >= threshold;
  });
}

export interface SimulatedSeason {
  goals: number[];
  naiveFlags: boolean[];
  bayesNominations: boolean[];
}

/**
 * One season of a perfectly consistent striker: every match is a Poisson
 * draw at the SAME true rate, then both detectors judge it. Any flag is,
 * by construction, a false alarm.
 */
export function simulateSeason(
  seed: number,
  trueRate = 0.45,
  matches = 30,
  klThreshold = 1.5,
): SimulatedSeason {
  const rng = mulberry32(seed);
  const goals = Array.from({ length: matches }, () => poisson(trueRate, rng));

  const naiveFlags = naiveZFlags(goals);

  // simplified conjugate updates: baseline = weak prior + all history
  // before the recent window; recent = weak prior + last 6 matches
  const bayesNominations = goals.map((_, i) => {
    if (i < 9) return false; // mirrors the 10-match eligibility floor
    const history = goals.slice(0, i - 5);
    const recent6 = goals.slice(i - 5, i + 1);
    const base: GammaParams = {
      alpha: 1 + history.reduce((a, b) => a + b, 0),
      beta: 1 + history.length,
    };
    const rec: GammaParams = {
      alpha: 1 + recent6.reduce((a, b) => a + b, 0),
      beta: 1 + recent6.length,
    };
    return gammaKl(rec, base) >= klThreshold;
  });

  return { goals, naiveFlags, bayesNominations };
}

export interface WeekOfPValues {
  /** sorted ascending */
  pValues: number[];
  signalCount: number;
}

/** A synthetic detection week: mostly honest-null junk, a few real movers. */
export function simulateWeek(
  seed: number,
  candidates = 214,
  signals = 14,
): WeekOfPValues {
  const rng = mulberry32(seed);
  const junk = Array.from({ length: candidates - signals }, () => rng());
  const real = Array.from({ length: signals }, () =>
    10 ** (-1.2 - 3.3 * rng()),
  );
  return {
    pValues: [...junk, ...real].sort((a, b) => a - b),
    signalCount: signals,
  };
}

/** Benjamini-Hochberg: index of the last survivor in the sorted array (-1 if none). */
export function bhCutoff(sortedP: number[], q: number): number {
  let k = -1;
  for (let i = 0; i < sortedP.length; i++) {
    if (sortedP[i] <= (q * (i + 1)) / sortedP.length) k = i;
  }
  return k;
}

/** The production severity formula (pipeline/src/scoring.py), verbatim. */
export function severityScore(
  kl: number,
  persistenceWeeks: number,
  fdrP: number,
  q = 0.15,
): { total: number; klPart: number; weeksPart: number; fdrPart: number } {
  const klPart = 40 * Math.min(kl / 3, 1);
  const weeksPart = 30 * Math.min(persistenceWeeks / 3, 1);
  const fdrPart = 30 * (1 - Math.min(fdrP / q, 1));
  return {
    total: Math.round(klPart + weeksPart + fdrPart),
    klPart,
    weeksPart,
    fdrPart,
  };
}
