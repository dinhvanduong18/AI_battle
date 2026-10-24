CREATE TABLE IF NOT EXISTS user_bot_versions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  code TEXT NOT NULL,
  code_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, version)
);

DELETE FROM user_bot_versions older
USING user_bot_versions newer
WHERE older.user_id=newer.user_id AND older.version<newer.version;
CREATE UNIQUE INDEX IF NOT EXISTS user_bot_versions_one_bot_per_user ON user_bot_versions(user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS active_bot_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_pkey;
ALTER TABLE tournament_entries ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS player_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS bot_version INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS tournament_entries_team_unique ON tournament_entries(tournament_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tournament_entries_player_unique ON tournament_entries(tournament_id, player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tournament_entries_player_rank_idx ON tournament_entries(tournament_id, tier, points DESC, tournament_elo DESC) WHERE player_id IS NOT NULL;
ALTER TABLE tournament_entries DROP CONSTRAINT IF EXISTS tournament_entries_one_participant_check;
ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_one_participant_check
  CHECK (num_nonnulls(team_id, player_id) = 1) NOT VALID;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS player1_bot_code TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS player2_bot_code TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS player1_bot_sha256 CHAR(64);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS player2_bot_sha256 CHAR(64);
