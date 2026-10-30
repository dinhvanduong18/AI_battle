import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTournamentRules,
  calculateGroupStandings,
  createDoubleRoundRobinFixtures,
  createKnockoutOpeningRound,
  createNextKnockoutRound,
  distributeTournamentGroups,
} from '../src/tournament-format.js';

function entries(count, groupNumber = 1) {
  return Array.from({ length: count }, (_, index) => ({
    player_id: `player-${index + 1}`,
    group_number: groupNumber,
    registered_at: new Date(index).toISOString(),
  }));
}

function entriesWithElo(count) {
  return Array.from({ length: count }, (_, index) => ({
    player_id: `player-${index + 1}`,
    elo: 1000 + Math.floor((index * 1200) / count), // Elo từ 1000 đến ~2200
    registered_at: new Date(index * 1000).toISOString(),
  }));
}

test('validates custom square-board obstacles and 25-move scoring', () => {
  assert.equal(buildTournamentRules([], 'standard').moveLimit, undefined);
  assert.equal(buildTournamentRules([], 'standard').moveLimitRule, 'standard');
  assert.deepEqual(buildTournamentRules([40, 20, 40], 'remaining-pieces'), {
    id: 'group-knockout-custom',
    title: 'Giải đấu bảng + knock-out',
    week: 1,
    rows: 9,
    cols: 9,
    blockedCells: [20, 40],
    moveLimit: 25,
    moveLimitRule: 'remaining-pieces',
  });
  assert.throws(() => buildTournamentRules([8], 'remaining-pieces'), /ô đích/);
  assert.throws(() => buildTournamentRules([1], 'remaining-pieces'), /đối xứng/);
  assert.deepEqual(
    buildTournamentRules([], 'captured-points', { rock: 4, paper: 2, scissors: 7 }).capturedPieceValues,
    { rock: 4, paper: 2, scissors: 7 }
  );
  assert.throws(
    () => buildTournamentRules([], 'captured-points', { rock: 0, paper: 2, scissors: 3 }),
    /từ 1 đến 100/
  );
  assert.throws(() => buildTournamentRules(
    Array.from({ length: 81 }, (_, index) => index).filter((index) => ![8, 72].includes(index)),
    'goal-distance'
  ));
  assert.throws(() => buildTournamentRules([], 'random'), /luật xử lý/);
});

test('distributes a balanced field into the requested number of groups (random fallback)', () => {
  const field = entries(19);
  let next = 0;
  const groups = distributeTournamentGroups(field, 8, (_min, max) => next++ % max);
  assert.equal(groups.length, 8);
  assert.deepEqual(groups.map((group) => group.entrants.length).sort(), [2, 2, 2, 2, 2, 3, 3, 3]);
  assert.equal(new Set(groups.flatMap((group) => group.entrants.map((entry) => entry.player_id))).size, 19);
  const sixtyPlayerGroups = distributeTournamentGroups(entries(60), 8);
  assert.deepEqual(
    sixtyPlayerGroups.map((group) => group.entrants.length).sort(),
    [7, 7, 7, 7, 8, 8, 8, 8]
  );
  assert.throws(() => distributeTournamentGroups(entries(15), 8), /tối thiểu 16/);
  const largeFieldGroups = distributeTournamentGroups(entries(100), 8);
  assert.deepEqual(
    largeFieldGroups.map((group) => group.entrants.length).sort((a, b) => a - b),
    [12, 12, 12, 12, 13, 13, 13, 13]
  );
});

test('distributes 8 groups sorted by Elo tiers with minimal gap within each group', () => {
  const field = entriesWithElo(64); // 64 đấu thủ với Elo từ 1000 đến 2181
  const groups = distributeTournamentGroups(field, 8);

  assert.equal(groups.length, 8);
  // Mỗi bảng phải có chính xác 8 đấu thủ
  for (const group of groups) {
    assert.equal(group.entrants.length, 8);
  }

  // Bảng 1 phải có Elo trung bình cao nhất, Bảng 8 thấp nhất
  for (let i = 0; i < 7; i++) {
    assert.ok(
      groups[i].avgElo >= groups[i + 1].avgElo,
      `Bảng ${i + 1} (${groups[i].avgElo}) phải có Elo >= Bảng ${i + 2} (${groups[i + 1].avgElo})`
    );
    assert.ok(
      groups[i].minElo >= groups[i + 1].maxElo,
      `Min Elo Bảng ${i + 1} (${groups[i].minElo}) phải >= Max Elo Bảng ${i + 2} (${groups[i + 1].maxElo})`
    );
  }

  // Chênh lệch Elo trong mỗi bảng không quá lớn (trong 64 người chia 8 bảng, mỗi bảng spread ~ 150 điểm)
  for (const group of groups) {
    const gap = group.maxElo - group.minElo;
    assert.ok(gap <= 200, `Bảng ${group.number} có chênh lệch Elo ${gap} <= 200`);
  }
});

test('creates a two-leg round robin without double-booking players in a round', () => {
  const fixtures = createDoubleRoundRobinFixtures([
    { number: 1, entrants: entries(5) },
  ]);
  assert.equal(fixtures.length, 20);
  const pairCounts = new Map();
  for (const fixture of fixtures) {
    const key = [fixture.player1Id, fixture.player2Id].sort().join(':');
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  assert.ok([...pairCounts.values()].every((count) => count === 2));
  for (const round of new Set(fixtures.map((fixture) => fixture.roundNumber))) {
    const participants = fixtures
      .filter((fixture) => fixture.roundNumber === round)
      .flatMap((fixture) => [fixture.player1Id, fixture.player2Id]);
    assert.equal(new Set(participants).size, participants.length);
  }
});

test('ranks group players by points then loss-minus-win move differential', () => {
  const players = entries(3);
  const standings = calculateGroupStandings(players, [
    { player1_id: 'player-1', player2_id: 'player-2', winner_id: 'player-1', move_count: 20, status: 'completed' },
    { player1_id: 'player-2', player2_id: 'player-1', winner_id: null, move_count: 25, status: 'completed' },
    { player1_id: 'player-1', player2_id: 'player-3', winner_id: 'player-3', move_count: 25, status: 'completed' },
    { player1_id: 'player-2', player2_id: 'player-3', winner_id: 'player-2', move_count: 15, status: 'completed' },
    { player1_id: 'player-1', player2_id: 'player-2', winner_id: 'player-2', move_count: 100, phase: 'knockout', status: 'completed' },
  ]);
  assert.deepEqual(standings.map((row) => [row.player_id, row.points, row.moveDifference]), [
    ['player-1', 4, 5],
    ['player-2', 4, 5],
    ['player-3', 3, -10],
  ]);
});

test('pairs each group winner with another group runner-up and advances bracket rounds', () => {
  const field = Array.from({ length: 16 }, (_, index) => ({
    player_id: `player-${index + 1}`,
    group_number: Math.floor(index / 2) + 1,
    registered_at: new Date(index).toISOString(),
  }));
  const opening = createKnockoutOpeningRound(field);
  assert.equal(opening.length, 8);
  assert.equal(opening[0].player1Id, 'player-1');
  assert.equal(opening[0].player2Id, 'player-4');
  assert.equal(opening[1].player1Id, 'player-3');
  assert.equal(opening[1].player2Id, 'player-2');
  assert.deepEqual(createNextKnockoutRound(['a', 'b', 'c', 'd'], 2).map((match) =>
    [match.player1Id, match.player2Id]), [['a', 'b'], ['c', 'd']]);
});
