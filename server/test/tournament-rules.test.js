import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { OTTGameEngine as BrowserEngine } from '../../src/core/ottEngine.ts';

const require = createRequire(import.meta.url);
const { OTTGameEngine: ServerEngine } = require('../../shared/OTTGameEngine.js');

function distance(index, target) {
  return Math.abs(Math.floor(index / 9) - Math.floor(target / 9)) +
    Math.abs(index % 9 - target % 9);
}

for (const [label, Engine] of [['browser', BrowserEngine], ['server', ServerEngine]]) {
  test(`${label} engine keeps the basic tournament rule active after 25 moves`, () => {
    const state = Engine.createGame(12345, 9, {
      id: 'group-knockout-custom',
      rows: 9,
      cols: 9,
      blockedCells: [],
      moveLimitRule: 'standard',
    });
    state.stepCount = 24;
    const move = Engine.getAllValidMoves(state).find((candidate) =>
      !candidate.isAttack && candidate.to !== 8
    );
    assert.ok(move);
    const result = Engine.applyMove(state, move);
    assert.equal(result.stepCount, 25);
    assert.equal(result.winner, null);
    assert.notEqual(result.drawReason, 'tournament-score-tie');
  });

  test(`${label} engine resolves a remaining-pieces tie after 25 moves`, () => {
    const state = Engine.createGame(12345, 9, {
      id: 'group-knockout-custom',
      rows: 9,
      cols: 9,
      blockedCells: [],
      moveLimit: 25,
      moveLimitRule: 'remaining-pieces',
    });
    state.stepCount = 24;
    const move = Engine.getAllValidMoves(state).find((candidate) =>
      !candidate.isAttack && candidate.to !== 8
    );
    assert.ok(move);
    const result = Engine.applyMove(state, move);
    assert.equal(result.stepCount, 25);
    assert.equal(result.winner, 0);
    assert.equal(result.drawReason, 'tournament-score-tie');
  });

  test(`${label} engine awards the 25-move position score to the closer side`, () => {
    const state = Engine.createGame(12345, 9, {
      id: 'group-knockout-custom',
      rows: 9,
      cols: 9,
      blockedCells: [],
      moveLimit: 25,
      moveLimitRule: 'goal-distance',
    });
    state.stepCount = 24;
    const move = Engine.getAllValidMoves(state).find((candidate) =>
      !candidate.isAttack && candidate.to !== 8 &&
      distance(candidate.to, 8) < distance(candidate.from, 8)
    );
    assert.ok(move);
    const result = Engine.applyMove(state, move);
    const scores = [0, 0, 0];
    result.board.forEach((piece, index) => {
      if (!piece) return;
      const owner = piece <= 3 ? 1 : 2;
      scores[owner] -= distance(index, owner === 1 ? 8 : 72);
    });
    assert.equal(result.winner, scores[1] === scores[2] ? 0 : scores[1] > scores[2] ? 1 : 2);
    assert.equal(result.winner, 1);
  });

  test(`${label} engine uses configurable captured-piece values after 25 moves`, () => {
    const state = Engine.createGame(12345, 9, {
      id: 'group-knockout-custom',
      rows: 9,
      cols: 9,
      blockedCells: [],
      moveLimit: 25,
      moveLimitRule: 'captured-points',
      capturedPieceValues: { rock: 2, paper: 3, scissors: 7 },
    });
    state.board[40] = 1;
    state.board[41] = 6;
    state.stepCount = 24;
    const result = Engine.applyMove(state, { from: 40, to: 41 });
    assert.deepEqual(result.capturedPiecePoints, { 1: 7, 2: 0 });
    assert.equal(result.winner, 1);
    assert.equal(result.stepCount, 25);
    assert.equal(Engine.deserialize(Engine.serialize(result)).capturedPiecePoints[1], 7);
  });
}
