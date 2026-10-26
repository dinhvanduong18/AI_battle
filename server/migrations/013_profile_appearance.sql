ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_background_id TEXT NOT NULL DEFAULT 'castle';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_profile_background_id_check;
ALTER TABLE users ADD CONSTRAINT users_profile_background_id_check
  CHECK (profile_background_id IN (
    'castle', 'moonlight', 'emerald', 'ocean', 'sunset', 'aurora', 'crimson', 'ice'
  ));
