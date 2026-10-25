UPDATE matches m
SET match_type = 'bot'
FROM match_results r
WHERE r.match_id = m.id
  AND m.match_type = 'human'
  AND m.tournament_id IS NULL
  AND (
    r.player1_elo_before <> r.player1_elo_after
    OR r.player2_elo_before <> r.player2_elo_after
  );
