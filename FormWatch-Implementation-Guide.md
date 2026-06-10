# FormWatch — Comprehensive Implementation Guide

**Companion to:** PRD-FormWatch.md v1.0
**Format:** Sequential steps with commands, code skeletons, and verification checkpoints.
Follow in order — each step ends with a ✅ checkpoint before moving on.

---

# PHASE 0 — Accounts & Project Setup (Day 1)

## Step 0.1 — Create free-tier accounts
1. **Supabase** → new project `formwatch` (region: Singapore, closest to you). Save the database password.
2. **OpenRouter** → create API key, confirm `google/gemini-2.5-flash` access.
3. **Vercel** — you already have this.
4. **GitHub** → create a **public** repo `formwatch` (public = unlimited Actions minutes).

## Step 0.2 — Monorepo structure
```bash
mkdir formwatch && cd formwatch
git init

mkdir -p app pipeline .github/workflows
```

Target structure:
```
formwatch/
├── app/                  # Next.js 14 (created in Phase 3)
├── pipeline/             # Python ETL + detection
│   ├── src/
│   │   ├── ingest.py         # FBref/Understat scraping
│   │   ├── transform.py      # per-90, opponent adjustment, qualifying rules
│   │   ├── detectors/
│   │   │   ├── bayesian.py   # Detector A
│   │   │   ├── changepoint.py# Detector B
│   │   │   ├── multivariate.py # Detector C
│   │   │   └── naive.py      # z-score baseline (for methodology page)
│   │   ├── scoring.py        # FDR correction + severity
│   │   ├── narrative.py      # OpenRouter AI insights
│   │   ├── db.py             # Supabase client + upserts
│   │   └── main.py           # orchestrator
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── .github/workflows/weekly-pipeline.yml
└── README.md
```

## Step 0.3 — Python environment
```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate
```

`requirements.txt`:
```
soccerdata==1.8.*
pandas>=2.0
scipy>=1.11
ruptures>=1.1
scikit-learn>=1.4
supabase>=2.4
httpx
python-dotenv
pytest
```

```bash
pip install -r requirements.txt
```

`.env.example`:
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=        # service role key — pipeline only, never in app/
OPENROUTER_API_KEY=
```

**✅ Checkpoint:** `python -c "import soccerdata, ruptures, sklearn"` runs clean.

---

# PHASE 1 — Database & Ingestion (Week 1–2)

## Step 1.1 — Create schema in Supabase
Run in Supabase SQL Editor (matches PRD §7):

```sql
create table players (
  id bigint generated always as identity primary key,
  fbref_id text unique not null,
  name text not null,
  team text,
  position text,
  birth_date date,
  photo_url text
);

create table matches (
  id bigint generated always as identity primary key,
  fbref_id text unique not null,
  season text not null,
  matchweek int,
  date date not null,
  home_team text not null,
  away_team text not null,
  home_xg numeric,
  away_xg numeric
);

create table player_match_stats (
  id bigint generated always as identity primary key,
  player_id bigint references players(id) not null,
  match_id bigint references matches(id) not null,
  minutes int not null,
  goals int default 0,
  assists int default 0,
  shots int default 0,
  xg numeric default 0,
  xa numeric default 0,
  key_passes int default 0,
  progressive_passes int default 0,
  progressive_carries int default 0,
  touches_att_box int default 0,
  opponent_adjusted_xg numeric,
  is_qualifying boolean default false,
  unique(player_id, match_id)
);

create table player_baselines (
  id bigint generated always as identity primary key,
  player_id bigint references players(id) not null,
  metric text not null,
  as_of_date date not null,
  gamma_alpha numeric,
  gamma_beta numeric,
  recent_alpha numeric,
  recent_beta numeric,
  mean_per90 numeric,
  matches_count int,
  unique(player_id, metric, as_of_date)
);

create type anomaly_type as enum (
  'FORM_COLLAPSE','FINISHING_SLUMP','BREAKOUT',
  'OVERPERFORMANCE_RISK','WORKLOAD_SPIKE','ROLE_CHANGE'
);

create table anomalies (
  id bigint generated always as identity primary key,
  player_id bigint references players(id) not null,
  detected_at timestamptz default now(),
  matchweek int,
  anomaly_type anomaly_type not null,
  severity int check (severity between 0 and 100),
  status text default 'active',
  detectors_fired jsonb,
  evidence jsonb,
  change_point_match_id bigint references matches(id),
  fdr_adjusted_p numeric
);

create table ai_insights (
  id bigint generated always as identity primary key,
  anomaly_id bigint references anomalies(id) unique not null,
  payload jsonb not null,
  model text,
  generated_at timestamptz default now(),
  evidence_hash text
);

create table pipeline_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text,
  matchweek int,
  rows_written int,
  anomalies_created int,
  log_url text
);

-- Read-only public access for the app (RLS)
alter table players enable row level security;
alter table matches enable row level security;
alter table player_match_stats enable row level security;
alter table anomalies enable row level security;
alter table ai_insights enable row level security;

create policy "public read" on players for select using (true);
create policy "public read" on matches for select using (true);
create policy "public read" on player_match_stats for select using (true);
create policy "public read" on anomalies for select using (true);
create policy "public read" on ai_insights for select using (true);
-- No insert/update policies → only service role (pipeline) can write.
```

## Step 1.2 — Ingestion script
`pipeline/src/ingest.py` skeleton:

```python
import soccerdata as sd
import pandas as pd

LEAGUE = "ENG-Premier League"

def fetch_player_match_stats(seasons: list[str]) -> pd.DataFrame:
    fbref = sd.FBref(leagues=LEAGUE, seasons=seasons)
    # Pull the stat tables you need; soccerdata caches to disk automatically
    summary = fbref.read_player_match_stats(stat_type="summary")
    passing = fbref.read_player_match_stats(stat_type="passing")
    possession = fbref.read_player_match_stats(stat_type="possession")
    df = join_stat_tables(summary, passing, possession)
    return df

def fetch_schedule(seasons: list[str]) -> pd.DataFrame:
    fbref = sd.FBref(leagues=LEAGUE, seasons=seasons)
    return fbref.read_schedule()
```

Key implementation notes:
- `soccerdata` caches scraped pages in `~/soccerdata/data` — **commit nothing**, but in GitHub Actions use `actions/cache` on this dir to minimize re-scraping
- First run: ingest **two seasons** (2024-25 as history, 2025-26 current)
- Flatten the MultiIndex columns FBref returns: `df.columns = ['_'.join(c).strip('_') for c in df.columns]`

## Step 1.3 — Transform rules
`pipeline/src/transform.py`:

```python
QUALIFYING_MINUTES = 30
BASELINE_MIN_MATCHES = 5
PER90_METRICS = ["goals","shots","xg","xa","key_passes",
                 "progressive_passes","progressive_carries","touches_att_box"]

def add_per90(df):
    for m in PER90_METRICS:
        df[f"{m}_p90"] = df[m] / df["minutes"] * 90
    return df

def mark_qualifying(df):
    df["is_qualifying"] = df["minutes"] >= QUALIFYING_MINUTES
    return df

def opponent_adjust(df, team_defense):  # team_defense: xG conceded per match / league avg
    df = df.merge(team_defense, left_on="opponent", right_index=True)
    df["opponent_adjusted_xg"] = df["xg"] / df["defense_strength"]
    return df
```

## Step 1.4 — Database writer with idempotent upserts
`pipeline/src/db.py`:

```python
from supabase import create_client
import os

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

def upsert_players(rows: list[dict]):
    sb.table("players").upsert(rows, on_conflict="fbref_id").execute()

def upsert_stats(rows: list[dict]):
    sb.table("player_match_stats").upsert(
        rows, on_conflict="player_id,match_id"
    ).execute()
```

Batch upserts in chunks of 500 rows to stay under request size limits.

## Step 1.5 — GitHub Actions cron
`.github/workflows/weekly-pipeline.yml`:

```yaml
name: weekly-pipeline
on:
  schedule:
    - cron: "0 6 * * 2"   # Tuesdays 06:00 UTC, after weekend + Monday fixtures
  workflow_dispatch:        # manual trigger fallback

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - uses: actions/cache@v4
        with:
          path: ~/soccerdata
          key: soccerdata-${{ github.run_number }}
          restore-keys: soccerdata-
      - run: pip install -r pipeline/requirements.txt
      - run: python -m pipeline.src.main
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

Add the three secrets in repo Settings → Secrets → Actions.

## Step 1.6 — Seasonal continuity (build now, not later)
Three pieces make the pipeline run across seasons unattended. Build them in Phase 1 — retrofitting later means reworking ingestion. Maps to PRD §9.

**1. Dynamic season detection** — never hardcode the season:
```python
from datetime import date

def current_season(today: date | None = None) -> str:
    today = today or date.today()
    # EPL season spans Aug–May across two calendar years
    if today.month >= 8:
        return f"{today.year}-{(today.year + 1) % 100:02d}"     # e.g. 2026-27
    return f"{today.year - 1}-{today.year % 100:02d}"            # Jan–Jul → prior season

def previous_season(season: str) -> str:
    start = int(season.split("-")[0])
    return f"{start - 1}-{start % 100:02d}"

def seasons_to_fetch() -> list[str]:
    cur = current_season()
    return [previous_season(cur), cur]   # current + one prior for baseline depth
```
Wire `seasons_to_fetch()` into `ingest.py` so the weekly run auto-rolls into the new season every August with zero code change.

**2. Baseline carry-forward** — at season start, last season's posterior becomes this season's prior:
```python
def seed_new_season_priors(player_id, metric, new_season, as_of):
    prev = (sb.table("player_baselines")
            .select("gamma_alpha,gamma_beta")
            .eq("player_id", player_id).eq("metric", metric)
            .order("as_of_date", desc=True).limit(1).execute().data)
    if prev:  # carry forward the veteran's learned rate
        alpha0, beta0 = prev[0]["gamma_alpha"], prev[0]["gamma_beta"]
    else:     # new-to-EPL player → weakly informative prior, system withholds judgment
        alpha0, beta0 = 1.0, 1.0
    sb.table("player_baselines").upsert({
        "player_id": player_id, "metric": metric, "as_of_date": as_of,
        "gamma_alpha": alpha0, "gamma_beta": beta0,
    }, on_conflict="player_id,metric,as_of_date").execute()
```
The `player_baselines` schema already stores `gamma_alpha/beta` + `as_of_date`, so no migration needed.

**3. Pre-season squad refresh** — a separate workflow on an annual cron:
```yaml
# .github/workflows/preseason-refresh.yml
on:
  schedule: [{ cron: "0 6 20 7 *" }]   # July 20, 06:00 UTC
  workflow_dispatch:
```
The job syncs current rosters from FBref → updates `players.team`, then runs `seed_new_season_priors` for every (player, metric). January transfers need no special handling — the weekly upsert corrects `players.team` the first time a new match row arrives.

**✅ Checkpoint:** run pipeline locally → Supabase tables populated with two seasons; re-run → no duplicate rows; `current_season()` unit-tested across Jan/Jul/Aug boundaries; Actions `workflow_dispatch` run succeeds.

---

# PHASE 2 — Detection Engine (Week 3–4)

## Step 2.1 — Naive baseline (build first, it's your control)
`pipeline/src/detectors/naive.py`:

```python
import numpy as np

def zscore_flags(series_p90, window=10, recent=3, threshold=2.0):
    base = series_p90.rolling(window).agg(["mean","std"]).shift(recent)
    recent_avg = series_p90.rolling(recent).mean()
    z = (recent_avg - base["mean"]) / base["std"].replace(0, np.nan)
    return z.abs() >= threshold, z
```

Store its flags too — the methodology page compares both detectors.

## Step 2.2 — Detector A: Gamma-Poisson Bayesian
`pipeline/src/detectors/bayesian.py`:

```python
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
    beta  = beta0  + np.sum(weights * exposure)
    return alpha, beta

def recent_weights(n, halflife=RECENT_HALFLIFE):
    ages = np.arange(n - 1, -1, -1)          # most recent age 0
    return 0.5 ** (ages / halflife)

def credible_interval(alpha, beta, ci=CI):
    lo = stats.gamma.ppf((1-ci)/2, a=alpha, scale=1/beta)
    hi = stats.gamma.ppf(1-(1-ci)/2, a=alpha, scale=1/beta)
    return lo, hi

def kl_gamma(a1, b1, a2, b2):
    from scipy.special import gammaln, digamma
    return ((a1 - a2) * digamma(a1) - gammaln(a1) + gammaln(a2)
            + a2 * (np.log(b1) - np.log(b2)) + a1 * (b2 - b1) / b1)

def detect(counts, minutes, recent_n=6, kl_threshold=1.5):
    base_a, base_b = gamma_posterior(counts[:-recent_n], minutes[:-recent_n])
    w = recent_weights(recent_n)
    rec_a, rec_b = gamma_posterior(counts[-recent_n:], minutes[-recent_n:], weights=w)

    b_lo, b_hi = credible_interval(base_a, base_b)
    r_lo, r_hi = credible_interval(rec_a, rec_b)
    no_overlap = (r_hi < b_lo) or (r_lo > b_hi)
    kl = kl_gamma(rec_a, rec_b, base_a, base_b)

    direction = "down" if rec_a/rec_b < base_a/base_b else "up"
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
        "baseline_rate": float(base_a/base_b), "recent_rate": float(rec_a/rec_b),
    }
```

Run `detect()` per (player, metric) for: goals, shots, key_passes, progressive_passes — qualifying matches only.

## Step 2.3 — Detector B: change points
`pipeline/src/detectors/changepoint.py`:

```python
import ruptures as rpt
import numpy as np

MIN_SEGMENT = 4

def composite_index(df_player):
    cols = ["xg_p90","shots_p90","key_passes_p90","progressive_passes_p90"]
    z = (df_player[cols] - df_player[cols].mean()) / df_player[cols].std()
    return z.mean(axis=1).to_numpy()

def find_change_points(signal):
    if len(signal) < 2 * MIN_SEGMENT:
        return []
    algo = rpt.Pelt(model="rbf", min_size=MIN_SEGMENT).fit(signal.reshape(-1, 1))
    bkps = algo.predict(pen=5)   # tune pen via backtest
    return bkps[:-1]             # last element is series end, drop it
```

## Step 2.4 — Detector C: multivariate typing
`pipeline/src/detectors/multivariate.py`:

```python
import numpy as np
from sklearn.covariance import LedoitWolf
from sklearn.ensemble import IsolationForest

FEATURES = ["xg_p90","shots_p90","touches_att_box_p90",
            "progressive_passes_p90","key_passes_p90","goals_p90"]

def mahalanobis_profile(history, recent):
    lw = LedoitWolf().fit(history)
    diff = recent.mean(axis=0) - history.mean(axis=0)
    vi = np.linalg.inv(lw.covariance_)
    d = float(np.sqrt(diff @ vi @ diff))
    return d, diff   # diff vector = direction → drives typing

def league_isoforest(all_match_vectors):
    return IsolationForest(contamination=0.02, random_state=42).fit(all_match_vectors)
```

## Step 2.5 — Anomaly typing logic
`pipeline/src/scoring.py` — combine detector outputs:

```python
def classify(bayes_results, maha_diff):
    goals_down = bayes_results["goals"]["flagged"] and bayes_results["goals"]["direction"] == "down"
    xg_down    = bayes_results["xg_proxy_shots"]["flagged"] and bayes_results["xg_proxy_shots"]["direction"] == "down"
    goals_up   = bayes_results["goals"]["flagged"] and bayes_results["goals"]["direction"] == "up"

    if goals_down and xg_down:        return "FORM_COLLAPSE"
    if goals_down and not xg_down:    return "FINISHING_SLUMP"
    if goals_up and overperf_vs_xg(): return "OVERPERFORMANCE_RISK"
    if broad_uplift(bayes_results):   return "BREAKOUT"
    # WORKLOAD_SPIKE from minutes z-score; ROLE_CHANGE from changepoint + maha_diff shape
```

## Step 2.6 — FDR correction + severity
```python
from scipy.stats import false_discovery_control

def apply_fdr(p_values, q=0.10):
    adjusted = false_discovery_control(p_values, method="bh")
    return adjusted, adjusted <= q

def severity(kl, persistence_weeks, fdr_p):
    s = 40 * min(kl / 3, 1) + 30 * min(persistence_weeks / 3, 1) + 30 * (1 - min(fdr_p / 0.10, 1))
    return int(round(s))
```

## Step 2.7 — Backtest & tune (critical step)
1. Run the full engine on 2024-25 season only.
2. Manually list 10–15 **known** anomalies from that season (famous slumps, breakout players, regression cases — you know the league).
3. Check: did the engine flag them? At what severity? How many flags total per matchweek?
4. Tune: `kl_threshold`, PELT `pen`, FDR `q`, severity weights — target **5–15 active anomalies per matchweek** at severity ≥ 60.
5. Write results into `pipeline/BACKTEST.md` — this becomes methodology-page content.

**✅ Checkpoint:** backtest recall ≥ 70% on your known-anomaly list; weekly flag volume sane; unit tests pass (`pytest`).

---

# PHASE 3 — AI Narrative Layer (Week 5)

## Step 3.1 — OpenRouter call from pipeline
`pipeline/src/narrative.py`:

```python
import httpx, json, hashlib, os

MODEL = "google/gemini-2.5-flash"

SYSTEM = """You are a football analytics writer. Respond ONLY with valid JSON
matching the provided schema. No markdown, no preamble."""

def evidence_hash(evidence: dict) -> str:
    return hashlib.sha256(json.dumps(evidence, sort_keys=True).encode()).hexdigest()[:16]

def generate_insight(player, anomaly):
    prompt = build_prompt(player, anomaly)   # type, severity, evidence, last 6 matches
    r = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
        json={
            "model": MODEL,
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        },
        timeout=60,
    )
    text = r.json()["choices"][0]["message"]["content"]
    payload = json.loads(text.replace("```json", "").replace("```", "").strip())
    validate_insight(payload)   # jsonschema mirror of the Zod schema
    return payload
```

Rules (same caching pattern as Smart Finn Track `ai_insights`):
- Only generate for **severity ≥ 60**
- Skip if `ai_insights.evidence_hash` matches current anomaly evidence
- Validate against schema; on parse failure retry once, then store anomaly without insight (UI handles missing narrative gracefully)

## Step 3.2 — Prompt template
Include in the user prompt:
- Player: name, position, team, age
- Anomaly: type, severity, detectors fired
- Evidence: baseline vs recent rates + credible intervals per metric, change point date if any
- Last 6 match lines (opponent, minutes, goals, xG, shots)
- Instruction: explain in plain language first, technical second; `fantasyImplication` only for FINISHING_SLUMP / OVERPERFORMANCE_RISK / BREAKOUT

Iterate on 10 real anomalies from the backtest until narratives pass your eye test.

**✅ Checkpoint:** pipeline end-to-end run creates anomalies + cached insights; re-run regenerates nothing (hash match).

---

# PHASE 4 — Next.js Dashboard (Week 6–7)

## Step 4.1 — Scaffold
```bash
cd app
npx create-next-app@latest . --typescript --tailwind --app --eslint
npx shadcn@latest init
npx shadcn@latest add card badge table tabs select skeleton tooltip
npm i drizzle-orm postgres zod recharts @tanstack/react-table @tanstack/react-query sonner
npm i -D drizzle-kit
```

## Step 4.2 — Drizzle setup (read-only mirror of the SQL schema)
- `app/src/db/schema.ts` — mirror tables from Step 1.1
- Connect with the Supabase **connection pooler** URL (port 6543, `?pgbouncer=true`) and the **anon-safe** approach: since RLS allows public reads only, the app uses a read-only connection string; never ship the service key in `app/`
- `drizzle.config.ts` → introspect existing DB: `npx drizzle-kit pull` (schema already exists; Drizzle just mirrors it)

## Step 4.3 — Type definitions
`app/src/types/insight.ts` — the Zod schema for `AnomalyInsight` (PRD §6.2). Parse every `ai_insights.payload` through it before rendering; render a fallback card on parse failure.

## Step 4.4 — Pages (build in this order)
1. **`/` Anomaly feed** — Server Component query: active anomalies, severity ≥ 60 default, joined with player + latest insight headline. Filters (type, team, severity) via URL search params. `AnomalyCard` shows: player photo, type badge (color-coded), severity, headline.
2. **`/anomaly/[id]` Detail** — the Smart Finn Track pattern:
   - `InsightNarrative` (summary + technical explanation + outlook)
   - `BaselineVsRecentBars` — one row per `keyEvidence` metric, Recharts horizontal bars, baseline (muted) vs recent (colored by direction)
   - Posterior visualization: two Gamma density curves (compute points server-side or precompute in pipeline evidence)
   - `TriggeredMatchesList` — TanStack Table of the recent-window matches
3. **`/player/[id]` Timeline** — `FormTimelineChart`: Recharts LineChart of composite index per match, `ReferenceLine` vertical markers at change points, anomaly badges along the x-axis; anomaly history list below.
4. **`/leaderboards`** — three tabs (Overperformers / Breakouts / Regression watch), TanStack Table with sorting.
5. **`/methodology`** — MDX or long-form page: naive z-score vs Bayesian comparison with the backtest numbers, FDR explanation, live linked examples. Write it like a blog post — this is the recruiter page.

## Step 4.5 — Performance & caching
- All data pages are Server Components with `export const revalidate = 3600` (data changes weekly; hourly ISR is plenty)
- TanStack Query only for client-side filter interactivity
- `loading.tsx` skeletons per route; empty states for "no anomalies this week"

**✅ Checkpoint:** all five routes render real data locally; insight payloads validated by Zod; Lighthouse LCP < 2.5s on feed.

---

# PHASE 5 — Deploy & Portfolio Polish (Week 8)

## Step 5.1 — Deploy
1. Vercel → import repo, root directory `app/`
2. Env vars: read-only `DATABASE_URL` (pooler)
3. Confirm ISR works in production

## Step 5.2 — Operations
- Add a tiny status footer reading `pipeline_runs` (last run time + status) — shows the system is alive
- GitHub Actions: enable failure email notifications
- Calendar reminder: free-tier check monthly (Supabase pauses inactive projects after 7 days of zero activity — the weekly cron prevents this naturally)

## Step 5.3 — Portfolio packaging
- **README.md**: architecture diagram (pipeline → DB → app), methodology summary, screenshots, "what I'd do with more time"
- OG image per anomaly page (Vercel OG, free) — shared links look professional
- Short demo video/GIF of the anomaly detail page
- Link FormWatch from your portfolio site alongside Smart Finn Track — together they tell the "structured AI insights" story

**✅ Final checkpoint:** weekly cron runs unattended for two consecutive matchweeks with fresh anomalies appearing on production. Then it's done.

---

# Build Order Summary (single list)

1. Accounts + repo + Python env
2. SQL schema + RLS in Supabase
3. Ingest 2 seasons via soccerdata → upsert to DB
4. Transform rules (per-90, qualifying, opponent adjustment)
5. GitHub Actions cron working end-to-end (ingest only)
6. Seasonal continuity: dynamic season detection + baseline carry-forward + pre-season squad refresh
7. Naive z-score detector
8. Bayesian Gamma-Poisson detector
9. Change point detector
10. Multivariate typing + severity + FDR
11. Backtest on last season → tune thresholds → BACKTEST.md
12. OpenRouter narrative generation + evidence-hash caching
13. Next.js scaffold + Drizzle introspection + Zod types
14. Anomaly feed page
15. Anomaly detail page (comparison bars, posteriors, matches list)
16. Player timeline page
17. Leaderboards
18. Methodology page
19. Deploy + ops + README + portfolio packaging

---

# Risk Quick-Reference

| If this happens | Do this |
|---|---|
| FBref rate-limits Actions runner | Increase soccerdata delay config; rely on actions/cache; fall back to Understat for core metrics |
| `ruptures` flags too many change points | Raise `pen` parameter; require min 4-match segments (already set) |
| Too many anomalies per week | Raise KL threshold or severity display floor; tighten FDR q to 0.05 |
| Gemini returns invalid JSON | Already handled: strip fences → retry once → graceful fallback card |
| Supabase project pauses | Weekly cron writes keep it active; manual dispatch revives it |
