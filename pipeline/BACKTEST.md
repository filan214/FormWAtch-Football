# Backtest — 2024-25 season (Step 2.7)

Run: June 2026, against the production Supabase data (Understat, EPL).
Reproduce with:

```
python pipeline/scripts/backtest.py              # full premise check + grid + detail
python pipeline/scripts/backtest.py --premise-only
```

## Setup

The 2024-25 season is replayed at 28 weekly evaluation dates (Mondays,
2024-11-18 → 2025-05-26). Every evaluation uses only matches played on or
before that date — no lookahead. At each date, for every eligible player
(≥ 10 qualifying matches of ≥ 30 minutes, most recent within 28 days), the
full production stack runs: Gamma-Poisson detectors per metric (goals,
shots, key_passes, xg, xg_buildup) → anomaly typing → Benjamini-Hochberg
FDR across the week's candidates → severity with week-over-week
persistence tracking.

Conventions exercised here and intended for the weekly runner:

* **p-value fed to FDR** — the `goals` detector p for goals-driven types;
  for BREAKOUT, the smallest p among the up-flagged breadth metrics
  (falling back to the goals p for scoring-surge breakouts).
* **ROLE_CHANGE** has no p-value: it bypasses FDR (the conservative PELT
  penalty is its significance gate) and enters severity with `fdr_p = q/2`.
* **WORKLOAD_SPIKE** stacks separately and is excluded from the weekly
  volume target.
* **persistence_weeks** counts consecutive weekly evaluations a (player,
  anomaly-family) pair survived FDR, starting at 1.

## Known-anomaly list

Famous form stories of 2024-25, premise-checked against the data before
scoring: a story only counts as a test case if it is visible as a
within-season qualifying per-90 contrast. A case is a **hit** when the
engine emits a post-FDR anomaly of the right family (UP / DOWN) inside the
window ± one week.

| Case | Family | Window | Premise (goals/90, before → in window) |
|---|---|---|---|
| Cole Palmer | DOWN | Feb – May 2025 | 0.62 → 0.10, xG intact (0.48 → 0.46) |
| Erling Haaland | DOWN | Nov 2024 – Jan 2025 | 1.09 → 0.40 |
| Jamie Vardy | DOWN | Dec 2024 – Feb 2025 | 0.44 → 0.10, xG **up** (G−xG −4.0) |
| Chris Wood | UP | Dec 2024 – Mar 2025 | chronic G−xG +2.9 (expected miss, see below) |
| Bryan Mbeumo | UP | Nov 2024 – Jan 2025 | sustained overperformance (+2.0) |
| Alexander Isak | UP | Dec 2024 – Feb 2025 | 0.42 → 1.13 |
| Mohamed Salah | UP | Nov 2024 – Jan 2025 | 0.74 → 1.00, xG 0.63 → 0.94 |
| Justin Kluivert | UP | Nov 2024 – Jan 2025 | 0.16 → 0.60 |
| Jean-Philippe Mateta | UP | Feb – Apr 2025 | 0.41 → 0.84 |
| Marcus Rashford | UP | Mar – May 2025 | 0.32 → 0.85 (Villa loan) |
| Eberechi Eze | UP | Apr – May 2025 | 0.09 → 0.73 |

Cases **dropped by the premise check** (the story is real but not visible
as a within-season per-90 contrast, so it cannot test this engine):
Darwin Núñez (1 qualifying match in window — the anomaly was minutes, not
rate), Son Heung-Min (mild rate decline; the story was minutes and
availability), Rasmus Højlund (baseline already 0.19/90 — the drought was
a continuation, not a change), Morgan Rogers, Matheus Cunha, Josko
Gvardiol, Yoane Wissa, Enzo Fernández, Bruno Fernandes, Antoine Semenyo
(windows not supported by the data — flat or already-hot output).

## Results (chosen configuration)

Grid: `kl_threshold` ∈ {1.5, 2.5, 4, 6} × PELT `pen` ∈ {1.5, 3, 5} ×
FDR `q` ∈ {0.05, 0.10, 0.15}, severity weights fixed at 40/30/30.

**Chosen: `kl_threshold = 1.5`, `pen = 1.5`, `q = 0.15`** (now the code
defaults).

| Metric | Value | Target |
|---|---|---|
| Recall on known list | **9 / 11 (82%)** | ≥ 70% ✅ |
| Recall at severity ≥ 60 | 5 / 11 (45%) | — |
| Median active anomalies/week (sev ≥ 60) | **5** | 5–15 ✅ |
| p90 active anomalies/week (sev ≥ 60) | 8 | ≤ 15 ✅ |

Per-case outcomes:

| Case | Weeks flagged | Max severity | Type(s) |
|---|---|---|---|
| Cole Palmer | 1 | 50 | FINISHING_SLUMP |
| Erling Haaland | 7 | 91 | FINISHING_SLUMP / FORM_COLLAPSE |
| Jamie Vardy | 1 | 56 | FINISHING_SLUMP |
| Chris Wood | 0 | — | miss (expected) |
| Bryan Mbeumo | 1 | 48 | BREAKOUT |
| Alexander Isak | 3 | 80 | BREAKOUT |
| Mohamed Salah | 1 | 78 | BREAKOUT |
| Justin Kluivert | 1 | 59 | BREAKOUT |
| Jean-Philippe Mateta | 4 | 87 | BREAKOUT |
| Marcus Rashford | 11 | 97 | BREAKOUT |
| Eberechi Eze | 0 | — | miss |

Season totals (post-FDR): BREAKOUT 143, ROLE_CHANGE 85,
FINISHING_SLUMP 45, FORM_COLLAPSE 7, OVERPERFORMANCE_RISK 0,
WORKLOAD_SPIKE 0. High-severity flags outside the list are plausible on
inspection (Phil Foden's February surge, Youri Tielemans, Marcus Rashford
×6); they are not counted either way.

## What the backtest changed

1. **BREAKOUT gained a second route** (`scoring.classify`): goals *and* xg
   both posterior-flagged up. The breadth gate (shots / key passes /
   buildup) misses pure-striker surges — Isak and Mateta produced *zero*
   candidates before this fix because their goals and xG rose together
   without moving involvement metrics. Not overperformance (the Poisson
   test correctly rejects: their xG backed the goals) — a genuine form
   improvement with no type. Recall was 33% before this fix and the list
   cleanup; 82% after.
2. **PELT `pen` 5 → 1.5**: pen=5 found essentially no regimes on real
   composite signals (std ≈ 0.6). 1.5 finds documented shifts and still
   returns nothing on stationary noise (unit-tested).
3. **FDR `q` 0.10 → 0.15**: slow-burn slumps (Palmer, Vardy) produce
   modest p-values (see limitations) and survive BH only at 0.15; the
   weekly volume stays in band. q=0.10 cost one known case.
4. `kl_threshold` stays 1.5 and severity weights stay 40/30/30: raising KL
   to 2.5 dropped recall to 64% — KL is the *nomination* knob and FDR is
   the gate, so candidates should be cheap and the gate strict.

## Known limitations (found, documented, deferred)

* **Down-side statistical power.** A six-match scoreless window for a
  0.5–0.6 goals/90 player has a Poisson tail floor of ~0.03–0.04 — real
  droughts barely survive BH and rarely reach severity 60 (Palmer maxed at
  50 despite 16 candidate weeks). The evidence window should scale with
  the drought length (Palmer's 16-match drought is p ≈ 1e-4 taken whole).
  Deferred: changes `detect()`'s p definition.
* **Chronic overperformance is invisible** to recent-vs-baseline logic:
  Chris Wood was over xG from matchday 1, so his own baseline absorbs it
  (the expected miss). An 8-match window also rarely makes +2 G−xG
  significant at p ≤ 0.05 — OVERPERFORMANCE_RISK fired zero times this
  season (it is triple-gated by design). A season-scale G−xG test would
  catch Wood (20 goals on ~13 xG, p ≈ 0.04).
* **Cold start.** The backtest's first season has no prior baseline, so
  hot-from-day-one stories (Wood, Mbeumo's August) cannot contrast.
  Production carries two seasons forward.
* **WORKLOAD_SPIKE was dormant** (0 flags all season): Understat records
  league minutes only, and PL-only scheduling never reaches 1.5× a
  player's median 35-day load — congestion comes from cups and Europe,
  which this data cannot see. Left as-is; revisit if a multi-competition
  minutes source is added.
* **ROLE_CHANGE is unvalidated**: 85 flags, but no role-change story
  survived the premise check, so the list says nothing about their
  precision. They bypass FDR by construction. Treat as experimental until
  the Phase 3 narrative layer puts eyes on them.
* **Eze missed**: six candidate weeks, but a gradual surge against a
  rising baseline never produced a p small enough to clear BH.
