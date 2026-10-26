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

test('weekly Sprint rank reset applies floor((cumulativeTotal * 2) / 3)', () => {
  // User-specified exact example: Gold 7 stars -> (10 + 20 + 7) + 0 = 37 -> floor(37 * 2 / 3) = 24 -> Silver 14 stars
  assert.deepEqual(applySprintRankReset('Gold', 7, 0), {
    tier: 'Silver',
    stars: 14,
    seasonPoints: 0,
    previousTotal: 37,
    resetTotal: 24,
  });

  // Challenger with 35 points -> 135 * 2 / 3 = 90 -> Master 30 stars
  assert.deepEqual(applySprintRankReset('Challenger', 0, 35), {
    tier: 'Master',
    stars: 30,
    seasonPoints: 0,
    previousTotal: 135,
    resetTotal: 90,
  });

  // High Challenger with 80 points -> 180 * 2 / 3 = 120 -> Challenger 20 points
  assert.deepEqual(applySprintRankReset('Challenger', 0, 80), {
    tier: 'Challenger',
    stars: 0,
    seasonPoints: 20,
    previousTotal: 180,
    resetTotal: 120,
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
