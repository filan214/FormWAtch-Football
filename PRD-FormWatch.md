# PRD — FormWatch: Football Player Performance Anomaly Detection

**Version:** 1.1
**Date:** June 11, 2026
**Owner:** Filan
**Status:** Planning
**Project Type:** Portfolio — Data Science + Full-Stack + AI Integration

---

## 1. Overview

### 1.1 Product Summary
FormWatch is a web application that monitors football (soccer) player performance data, detects statistical anomalies — form collapses, breakout streaks, overperformance risk, workload spikes, and tactical role changes — and explains each anomaly with AI-generated narratives. It combines a Python data science pipeline with a Next.js dashboard.

### 1.2 Problem Statement
Football "form" is debated constantly but rarely quantified rigorously. Naive statistics produce constant false positives on small-sample, noisy match data. FormWatch applies proper statistical methodology (Bayesian estimation, change point detection, multivariate analysis) to separate real anomalies from noise.

### 1.3 Portfolio Goals
- Demonstrate **data science depth**: Bayesian modeling, change point detection, multivariate anomaly detection, FDR correction
- Demonstrate **data engineering**: scheduled scraping pipeline, ETL to PostgreSQL
- Demonstrate **full-stack skills**: Next.js App Router dashboard with rich visualizations
- Demonstrate **AI integration**: structured-JSON LLM narratives with caching (reusing Smart Finn Track patterns)
- **Methodology writeup** published as part of the app (a `/methodology` page) — the writeup itself is a portfolio artifact

### 1.4 Constraints
- **Zero monthly cost** — all services must run on free tiers
- Solo developer; phased delivery
- Data limited to freely available sources (FBref, Understat, StatsBomb Open Data)

---

## 2. Target Users

| Persona | Need |
|---|---|
| **Recruiters / hiring managers** (primary) | Evaluate Filan's DS + engineering skills via a polished, explainable project |
| **Fantasy football players** | Spot regression candidates (overperformers) and breakout players early |
| **Football analytics hobbyists** | Explore form timelines and anomaly explanations |
| **Scouts (aspirational)** | Early signals on breakout young players |

---

## 3. Scope

### 3.1 In Scope (v1)
- One league: **English Premier League** (best free data coverage)
- One season live + previous season as baseline history
- Outfield players with ≥ 450 league minutes (5 full matches)
- Weekly automated data refresh
- 5 anomaly types (see §5)
- AI narrative per anomaly, cached
- Public read-only dashboard (no auth in v1)

### 3.2 Out of Scope (v1)
- Goalkeepers (different metric space)
- Multiple leagues (v2: add La Liga / Liga 1 Indonesia)
- User accounts, watchlists, notifications (v2)
- In-match / live data
- Betting recommendations

---

## 4. Data Pipeline

### 4.1 Sources
| Source | Access Method | Data |
|---|---|---|
| FBref | `soccerdata` Python library | Per-match player stats: minutes, goals, assists, shots, xG, xA, key passes, progressive passes/carries, touches |
| Understat | `soccerdata` / scraping | Shot-level xG (shot location, situation) |
| StatsBomb Open Data | GitHub repo (free) | Event-level data for selected matches — used for positional drift prototype only |

### 4.2 Pipeline Architecture
```
GitHub Actions (cron: weekly, post-matchweek)
  └── Python ETL script
        ├── 1. Scrape latest matchweek (soccerdata)
        ├── 2. Clean & normalize (per-90, opponent adjustment)
        ├── 3. Compute baselines & run anomaly detectors
        ├── 4. Write players, matches, player_match_stats, anomalies → Supabase (postgres)
        └── 5. For new anomalies: call OpenRouter → structured JSON narrative → cache in ai_insights
```

- **Scheduler:** GitHub Actions cron (free for public repos)
- **Runtime:** Python 3.11 — `pandas`, `scipy`, `ruptures`, `scikit-learn`, `soccerdata`, `supabase-py`
- **Idempotency:** upserts keyed on `(player_id, match_id)`; pipeline safe to re-run
- **Rate limiting:** polite scraping with delays; respect FBref guidelines (~1 request / 3s)

### 4.3 Data Quality Rules
- Exclude appearances < 30 minutes from baseline computation (garbage-time noise)
- All rate metrics expressed per-90
- Opponent adjustment: divide attacking metrics by opponent defensive strength index (opponent xG-conceded per match ÷ league average)
- Minimum 5 qualifying matches before a player enters anomaly monitoring

---

## 5. Anomaly Detection Methodology

The detection engine layers three methods. Each anomaly record stores which detector(s) fired, the statistical evidence, and a typed classification used by the AI narrative layer.

### 5.1 Detector A — Bayesian Gamma-Poisson (core engine)
**Applies to count metrics:** goals, shots, key passes, progressive passes.

- Career/season baseline modeled as Gamma prior over rate λ (per-90)
- Each qualifying match updates the posterior (Gamma-Poisson conjugacy)
- Two posteriors maintained: **baseline posterior** (full history, slow-moving) and **recent-form posterior** (last 6 matches, exponentially weighted)
- **Anomaly trigger:** 90% credible intervals of the two posteriors do not overlap, or KL divergence exceeds threshold
- Naturally adaptive: young players with few matches → wide priors → fewer false flags; veterans → tight priors → sensitive detection

### 5.2 Detector B — Change Point Detection (timeline structure)
**Applies to:** rolling composite performance index per player.

- Library: `ruptures`, PELT algorithm with RBF cost
- Detects structural breaks (new manager, position change, injury return)
- Output: match index of regime change → rendered as vertical marker on the form timeline
- Minimum segment length: 4 matches (avoids flagging single-game spikes)

### 5.3 Detector C — Multivariate Profile (anomaly typing)
**Applies to:** per-match feature vector — [xG/90, shots/90, touches in box/90, progressive receptions/90, key passes/90, goals/90].

- Mahalanobis distance from player's historical centroid (regularized covariance, Ledoit-Wolf)
- League-wide Isolation Forest for "globally weird" performances
- The **direction** of deviation classifies anomaly type (see §5.4)

### 5.4 Anomaly Taxonomy
| Type | Signature | Example narrative angle |
|---|---|---|
| `FORM_COLLAPSE` | Output metrics down, underlying metrics (xG) down | Genuine slump — service and finishing both declined |
| `FINISHING_SLUMP` | Goals down, xG stable/up | Chances still coming; finishing cold — likely to normalize |
| `BREAKOUT` | Underlying + output metrics up ≥ threshold vs baseline | Young player establishing new level |
| `OVERPERFORMANCE_RISK` | Goals ≫ xG over window | Regression candidate — fantasy sell-high signal |
| `WORKLOAD_SPIKE` | Minutes/match-congestion z-score high | Rotation/injury-risk flag |
| `ROLE_CHANGE` | Change point + shifted touch/pass profile | Tactical repositioning detected |

### 5.5 False Positive Control
- **Benjamini-Hochberg FDR correction** applied across all (player × metric) tests per matchweek; target FDR ≤ 10%
- Severity score (0–100) computed from posterior separation + persistence (consecutive weeks flagged)
- Dashboard defaults to severity ≥ 60; full list behind a filter
- Naive z-score detector also computed and stored — **shown on the methodology page as the documented baseline comparison**

---

## 6. AI Narrative Layer

### 6.1 Pattern (reused from Smart Finn Track)
- Model: `google/gemini-2.5-flash` via **OpenRouter** (free tier)
- SDK: Vercel AI SDK on pipeline side / server side
- **Structured JSON output** with defined TypeScript types — no raw markdown
- Responses cached in `ai_insights`; regenerated only when the anomaly record updates (new evidence)

### 6.2 Response Schema
```typescript
interface AnomalyInsight {
  headline: string;            // ≤ 12 words
  summary: string;             // 2–3 sentences, plain language
  technicalExplanation: string; // references the statistical evidence
  anomalyType: AnomalyType;
  confidence: 'low' | 'medium' | 'high';
  keyEvidence: { metric: string; baseline: number; recent: number; unit: string }[];
  outlook: string;             // what to watch next
  fantasyImplication?: string; // optional, for relevant types
}
```

### 6.3 Prompt Inputs
Player profile, anomaly type + severity, detector evidence (posterior intervals, change point date, Mahalanobis components), last 6 match lines, opponent-adjusted context. System prompt enforces JSON-only output; response parsed and validated with Zod before caching.

---

## 7. Database Schema (Supabase PostgreSQL + Drizzle ORM)

```
players
  id (pk), fbref_id (unique), name, team, position, birth_date, photo_url

matches
  id (pk), fbref_id (unique), season, matchweek, date,
  home_team, away_team, home_xg, away_xg

player_match_stats
  id (pk), player_id (fk), match_id (fk),
  minutes, goals, assists, shots, xg, xa, key_passes,
  progressive_passes, progressive_carries, touches_att_box,
  opponent_adjusted_xg, is_qualifying (bool)
  unique(player_id, match_id)

player_baselines
  id (pk), player_id (fk), metric, as_of_date,
  gamma_alpha, gamma_beta,            -- baseline posterior
  recent_alpha, recent_beta,          -- recent-form posterior
  mean_per90, matches_count

anomalies
  id (pk), player_id (fk), detected_at, matchweek,
  anomaly_type (enum), severity (int 0–100), status (active|resolved),
  detectors_fired (jsonb), evidence (jsonb),
  change_point_match_id (fk, nullable),
  fdr_adjusted_p (numeric)

ai_insights
  id (pk), anomaly_id (fk unique), payload (jsonb),  -- AnomalyInsight
  model, generated_at, evidence_hash                 -- regenerate if hash changes

pipeline_runs
  id (pk), started_at, finished_at, status, matchweek,
  rows_written, anomalies_created, log_url
```

---

## 8. Application Architecture

### 8.1 Stack (consistent with POS System decisions)
| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router (full-stack), TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Data fetching | Server Components + TanStack Query for client interactivity |
| Forms/validation | Zod (validation of AI payloads too) |
| Charts | Recharts |
| Tables | TanStack Table |
| Toasts | Sonner |
| ORM | Drizzle |
| Database | Supabase (PostgreSQL) |
| Pipeline | Python on GitHub Actions cron |
| AI | Vercel AI SDK + OpenRouter (`google/gemini-2.5-flash`) |
| Hosting | Vercel |
| Cost | **$0/month** |

Note: read-heavy app → most pages are Server Components reading Supabase directly via Drizzle; Server Actions only needed for v2 interactive features.

### 8.2 Pages
| Route | Purpose |
|---|---|
| `/` | Anomaly feed — current matchweek, filterable by type/severity/team |
| `/anomaly/[id]` | Anomaly detail: AI narrative, evidence comparison bars (baseline vs recent), triggered matches list, posterior visualization |
| `/player/[id]` | Player form timeline with change point markers, rolling metrics, anomaly history |
| `/leaderboards` | Overperformers, breakout candidates, regression watch |
| `/methodology` | Full statistical writeup: naive baseline vs Bayesian approach, FDR correction, with live examples — **the portfolio centerpiece** |

### 8.3 Key Components (reuse map from Smart Finn Track)
| Smart Finn Track component | FormWatch equivalent |
|---|---|
| Anomaly Alert card (JSON AI response) | AnomalyCard with typed insight payload |
| Visual comparison bars | BaselineVsRecentBars (per metric) |
| Triggered transactions list | TriggeredMatchesList |
| Six-month trend chart | FormTimelineChart (+ change point markers) |
| Category donut | AnomalyTypeDistribution |
| AI summary block | InsightNarrative |

---

## 9. Operational Continuity

FormWatch is designed to run **indefinitely across seasons with zero manual intervention** during the season. A system that silently goes stale when a new season begins is a demo, not a deployed product. Three design requirements guarantee seasonal continuity.

### 9.1 Dynamic season detection
The pipeline must compute the current season from the run date — never from a hardcoded season string. Each weekly run derives the active EPL season (August–May spanning two calendar years) and always ingests the **current season plus the immediately previous one** for baseline depth. When a new season kicks off in August, the pipeline picks it up automatically with no code change.

### 9.2 Baseline carry-forward (statistical requirement)
This is the most important continuity decision, and it is a *statistical* one rather than an engineering convenience. At the start of each new season, a player's Bayesian posterior from the end of the previous season becomes his **opening prior** for the new season. The `player_baselines` table already persists the Gamma posterior parameters (`gamma_alpha`, `gamma_beta`) with an `as_of_date`, so carry-forward reuses existing schema.

The rationale matters: this is precisely what makes the Bayesian engine superior to a rolling average. A rolling average has no memory beyond its window and resets every season; FormWatch accumulates knowledge across seasons. Consequences:
- A veteran (e.g. 200+ career matches) enters the new season with a tight, well-informed prior and can be flagged correctly by Matchweek 2 if something is genuinely wrong.
- A player new to the EPL (promoted youngster, incoming transfer) starts from the weakly informative prior (α=1, β=1) — wide and uncertain — so the system withholds judgment until enough matches accumulate. This is by design, not a gap.
- Without carry-forward, the first 4–5 matchweeks of every season would produce almost no flags and the system would appear broken to new visitors.

### 9.3 Pre-season squad refresh
Players change clubs between seasons and during the January window. A **pre-season refresh job** (run once in late July, before kickoff) syncs current squad rosters from FBref and updates `players.team`. Without it, team labels go stale and — more seriously — opponent-adjustment calculations use the wrong team context. Mid-season (January) transfers are corrected automatically: the weekly pipeline already upserts player rows, so a new club is reflected the first time a new match row arrives.

### 9.4 Seasonal lifecycle
```
Late July (pre-season, manual or annual cron on ~July 20):
  └── squad refresh: sync rosters → update players.team
  └── baseline carry-forward: seed new-season priors from prior-season posteriors

August–May (in-season, automatic weekly cron):
  └── detect current season → fetch latest matchweek → upsert → detect → narrate

May–July (off-season):
  └── pipeline still runs; FBref returns no new fixtures → zero anomalies, zero cost, idles cleanly
```

### 9.5 Scope boundary (documented limitation)
FormWatch v1 ingests **EPL fixtures only**. International matches (World Cup, Nations League) and other club competitions do not enter the system. A player's poor international tournament is invisible *as such* — though if that form carries into his subsequent EPL matches, the league-level dip is detected normally within a few matchweeks. Cross-competition awareness (maintaining separate per-context posteriors so club and international form can diverge) is a documented v2 candidate, listed in §13.

---

## 10. Development Roadmap

### Phase 1 — Data Foundation (Week 1–2)
- [ ] Repo setup: monorepo (`/app` Next.js, `/pipeline` Python)
- [ ] Supabase project + Drizzle schema + migrations
- [ ] `soccerdata` ingestion script: EPL player-match stats with **dynamic season detection** (§9.1)
- [ ] Data quality rules (per-90, qualifying matches, opponent adjustment)
- [ ] **Baseline carry-forward** logic and **pre-season squad refresh** job (§9.2, §9.3)
- [ ] GitHub Actions cron workflow with idempotent upserts

### Phase 2 — Detection Engine (Week 3–4)
- [ ] Detector A: Gamma-Poisson baseline + recent posteriors, credible-interval trigger
- [ ] Naive z-score detector (documented baseline)
- [ ] Detector B: `ruptures` PELT change points
- [ ] Detector C: Mahalanobis + Isolation Forest, anomaly typing
- [ ] BH-FDR correction + severity scoring
- [ ] Backtest on previous season; tune thresholds; record precision notes

### Phase 3 — AI Layer (Week 5)
- [ ] AnomalyInsight schema + Zod validation
- [ ] OpenRouter integration in pipeline, evidence-hash caching in `ai_insights`
- [ ] Prompt iteration on 10 known anomalies (eye test)

### Phase 4 — Dashboard (Week 6–7)
- [ ] Anomaly feed + filters
- [ ] Anomaly detail page (comparison bars, triggered matches, narrative)
- [ ] Player timeline with change point markers
- [ ] Leaderboards

### Phase 5 — Portfolio Polish (Week 8)
- [ ] `/methodology` page with naive-vs-Bayesian comparison and live examples
- [ ] README + architecture diagram
- [ ] OG images, loading states, empty states
- [ ] Deploy to Vercel; verify weekly cron end-to-end

---

## 11. Success Metrics

| Metric | Target |
|---|---|
| Pipeline reliability | ≥ 95% successful weekly runs |
| False positive control | Severity ≥ 60 anomalies pass eye test ≥ 80% of the time |
| Backtest validation | Known real-world slumps/breakouts from last season detected |
| Page performance | LCP < 2.5s on anomaly feed |
| Cost | $0/month maintained |
| Portfolio outcome | Methodology page readable end-to-end by a non-statistician |

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| FBref blocks scraping / rate limits | Polite delays, caching raw pulls, Understat as fallback for core metrics |
| Free-tier OpenRouter limits | Narratives only for severity ≥ 60; evidence-hash caching prevents regeneration |
| Supabase free-tier row limits | One league + two seasons ≈ well under limits; prune event-level data |
| GitHub Actions cron drift | Idempotent pipeline; manual trigger fallback |
| Small-sample false positives | Bayesian priors + FDR correction + persistence requirement (core design) |
| System goes stale at season rollover | Dynamic season detection + baseline carry-forward + pre-season squad refresh (§9) |

---

## 13. v2 Backlog
- Liga 1 Indonesia / La Liga expansion
- **Cross-competition awareness**: separate per-context posteriors (club vs international) so a player's club and national-team form can be tracked and compared independently (§9.5)
- User accounts + player watchlists + email digests (Resend free tier)
- Anomaly resolution tracking ("did the regression happen?") — model scorecard
- Goalkeeper metric space
- Public API endpoint for anomaly feed

---

*End of PRD v1.1*
