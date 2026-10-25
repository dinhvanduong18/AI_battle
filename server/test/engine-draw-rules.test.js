import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { OTTGameEngine } = require('../../shared/OTTGameEngine.js');

function positionKey(board, turn) {
  return `${Array.from(board).join('')}:${turn}`;
}

function createTestState() {
  const state = OTTGameEngine.createGame(42, 9);
  const board = new Int8Array(81);
  board[27] = 1;
  board[28] = 2;
  board[29] = 3;
  board[50] = 4;
  board[51] = 5;
  board[52] = 6;
  board[53] = 6;
  return {
    ...state,
    board,
    positionHistory: [positionKey(board, 1)],
    noCaptureCount: 0,
  };
}

const repetitionCycle = [
  { from: 27, to: 36 },
  { from: 50, to: 41 },
  { from: 36, to: 27 },
  { from: 41, to: 50 },
];

test('declares a draw when the same position occurs for the third time', () => {
  let state = createTestState();
  for (let index = 0; index < 4; index++) {
    state = OTTGameEngine.applyMove(state, repetitionCycle[index]);
  }
  assert.equal(state.winner, null);

  for (let index = 0; index < 4; index++) {
    state = OTTGameEngine.applyMove(state, repetitionCycle[index]);
  }
  assert.equal(state.winner, 0);
});

test('draws on the 50th consecutive move without a capture', () => {
  let state = createTestState();
  for (let step = 0; step < 50; step++) {
    state = OTTGameEngine.applyMove(state, repetitionCycle[step % repetitionCycle.length]);
    state.positionHistory = [`test-position-${state.stepCount}`];
    if (step === 48) {
      assert.equal(state.noCaptureCount, 49);
      assert.equal(state.winner, null);
    }
  }
  assert.equal(state.noCaptureCount, 50);
  assert.equal(state.winner, 0);
});

test('resets the no-capture counter when a piece is captured', () => {
  const state = createTestState();
  state.board[36] = 6;
  state.positionHistory = ['before-capture'];
  state.noCaptureCount = 49;

  const next = OTTGameEngine.applyMove(state, { from: 27, to: 36 });
  assert.equal(next.lastMove.isAttack, true);
  assert.equal(next.noCaptureCount, 0);
  assert.equal(next.winner, null);
});

test('a win takes precedence over the 50-move draw', () => {
  const state = createTestState();
  state.board[17] = 1;
  state.board[27] = 0;
  state.positionHistory = ['before-winning-move'];
  state.noCaptureCount = 49;

  const next = OTTGameEngine.applyMove(state, { from: 17, to: 8 });
  assert.equal(next.noCaptureCount, 50);
  assert.equal(next.winner, 1);
});

test('serializing preserves repetition and no-capture history', () => {
  let state = createTestState();
  state = OTTGameEngine.applyMove(state, repetitionCycle[0]);
  const restored = OTTGameEngine.deserialize(OTTGameEngine.serialize(state));
  assert.deepEqual(restored.positionHistory, state.positionHistory);
  assert.equal(restored.noCaptureCount, state.noCaptureCount);
});

test('deserializing an older state initializes draw history', () => {
  const serialized = OTTGameEngine.serialize(createTestState());
  delete serialized.positionHistory;
  delete serialized.noCaptureCount;

  const restored = OTTGameEngine.deserialize(serialized);
  assert.deepEqual(restored.positionHistory, [positionKey(restored.board, restored.turn)]);
  assert.equal(restored.noCaptureCount, 0);
});
