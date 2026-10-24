import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTournamentResult, rankTier, tournamentRanks } from '../src/tournament-ranks.js';

test('initial account Elo placement stops at Gold', () => {
  assert.equal(rankTier(1349), 'Bronze');
  assert.equal(rankTier(1350), 'Silver');
  assert.equal(rankTier(1599), 'Silver');
  assert.equal(rankTier(1600), 'Gold');
  assert.equal(rankTier(2400), 'Gold');
});

test('each rank promotes at its configured star threshold', () => {
  assert.deepEqual(applyTournamentResult('Bronze', 9, 0, 1), { tier: 'Silver', stars: 0, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Silver', 19, 0, 1), { tier: 'Gold', stars: 0, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Gold', 29, 0, 1), { tier: 'Master', stars: 0, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Master', 39, 0, 1), { tier: 'Challenger', stars: 0, seasonPoints: 0 });
});

test('demotion gives half of the new rank promotion threshold', () => {
  assert.deepEqual(applyTournamentResult('Gold', 0, 0, 0), { tier: 'Silver', stars: 10, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Master', 0, 0, 0), { tier: 'Gold', stars: 15, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Challenger', 0, 7, 0), { tier: 'Master', stars: 20, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Bronze', 0, 0, 0), { tier: 'Bronze', stars: 0, seasonPoints: 0 });
});

test('Challenger points and stars track wins and losses independently', () => {
  assert.deepEqual(applyTournamentResult('Challenger', 3, 4, 1), { tier: 'Challenger', stars: 4, seasonPoints: 5 });
  assert.deepEqual(applyTournamentResult('Challenger', 3, 4, 0), { tier: 'Challenger', stars: 2, seasonPoints: 3 });
  assert.deepEqual(applyTournamentResult('Challenger', 1, 0, 0), { tier: 'Challenger', stars: 0, seasonPoints: 0 });
  assert.deepEqual(applyTournamentResult('Silver', 4, 0, 0.5), { tier: 'Silver', stars: 4, seasonPoints: 0 });
});

test('rank metadata exposes the promotion threshold for the UI', () => {
  assert.deepEqual(tournamentRanks().map(rank => rank.starsToPromote), [10, 20, 30, 40, 40]);
});
