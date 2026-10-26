import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyReplay } from '../src/replay.js';

const require = createRequire(import.meta.url);
const { OTTGameEngine, computeFastHash } = require('../../shared/OTTGameEngine.js');
const { OTTGameEngine: BrowserGameEngine } = await import('../../src/core/ottEngine.ts');

const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
    ? `{${Object.keys(value)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
        .join(',')}}`
    : JSON.stringify(value);
const sha256 = (value) => createHash('sha256').update(canonical(value)).digest('hex');

function statePayload(state) {
  return {
    board: Array.from(state.board),
    turn: state.turn,
    stepCount: state.stepCount,
    winner: state.winner === 0 ? 0 : state.winner || null,
    seed: state.seed,
    pieceCount: state.pieceCount,
    lastMove: state.lastMove || null,
    ...(state.rules ? { rules: state.rules } : {}),
  };
}

test('isGameOver distinguishes ongoing null winner from draw (0) and wins (1, 2)', () => {
  const game = OTTGameEngine.createGame(102030, 9);
  assert.equal(OTTGameEngine.isGameOver(game), false);
  assert.equal(OTTGameEngine.isGameOver({ ...game, winner: 0 }), true);
  assert.equal(OTTGameEngine.isGameOver({ ...game, winner: 1 }), true);
  assert.equal(OTTGameEngine.isGameOver({ ...game, winner: 2 }), true);
});

test('each team only wins by reaching its own shrine in both deterministic engines', () => {
  const cases = [
    { player: 1, from: 7, to: 8, expectedWinner: 1 },
    { player: 1, from: 63, to: 72, expectedWinner: null },
    { player: 2, from: 63, to: 72, expectedWinner: 2 },
    { player: 2, from: 7, to: 8, expectedWinner: null },
  ];

  for (const engine of [OTTGameEngine, BrowserGameEngine]) {
    const state = engine.createGame(12345, 9);
    assert.equal(engine.createBotGameState(state, 1).specialCells.myWinIndex, 8);
    assert.equal(engine.createBotGameState(state, 2).specialCells.myWinIndex, 72);
    assert.equal(engine.createBotGameState(state, 1).specialCells.opponentWinIndex, 72);
    assert.equal(engine.createBotGameState(state, 2).specialCells.opponentWinIndex, 8);

    for (const { player, from, to, expectedWinner } of cases) {
      const position = engine.createGame(12345, 9);
      position.board = new Int8Array(81);
      position.board[from] = player === 1 ? 1 : 4;
      position.board[player === 1 ? 40 : 20] = player === 1 ? 2 : 5;
      position.board[player === 1 ? 41 : 21] = player === 1 ? 3 : 6;
      position.board[player === 1 ? 20 : 40] = player === 1 ? 4 : 1;
      position.board[player === 1 ? 21 : 41] = player === 1 ? 5 : 2;
      position.board[player === 1 ? 22 : 42] = player === 1 ? 6 : 3;
      position.turn = player;
      position.positionCounts = {};
      position.noCapturePlies = 0;

      const next = engine.applyMove(position, { from, to });
      assert.equal(next.winner, expectedWinner, `player ${player}, ${from} to ${to}`);
    }
  }
});

test('threefold-repetition ends game with winner === 0 and passes verifyReplay', () => {
  const matchId = 'draw-replay-test-1';
  const seed = 424242;
  let state = OTTGameEngine.createGame(seed, 9);
  const initialSerialized = OTTGameEngine.serialize(state);

  const p1Move = OTTGameEngine.getAllValidMoves(state).find((m) => !m.isAttack);
  const s1 = OTTGameEngine.applyMove(state, { from: p1Move.from, to: p1Move.to });
  const p2Move = OTTGameEngine.getAllValidMoves(s1).find((m) => !m.isAttack);

  const cycle = [
    { from: p1Move.from, to: p1Move.to },
    { from: p2Move.from, to: p2Move.to },
    { from: p1Move.to, to: p1Move.from },
    { from: p2Move.to, to: p2Move.from },
  ];
  const plan = [...cycle, ...cycle];
  const moves = [];

  for (let i = 0; i < plan.length; i++) {
    const move = plan[i];
    const player = state.turn;
    const nonce = `rep-nonce-${i}`;
    const commit = sha256({ matchId, stepCount: i, player, move, nonce });
    state = OTTGameEngine.applyMove(state, move);
    const stateHash = sha256(statePayload(state));
    moves.push({
      stepCount: i + 1,
      player,
      move,
      nonce,
      commit,
      stateHash,
    });
  }

  assert.equal(state.winner, 0);
  assert.equal(state.drawReason, 'threefold-repetition');

  const verified = verifyReplay(
    {
      format: 'ottv2-replay-v1',
      matchId,
      seed,
      initialState: initialSerialized,
      moves,
    },
    seed,
    matchId,
    null
  );
  assert.equal(verified.winner, 0);
  assert.equal(verified.drawReason, 'threefold-repetition');
  assert.equal(verified.stepCount, 8);
});

test('50-move no-capture rule triggers winner === 0 at 100 consecutive non-capture plies', () => {
  const state = OTTGameEngine.createGame(999111, 9);
  state.noCapturePlies = 99;
  state.positionCounts = {}; // isolate from threefold-repetition
  const nonCapture = OTTGameEngine.getAllValidMoves(state).find((m) => !m.isAttack);
  assert.ok(nonCapture);

  const next = OTTGameEngine.applyMove(state, { from: nonCapture.from, to: nonCapture.to });
  assert.equal(next.noCapturePlies, 100);
  assert.equal(next.winner, 0);
  assert.equal(next.drawReason, 'fifty-move-rule');
});

test('stalemate triggers winner === 0 when next turn player still has all 3 piece types alive but 0 legal moves', () => {
  const state = OTTGameEngine.createGame(888222, 9);
  state.board = new Int8Array(81);
  // P1 pieces: 1 (Rock) at 40, 2 (Paper) at 50, 3 (Scissors) at 60
  state.board[40] = 1;
  state.board[50] = 2;
  state.board[60] = 3;
  // P2 pieces: 4 (Rock) at 0, 5 (Paper) at 1, 6 (Scissors) at 2 (top row col 0..2)
  // Boxed in completely by blocked cells at col 3 (index 3) and row 1 cols 0..3 (indices 9, 10, 11, 12)!
  state.board[0] = 4;
  state.board[1] = 5;
  state.board[2] = 6;
  state.rules = {
    id: 'test-stalemate-box',
    rows: 9,
    cols: 9,
    blockedCells: [3, 9, 10, 11, 12],
  };
  state.turn = 1;
  state.noCapturePlies = 0;
  state.positionCounts = {};

  const next = OTTGameEngine.applyMove(state, { from: 40, to: 41 });
  assert.equal(next.winner, 0);
  assert.equal(next.drawReason, 'stalemate');
});

test('computeFastHash distinguishes turn, piece types, and draw (winner === 0) vs ongoing (winner === null)', () => {
  const s1 = OTTGameEngine.createGame(314159, 9);
  const s2 = OTTGameEngine.deserialize(OTTGameEngine.serialize(s1));
  s2.turn = 2;
  assert.notEqual(computeFastHash(s1), computeFastHash(s2));

  const s3 = OTTGameEngine.deserialize(OTTGameEngine.serialize(s1));
  const idx = s3.board.findIndex((v) => v === 1);
  s3.board[idx] = 2; // change P1 Rock to P1 Paper
  assert.notEqual(computeFastHash(s1), computeFastHash(s3));

  const s4 = OTTGameEngine.deserialize(OTTGameEngine.serialize(s1));
  s4.winner = 0; // draw must hash differently from winner: null!
  assert.notEqual(computeFastHash(s1), computeFastHash(s4));
});
