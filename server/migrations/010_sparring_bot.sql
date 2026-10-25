ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_sparring BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO users (id, email, password_hash, display_name, elo, avatar_id, is_admin)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'guardian@ottv2.local',
  'system-account-not-for-login',
  'Hắc Kỵ Sĩ AI (Sparring)',
  1320,
  'knight',
  FALSE
)
ON CONFLICT DO NOTHING;
