-- migration 002 — switch data source from FBref to Understat
-- FBref permanently removed all Opta-provided advanced stats (xG, xA, key
-- passes, progressive passes/carries, touches) in January 2026. The pipeline
-- now ingests from Understat, which provides per-match player xG, xA, key
-- passes, and the buildup-involvement metrics xGChain/xGBuildup.

alter table players rename column fbref_id to understat_id;
alter table matches rename column fbref_id to understat_id;

-- Opta-exclusive metrics; no longer available from any free source.
alter table player_match_stats drop column progressive_passes;
alter table player_match_stats drop column progressive_carries;
alter table player_match_stats drop column touches_att_box;

-- Understat's buildup-involvement metrics replace the progressive-volume signal.
alter table player_match_stats add column xg_chain numeric default 0;
alter table player_match_stats add column xg_buildup numeric default 0;

-- migration 002 complete
