import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySprintRankReset,
  applyTournamentResult,
  buildTournamentMotivation,
  fromCumulativeScore,
  rankTier,
  toCumulativeScore,
  tournamentRanks,
  RANK_BOSS_CONFIG,
  applyBossResult,
  applyRankedMatchResult,
} from '../src/tournament-ranks.js';

test('initial account Elo placement maps <1350 Bronze, 1350-1599 Silver, >=1600 Gold', () => {
  assert.equal(rankTier(1200), 'Bronze');
  assert.equal(rankTier(1349), 'Bronze');
  assert.equal(rankTier(1350), 'Silver');
  assert.equal(rankTier(1599), 'Silver');
  assert.equal(rankTier(1600), 'Gold');
  assert.equal(rankTier(2400), 'Gold');
});

test('rank metadata exposes 10-20-30-40-0 promotion star ladder', () => {
  assert.deepEqual(
    tournamentRanks().map((rank) => rank.starsToPromote),
    [10, 20, 30, 40, 0]
  );
});

test('cumulative score round-trips cleanly across all tiers', () => {
  assert.equal(toCumulativeScore('Bronze', 0, 0), 0);
  assert.equal(toCumulativeScore('Silver', 0, 0), 10);
  assert.equal(toCumulativeScore('Gold', 7, 0), 37);
  assert.equal(toCumulativeScore('Master', 39, 0), 99);
  assert.equal(toCumulativeScore('Challenger', 0, 25), 125);

  assert.deepEqual(fromCumulativeScore(24), { tier: 'Silver', stars: 14, seasonPoints: 0 });
  assert.deepEqual(fromCumulativeScore(100), { tier: 'Challenger', stars: 0, seasonPoints: 0 });
  assert.deepEqual(fromCumulativeScore(118), { tier: 'Challenger', stars: 0, seasonPoints: 18 });
});

test('per-match star rules: Win +1, Draw 0, Loss -1 with clean promotion and demotion', () => {
  // Promotions at 10, 20, 30, 40
  assert.deepEqual(applyTournamentResult('Bronze', 9, 0, 1), { tier: 'Silver', stars: 0, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Silver', 19, 0, 1), { tier: 'Gold', stars: 0, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Gold', 29, 0, 1), { tier: 'Master', stars: 0, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Master', 39, 0, 1), { tier: 'Challenger', stars: 0, seasonPoints: 0 });

  // Draws award 0 stars / 0 points
  assert.deepEqual(applyTournamentResult('Silver', 4, 0, 0.5), { tier: 'Silver', stars: 4, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Challenger', 0, 8, 0.5), {
    tier: 'Challenger',
    stars: 0,
    seasonPoints: 8,
  });

  // Losses subtract 1 star and demote cleanly across boundaries (floored at Bronze 0)
  assert.deepEqual(applyTournamentResult('Bronze', 0, 0, 0), { tier: 'Bronze', stars: 0, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Silver', 0, 0, 0), { tier: 'Bronze', stars: 9, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Gold', 0, 0, 0), { tier: 'Silver', stars: 19, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Master', 0, 0, 0), { tier: 'Gold', stars: 29, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Challenger', 0, 0, 0), { tier: 'Master', stars: 39, seasonPoints: 0 });

  // Challenger wins/losses update seasonPoints directly
  assert.deepEqual(applyTournamentResult('Challenger', 0, 4, 1), {
    tier: 'Challenger',
    stars: 0,
    seasonPoints: 5,
  });
  assert.deepEqual(applyTournamentResult('Challenger', 0, 4, 0), {
    tier: 'Challenger',
    stars: 0,
    seasonPoints: 3,
  });
});

test('weekly Sprint rank reset applies x - x * (x / (x + k)) with k = 2 * x_max', () => {
  // 1. Khi người được xét chính là người có điểm cao nhất (x = x_max, k = 2x):
  // Gold 7 stars -> x = 37, k = 74 -> resetTotal = floor(37 - 37 * (37 / 111)) = floor(37 * 2 / 3) = 24 -> Silver 14 stars
  assert.deepEqual(applySprintRankReset('Gold', 7, 0), {
    tier: 'Silver',
    stars: 14,
    seasonPoints: 0,
    previousTotal: 37,
    resetTotal: 24,
    k: 74,
    maxTotalScore: 37,
  });

  // Challenger with 35 points (x = 135, k = 270) -> 135 - 135 * (135/405) = 90 -> Master 30 stars
  assert.deepEqual(applySprintRankReset('Challenger', 0, 35), {
    tier: 'Master',
    stars: 30,
    seasonPoints: 0,
    previousTotal: 135,
    resetTotal: 90,
    k: 270,
    maxTotalScore: 135,
  });

  // 2. Khi có bảng xếp hạng giải đấu với x_max = 100 (k = 200):
  // - Top 1 (x = 100): reset = floor(100 - 100 * (100 / 300)) = floor(66.666) = 66 -> Master 6 stars
  assert.deepEqual(applySprintRankReset('Master', 40, 0, 100), {
    tier: 'Master',
    stars: 6,
    seasonPoints: 0,
    previousTotal: 100,
    resetTotal: 66,
    k: 200,
    maxTotalScore: 100,
  });

  // - Người chơi hạng dưới (x = 50, tức Gold 20 stars):
  //   reset = floor(50 - 50 * (50 / 250)) = floor(50 - 10) = 40 (giữ được 80% điểm số) -> Gold 10 stars
  assert.deepEqual(applySprintRankReset('Gold', 20, 0, 100), {
    tier: 'Gold',
    stars: 10,
    seasonPoints: 0,
    previousTotal: 50,
    resetTotal: 40,
    k: 200,
    maxTotalScore: 100,
  });

  // - Người chơi mới (x = 10, tức Silver 0 stars):
  //   reset = floor(10 - 10 * (10 / 210)) = floor(10 - 0.476) = 9 -> Bronze 9 stars
  assert.deepEqual(applySprintRankReset('Silver', 0, 0, 100), {
    tier: 'Bronze',
    stars: 9,
    seasonPoints: 0,
    previousTotal: 10,
    resetTotal: 9,
    k: 200,
    maxTotalScore: 100,
  });
});

test('motivational and competitive ego banners cover all 4 sub-Challenger tiers and 4 Challenger brackets', () => {
  assert.equal(buildTournamentMotivation(null).bracket, 'unregistered');
  assert.equal(buildTournamentMotivation({ tier: 'Bronze', rank_stars: 3 }).bracket, 'bronze');
  assert.equal(buildTournamentMotivation({ tier: 'Silver', rank_stars: 11 }).bracket, 'silver');
  assert.equal(buildTournamentMotivation({ tier: 'Gold', rank_stars: 7 }).bracket, 'gold');
  assert.equal(buildTournamentMotivation({ tier: 'Master', rank_stars: 22 }).bracket, 'master');

  // Challenger 4 brackets: Top 7 (1..7), Outside Top 7 (8..12), Outside Top 12 (13..20), Outside Top 20 / Top 30 (21+)
  assert.equal(buildTournamentMotivation({ tier: 'Challenger', season_points: 50 }, 1).bracket, 'top_7');
  assert.equal(buildTournamentMotivation({ tier: 'Challenger', season_points: 42 }, 7).bracket, 'top_7');
  assert.equal(buildTournamentMotivation({ tier: 'Challenger', season_points: 30 }, 8).bracket, 'outside_top_7');
  assert.equal(buildTournamentMotivation({ tier: 'Challenger', season_points: 25 }, 12).bracket, 'outside_top_7');
  assert.equal(buildTournamentMotivation({ tier: 'Challenger', season_points: 18 }, 13).bracket, 'outside_top_12');
  assert.equal(buildTournamentMotivation({ tier: 'Challenger', season_points: 12 }, 20).bracket, 'outside_top_12');
  assert.equal(buildTournamentMotivation({ tier: 'Challenger', season_points: 3 }, 21).bracket, 'outside_top_20');
  assert.equal(buildTournamentMotivation({ tier: 'Challenger', season_points: 0 }, 30).bracket, 'outside_top_20');
});


test('Rank Boss Challenge rules: Pass promotes to next tier with 0 stars; Fail reduces 2/3 of current stars', () => {
  // 1. Bronze (10 stars) vs Boss 1:
  // Win -> Silver 0 stars
  assert.deepEqual(applyBossResult('Bronze', 10, 1), {
    tier: 'Silver',
    stars: 0,
    seasonPoints: 0,
    passed: true,
    promotedTo: 'Silver',
    message: 'Xuất sắc vượt qua Boss thăng hạng! Bạn đã chính thức bước lên bậc Bạc!'
  });
  // Fail -> floor(10 * 2 / 3) = 6 stars
  assert.deepEqual(applyBossResult('Bronze', 10, 0), {
    tier: 'Bronze',
    stars: 6,
    seasonPoints: 0,
    passed: false,
    promotedTo: null,
    message: 'Khiêu chiến thất bại! Bạn bị trừ 2/3 số sao hiện tại (còn 6 sao). Hãy tiếp tục rèn luyện để thách đấu lại!'
  });

  // 2. Gold (30 stars) vs Boss 3 (User example):
  // Win -> Master 0 stars
  assert.deepEqual(applyBossResult('Gold', 30, 1), {
    tier: 'Master',
    stars: 0,
    seasonPoints: 0,
    passed: true,
    promotedTo: 'Master',
    message: 'Xuất sắc vượt qua Boss thăng hạng! Bạn đã chính thức bước lên bậc Cao Thủ!'
  });
  // Fail -> floor(30 * 2 / 3) = 20 stars
  assert.deepEqual(applyBossResult('Gold', 30, 0), {
    tier: 'Gold',
    stars: 20,
    seasonPoints: 0,
    passed: false,
    promotedTo: null,
    message: 'Khiêu chiến thất bại! Bạn bị trừ 2/3 số sao hiện tại (còn 20 sao). Hãy tiếp tục rèn luyện để thách đấu lại!'
  });

  // 3. Silver (20 stars) vs Boss 2:
  // Fail -> floor(20 * 2 / 3) = 13 stars
  assert.equal(applyBossResult('Silver', 20, 0).stars, 13);

  // 4. Master (40 stars) vs Boss 4:
  // Fail -> floor(40 * 2 / 3) = 26 stars
  assert.equal(applyBossResult('Master', 40, 0).stars, 26);
});

test('applyRankedMatchResult caps stars at promotion threshold and requires boss challenge', () => {
  // Gold at 29 stars wins -> reaches 30 stars, does not auto promote to Master
  const res = applyRankedMatchResult('Gold', 29, 0, 1);
  assert.equal(res.tier, 'Gold');
  assert.equal(res.stars, 30);
  assert.equal(res.canChallengeBoss, true);

  // Gold at 30 stars wins another regular match -> still 30 stars (capped)
  const res2 = applyRankedMatchResult('Gold', 30, 0, 1);
  assert.equal(res2.tier, 'Gold');
  assert.equal(res2.stars, 30);
  assert.equal(res2.canChallengeBoss, true);

  // Gold at 30 stars loses regular match -> 29 stars
  const res3 = applyRankedMatchResult('Gold', 30, 0, 0);
  assert.equal(res3.tier, 'Gold');
  assert.equal(res3.stars, 29);
  assert.equal(res3.canChallengeBoss, false);
});
