ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_status_check
  CHECK (status IN (
    'scheduled', 'registration', 'grouping', 'group_stage', 'group_running',
    'group_complete', 'knockout', 'qualifying', 'completed', 'cancelled'
  ));

UPDATE tournaments
SET status='group_running'
WHERE format='group_knockout' AND status='group_stage';
