import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyConsensusDispute } from '../src/replay.js';

const require = createRequire(import.meta.url);
const { OTTGameEngine } = require('../../shared/OTTGameEngine.js');
const encoder = new TextEncoder();

function canonical(value) {
  return Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
    value && typeof value === 'object'
      ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

async function makeIdentity() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  return {
    privateKey: keys.privateKey,
    publicKey: await webcrypto.subtle.exportKey('jwk', keys.publicKey)
  };
}

async function attest(identity, payload) {
  const bytes = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, encoder.encode(canonical(payload)));
  return { payload, signature: Buffer.from(bytes).toString('hex') };
}

function statePayload(state) {
  return {
    board: Array.from(state.board), turn: state.turn, stepCount: state.stepCount,
    winner: state.winner || null, seed: state.seed, pieceCount: state.pieceCount,
    lastMove: state.lastMove || null,
    ...(state.rules ? { rules: state.rules } : {})
  };
}

test('adjudicates the player who signed an incorrect state hash', async () => {
  const identities = [await makeIdentity(), await makeIdentity()];
  const match = {
    id: 'match-dispute-test',
    seed: 92817,
    tournament_rules: null,
    player1_key: identities[0].publicKey,
    player2_key: identities[1].publicKey
  };
  const initialState = OTTGameEngine.createGame(match.seed, 9);
  const player = initialState.turn;
  const selectedMove = OTTGameEngine.getAllValidMoves(initialState)[0];
  const move = { from: selectedMove.from, to: selectedMove.to };
  const nonce = 'dispute-test-nonce';
  const commit = hash({ matchId: match.id, stepCount: 0, player, move, nonce });
  const commitAttestation = await attest(identities[player - 1], {
    kind: 'move-commit', matchId: match.id, stepCount: 0, player, hash: commit
  });
  const revealAttestation = await attest(identities[player - 1], {
    kind: 'move-reveal', matchId: match.id, stepCount: 0, player, move, nonce, commit
  });
  const nextState = OTTGameEngine.applyMove(initialState, move);
  const expectedHash = hash(statePayload(nextState));
  const acknowledgements = await Promise.all([1, 2].map(seat => attest(identities[seat - 1], {
    kind: 'state-ack',
    matchId: match.id,
    stepCount: 1,
    player: seat,
    moveCommit: commit,
    stateHash: seat === 2 ? 'f'.repeat(64) : expectedHash
  })));
  const evidence = {
    format: 'ottv2-consensus-dispute-v1',
    matchId: match.id,
    seed: match.seed,
    initialState: OTTGameEngine.serialize(initialState),
    moves: [],
    disputedStep: {
      stepCount: 1,
      player,
      move,
      nonce,
      commit,
      stateHash: expectedHash,
      commitAttestation,
      revealAttestation,
      acknowledgements
    }
  };

  assert.deepEqual(verifyConsensusDispute(evidence, match), {
    adjudicated: true,
    offenderSeat: 2,
    expectedHash,
    stepCount: 1,
    reason: 'signed-state-hash-mismatch'
  });
});

test('does not assign a winner if both signed hashes disagree with deterministic replay', async () => {
  const identities = [await makeIdentity(), await makeIdentity()];
  const match = {
    id: 'match-dispute-ambiguous',
    seed: 34811,
    tournament_rules: null,
    player1_key: identities[0].publicKey,
    player2_key: identities[1].publicKey
  };
  const initialState = OTTGameEngine.createGame(match.seed, 9);
  const player = initialState.turn;
  const selectedMove = OTTGameEngine.getAllValidMoves(initialState)[0];
  const move = { from: selectedMove.from, to: selectedMove.to };
  const nonce = 'ambiguous-dispute-nonce';
  const commit = hash({ matchId: match.id, stepCount: 0, player, move, nonce });
  const commitAttestation = await attest(identities[player - 1], {
    kind: 'move-commit', matchId: match.id, stepCount: 0, player, hash: commit
  });
  const revealAttestation = await attest(identities[player - 1], {
    kind: 'move-reveal', matchId: match.id, stepCount: 0, player, move, nonce, commit
  });
  const acknowledgements = await Promise.all([1, 2].map((seat, index) => attest(identities[seat - 1], {
    kind: 'state-ack', matchId: match.id, stepCount: 1, player: seat,
    moveCommit: commit, stateHash: index === 0 ? 'a'.repeat(64) : 'b'.repeat(64)
  })));
  const evidence = {
    format: 'ottv2-consensus-dispute-v1', matchId: match.id, seed: match.seed,
    initialState: OTTGameEngine.serialize(initialState), moves: [],
    disputedStep: {
      stepCount: 1, player, move, nonce, commit, stateHash: 'a'.repeat(64),
      commitAttestation, revealAttestation, acknowledgements
    }
  };

  const result = verifyConsensusDispute(evidence, match);
  assert.equal(result.adjudicated, false);
  assert.equal(result.offenderSeat, null);
});
