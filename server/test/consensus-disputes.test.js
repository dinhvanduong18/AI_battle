import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyConsensusDispute } from '../src/replay.js';

const require = createRequire(import.meta.url);
const { OTTGameEngine } = require('../../shared/OTTGameEngine.js');
const encoder = new TextEncoder();

function canonical(value) {
  return Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
    ? `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(',')}}`
    : JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

async function makeIdentity() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  return {
    privateKey: keys.privateKey,
    publicKey: await webcrypto.subtle.exportKey('jwk', keys.publicKey),
  };
}

async function attest(identity, payload) {
  const bytes = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    encoder.encode(canonical(payload))
  );
  return { payload, signature: Buffer.from(bytes).toString('hex') };
}

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

test('Fault Mode C: adjudicates the player who signed an incorrect state-ack hash', async () => {
  const identities = [await makeIdentity(), await makeIdentity()];
  const match = {
    id: 'match-dispute-test',
    seed: 92817,
    tournament_rules: null,
    player1_key: identities[0].publicKey,
    player2_key: identities[1].publicKey,
  };
  const initialState = OTTGameEngine.createGame(match.seed, 9);
  const player = initialState.turn;
  const selectedMove = OTTGameEngine.getAllValidMoves(initialState)[0];
  const move = { from: selectedMove.from, to: selectedMove.to };
  const nonce = 'dispute-test-nonce';
  const commit = hash({ matchId: match.id, stepCount: 0, player, move, nonce });
  const commitAttestation = await attest(identities[player - 1], {
    kind: 'move-commit',
    matchId: match.id,
    stepCount: 0,
    player,
    hash: commit,
  });
  const revealAttestation = await attest(identities[player - 1], {
    kind: 'move-reveal',
    matchId: match.id,
    stepCount: 0,
    player,
    move,
    nonce,
    commit,
  });
  const nextState = OTTGameEngine.applyMove(initialState, move);
  const expectedHash = hash(statePayload(nextState));
  const acknowledgements = await Promise.all(
    [1, 2].map((seat) =>
      attest(identities[seat - 1], {
        kind: 'state-ack',
        matchId: match.id,
        stepCount: 1,
        player: seat,
        moveCommit: commit,
        stateHash: seat === 2 ? 'f'.repeat(64) : expectedHash,
      })
    )
  );
  const evidence = {
    format: 'ottv2-consensus-dispute-v1',
    faultType: 'state-ack-mismatch',
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
      acknowledgements,
    },
  };

  assert.deepEqual(verifyConsensusDispute(evidence, match), {
    adjudicated: true,
    offenderSeat: 2,
    expectedHash,
    stepCount: 1,
    reason: 'signed-state-hash-mismatch',
  });
});

test('Fault Mode C: does not assign a winner if both signed hashes disagree with deterministic replay', async () => {
  const identities = [await makeIdentity(), await makeIdentity()];
  const match = {
    id: 'match-dispute-ambiguous',
    seed: 34811,
    tournament_rules: null,
    player1_key: identities[0].publicKey,
    player2_key: identities[1].publicKey,
  };
  const initialState = OTTGameEngine.createGame(match.seed, 9);
  const player = initialState.turn;
  const selectedMove = OTTGameEngine.getAllValidMoves(initialState)[0];
  const move = { from: selectedMove.from, to: selectedMove.to };
  const nonce = 'ambiguous-dispute-nonce';
  const commit = hash({ matchId: match.id, stepCount: 0, player, move, nonce });
  const commitAttestation = await attest(identities[player - 1], {
    kind: 'move-commit',
    matchId: match.id,
    stepCount: 0,
    player,
    hash: commit,
  });
  const revealAttestation = await attest(identities[player - 1], {
    kind: 'move-reveal',
    matchId: match.id,
    stepCount: 0,
    player,
    move,
    nonce,
    commit,
  });
  const acknowledgements = await Promise.all(
    [1, 2].map((seat, index) =>
      attest(identities[seat - 1], {
        kind: 'state-ack',
        matchId: match.id,
        stepCount: 1,
        player: seat,
        moveCommit: commit,
        stateHash: index === 0 ? 'a'.repeat(64) : 'b'.repeat(64),
      })
    )
  );
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
      stateHash: 'a'.repeat(64),
      commitAttestation,
      revealAttestation,
      acknowledgements,
    },
  };

  const result = verifyConsensusDispute(evidence, match);
  assert.equal(result.adjudicated, false);
  assert.equal(result.offenderSeat, null);
});

test('Fault Mode B (reveal-fault): adjudicates commit/reveal mismatch and illegal moves immediately', async () => {
  const identities = [await makeIdentity(), await makeIdentity()];
  const match = {
    id: 'match-reveal-fault',
    seed: 55102,
    tournament_rules: null,
    player1_key: identities[0].publicKey,
    player2_key: identities[1].publicKey,
  };
  const initialState = OTTGameEngine.createGame(match.seed, 9);
  const player = initialState.turn; // Seat 1

  // 1) Signed illegal move (teleport across entire board from 72 to 0)
  const illegalMove = { from: 72, to: 0 };
  const illegalNonce = 'illegal-move-nonce';
  const illegalCommit = hash({
    matchId: match.id,
    stepCount: 0,
    player,
    move: illegalMove,
    nonce: illegalNonce,
  });
  const commitAtt = await attest(identities[player - 1], {
    kind: 'move-commit',
    matchId: match.id,
    stepCount: 0,
    player,
    hash: illegalCommit,
  });
  const revealAtt = await attest(identities[player - 1], {
    kind: 'move-reveal',
    matchId: match.id,
    stepCount: 0,
    player,
    move: illegalMove,
    nonce: illegalNonce,
    commit: illegalCommit,
  });

  const verdictIllegal = verifyConsensusDispute(
    {
      format: 'ottv2-consensus-dispute-v1',
      faultType: 'reveal-fault',
      matchId: match.id,
      seed: match.seed,
      initialState: OTTGameEngine.serialize(initialState),
      moves: [],
      commitAttestation: commitAtt,
      disputedReveal: revealAtt,
    },
    match
  );
  assert.equal(verdictIllegal.adjudicated, true);
  assert.equal(verdictIllegal.offenderSeat, player);
  assert.equal(verdictIllegal.reason, 'signed-illegal-move');

  // 2) Signed commit-reveal hash mismatch (baited one commit, revealed another)
  const validMove = OTTGameEngine.getAllValidMoves(initialState)[0];
  const moveObj = { from: validMove.from, to: validMove.to };
  const baitCommitAtt = await attest(identities[player - 1], {
    kind: 'move-commit',
    matchId: match.id,
    stepCount: 0,
    player,
    hash: '9'.repeat(64),
  });
  const switchedCommit = hash({
    matchId: match.id,
    stepCount: 0,
    player,
    move: moveObj,
    nonce: 'switched-nonce',
  });
  const switchedRevealAtt = await attest(identities[player - 1], {
    kind: 'move-reveal',
    matchId: match.id,
    stepCount: 0,
    player,
    move: moveObj,
    nonce: 'switched-nonce',
    commit: switchedCommit,
  });

  const verdictBait = verifyConsensusDispute(
    {
      format: 'ottv2-consensus-dispute-v1',
      faultType: 'reveal-fault',
      matchId: match.id,
      seed: match.seed,
      initialState: OTTGameEngine.serialize(initialState),
      moves: [],
      commitAttestation: baitCommitAtt,
      disputedReveal: switchedRevealAtt,
    },
    match
  );
  assert.equal(verdictBait.adjudicated, true);
  assert.equal(verdictBait.offenderSeat, player);
  assert.equal(verdictBait.reason, 'signed-commit-reveal-mismatch');
});

test('Fault Mode A (final-proof-mismatch): adjudicates forged final proof even if offender skipped final state-ack', async () => {
  const identities = [await makeIdentity(), await makeIdentity()];
  const match = {
    id: 'match-final-proof-dispute',
    seed: 77421,
    tournament_rules: null,
    player1_key: identities[0].publicKey,
    player2_key: identities[1].publicKey,
  };

  let state = OTTGameEngine.createGame(match.seed, 9);
  const initialSerialized = OTTGameEngine.serialize(state);
  const moves = [];

  // Play a deterministic 3-fold repetition draw (4 back-and-forth cycles = 8 plies -> initial state seen 3 times!)
  // Find a reversible move for P1 and a reversible move for P2
  const p1First = OTTGameEngine.getAllValidMoves(state).find((m) => !m.isAttack);
  const sAfterP1 = OTTGameEngine.applyMove(state, { from: p1First.from, to: p1First.to });
  const p2First = OTTGameEngine.getAllValidMoves(sAfterP1).find((m) => !m.isAttack);

  const cycleMoves = [
    { from: p1First.from, to: p1First.to },
    { from: p2First.from, to: p2First.to },
    { from: p1First.to, to: p1First.from },
    { from: p2First.to, to: p2First.from },
  ];
  const fullPlan = [...cycleMoves, ...cycleMoves]; // 8 plies -> 3rd occurrence of initial board & turn!

  for (let i = 0; i < fullPlan.length; i++) {
    const move = fullPlan[i];
    const player = state.turn;
    const nonce = `nonce-${i}`;
    const commit = hash({ matchId: match.id, stepCount: i, player, move, nonce });
    const commitAttestation = await attest(identities[player - 1], {
      kind: 'move-commit',
      matchId: match.id,
      stepCount: i,
      player,
      hash: commit,
    });
    const revealAttestation = await attest(identities[player - 1], {
      kind: 'move-reveal',
      matchId: match.id,
      stepCount: i,
      player,
      move,
      nonce,
      commit,
    });
    state = OTTGameEngine.applyMove(state, move);
    const stateHash = hash(statePayload(state));
    const isTerminalStep = i === fullPlan.length - 1;
    // Simulate offender (Seat 2) skipping final state-ack and jumping straight to lying FINAL_PROOF
    const seats = isTerminalStep ? [1] : [1, 2];
    const acknowledgements = await Promise.all(
      seats.map((seat) =>
        attest(identities[seat - 1], {
          kind: 'state-ack',
          matchId: match.id,
          stepCount: i + 1,
          player: seat,
          moveCommit: commit,
          stateHash,
        })
      )
    );
    moves.push({
      stepCount: i + 1,
      player,
      move,
      nonce,
      commit,
      stateHash,
      commitAttestation,
      revealAttestation,
      acknowledgements,
    });
  }

  assert.equal(state.winner, 0);
  assert.equal(state.drawReason, 'threefold-repetition');

  // Seat 2 signs a lying FINAL_PROOF claiming winner = 2 instead of winner = 0!
  const lyingProof = {
    kind: 'final-state',
    matchId: match.id,
    seed: match.seed,
    stepCount: state.stepCount,
    winner: 2,
    stateHash: hash(statePayload(state)),
    replayHash: '0'.repeat(64),
  };
  const lyingAtt = await attest(identities[1], lyingProof);

  const verdict = verifyConsensusDispute(
    {
      format: 'ottv2-consensus-dispute-v1',
      faultType: 'final-proof-mismatch',
      matchId: match.id,
      seed: match.seed,
      initialState: initialSerialized,
      moves,
      disputedFinalProof: {
        seat: 2,
        proof: lyingProof,
        signature: lyingAtt.signature,
      },
    },
    match
  );

  assert.equal(verdict.adjudicated, true);
  assert.equal(verdict.offenderSeat, 2);
  assert.equal(verdict.reason, 'signed-final-proof-mismatch');
});
