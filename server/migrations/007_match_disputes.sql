CREATE TABLE IF NOT EXISTS match_disputes (
  match_id UUID PRIMARY KEY REFERENCES matches(id),
  claimant_id UUID NOT NULL REFERENCES users(id),
  evidence JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('adjudicated', 'unresolved')),
  offender_id UUID REFERENCES users(id),
  winner_id UUID REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
