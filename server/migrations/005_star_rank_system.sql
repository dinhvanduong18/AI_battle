ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS rank_stars INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS season_points INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_tier_check;
UPDATE tournament_entries SET tier=CASE
  WHEN tier IN ('Bronze','Silver','Gold','Master','Challenger') THEN tier
  ELSE 'Master'
END;
ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_tier_check
  CHECK (tier IN ('Bronze','Silver','Gold','Master','Challenger'));
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_rank_stars_check;
ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_rank_stars_check
  CHECK (rank_stars BETWEEN 0 AND 5);

CREATE INDEX IF NOT EXISTS tournament_entries_rank_stars_idx
  ON tournament_entries(tournament_id, tier, rank_stars DESC);
