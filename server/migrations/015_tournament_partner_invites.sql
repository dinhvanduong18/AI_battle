CREATE TABLE IF NOT EXISTS tournament_partner_invites (
  token_hash CHAR(64) PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  captain_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tournament_partner_invites_captain_idx
  ON tournament_partner_invites(tournament_id, captain_id, created_at DESC);
