ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'human';

-- Tournament games always run submitted bots. Preserve that classification for
-- matches created before match_type was introduced.
UPDATE matches SET match_type='bot' WHERE tournament_id IS NOT NULL AND match_type='human';

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_match_type_check;
ALTER TABLE matches ADD CONSTRAINT matches_match_type_check CHECK (match_type IN ('human', 'bot'));
