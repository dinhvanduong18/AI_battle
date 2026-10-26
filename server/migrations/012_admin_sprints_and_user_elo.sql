ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS total_sprints INTEGER NOT NULL DEFAULT 4;
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_total_sprints_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_total_sprints_check
  CHECK (total_sprints BETWEEN 1 AND 52);

DROP INDEX IF EXISTS tournament_entries_rank_idx;
DROP INDEX IF EXISTS tournament_entries_player_rank_idx;
ALTER TABLE tournament_entries DROP COLUMN IF EXISTS tournament_elo;

CREATE INDEX IF NOT EXISTS tournament_entries_rank_idx
  ON tournament_entries(tournament_id, points DESC);
CREATE INDEX IF NOT EXISTS tournament_entries_player_rank_idx
  ON tournament_entries(tournament_id, tier, points DESC)
  WHERE player_id IS NOT NULL;
