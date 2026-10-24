export const TOURNAMENT_RANKS = ['Bronze', 'Silver', 'Gold', 'Master', 'Challenger'];

const RANK_LABELS = {
  Bronze: 'Đồng',
  Silver: 'Bạc',
  Gold: 'Vàng',
  Master: 'Cao Thủ',
  Challenger: 'Thách Đấu'
};

export const RANK_PROMOTION_STARS = {
  Bronze: 10,
  Silver: 20,
  Gold: 30,
  Master: 40,
  Challenger: 40
};

export function rankTier(elo) {
  if (elo >= 1600) return 'Gold';
  if (elo >= 1350) return 'Silver';
  return 'Bronze';
}

export function applyTournamentResult(tier, stars, seasonPoints, score) {
  const rankIndex = TOURNAMENT_RANKS.indexOf(tier);
  if (rankIndex < 0) throw new Error(`Unknown tournament rank: ${tier}`);
  if (!Number.isInteger(stars) || stars < 0 || stars > RANK_PROMOTION_STARS[tier]) {
    throw new RangeError(`Invalid star progress for rank ${tier}: ${stars}`);
  }
  if (![0, 0.5, 1].includes(score)) throw new RangeError(`Invalid tournament score: ${score}`);

  let nextTier = tier;
  let nextStars = stars;
  let nextPoints = seasonPoints;

  if (score === 1) {
    if (tier === 'Challenger') {
      nextStars = Math.min(RANK_PROMOTION_STARS.Challenger, stars + 1);
      nextPoints += 1;
    } else if (stars + 1 >= RANK_PROMOTION_STARS[tier]) {
      nextTier = TOURNAMENT_RANKS[rankIndex + 1];
      nextStars = 0;
      if (nextTier === 'Challenger') nextPoints = 0;
    } else {
      nextStars += 1;
    }
  } else if (score === 0) {
    if (stars > 0) {
      nextStars -= 1;
      if (tier === 'Challenger') nextPoints = Math.max(0, seasonPoints - 1);
    } else if (rankIndex > 0) {
      nextTier = TOURNAMENT_RANKS[rankIndex - 1];
      nextStars = Math.floor(RANK_PROMOTION_STARS[nextTier] / 2);
      if (tier === 'Challenger') nextPoints = 0;
    }
  }

  return { tier: nextTier, stars: nextStars, seasonPoints: nextPoints };
}

export function tournamentRanks() {
  return TOURNAMENT_RANKS.map((tier, index) => ({
    tier, label: RANK_LABELS[tier], index, starsToPromote: RANK_PROMOTION_STARS[tier]
  }));
}

export function formatTournamentStandings(rows) {
  return rows.map(row => ({
    player_id: row.playerId,
    display_name: row.displayName,
    tier: row.tier,
    rank_stars: row.stars,
    season_points: row.seasonPoints,
    matches_played: row.matchesPlayed,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses
  }));
}
