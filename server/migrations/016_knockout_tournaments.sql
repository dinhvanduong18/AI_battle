ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS join_code TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS knockout_data JSONB;

ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_format_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_format_check
  CHECK (format IN ('ranked_weekly', 'knockout'));

CREATE UNIQUE INDEX IF NOT EXISTS tournaments_join_code_unique
  ON tournaments(join_code) WHERE join_code IS NOT NULL;

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_tournament_phase_check;
ALTER TABLE matches ADD CONSTRAINT matches_tournament_phase_check
  CHECK (tournament_phase IS NULL OR tournament_phase IN ('practice', 'ranked', 'knockout'));
