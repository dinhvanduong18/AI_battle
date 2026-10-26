ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id TEXT NOT NULL DEFAULT 'pumpkin';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_avatar_id_check;
ALTER TABLE users ADD CONSTRAINT users_avatar_id_check
  CHECK (avatar_id IN (
    'pumpkin', 'ghost', 'bat', 'knight', 'fox', 'crown',
    'dragon', 'cat', 'wizard', 'alien', 'skull', 'robot', 'spider', 'unicorn'
  ));
