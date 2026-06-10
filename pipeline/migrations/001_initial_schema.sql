-- migration 001 — initial schema
-- FormWatch Supabase PostgreSQL schema (matches PRD §7 / Implementation Guide Step 1.1)

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

-- Indexes for the most common query patterns
create index on player_match_stats (player_id);
create index on player_match_stats (match_id);
create index on anomalies (player_id, detected_at desc);
create index on anomalies (status, severity desc);
create index on player_baselines (player_id, metric, as_of_date desc);

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
-- player_baselines and pipeline_runs are pipeline-internal: no RLS, no public access.

-- migration 001 complete
