ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rules_schedule JSONB NOT NULL
  DEFAULT '["standard", "center_blockers", "clipped_corners", "corridor"]'::jsonb;
