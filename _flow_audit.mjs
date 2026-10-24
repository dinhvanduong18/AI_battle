import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const { OTTGameEngine } = require('./shared/OTTGameEngine.js');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';
const results = [];
let passed = 0;
let failed = 0;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
const sha256Canonical = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const encoder = new TextEncoder();

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function waitFor(ws, predicate, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('timeout waiting for WS packet'));
    }, ms);
    const onMsg = (raw) => {
      let pkt;
      try {
        pkt = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (predicate(pkt)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(pkt);
      }
    };
    ws.on('message', onMsg);
  });
}

async function connectAuth(token) {
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'auth', token }));
  const pkt = await waitFor(ws, (p) => p.type === 'authenticated' || p.type === 'error');
  if (pkt.type !== 'authenticated') throw new Error(pkt.message || 'auth failed');
  return ws;
}

async function makeIdentity() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
  return { keys, publicJwk };
}

async function signPayload(privateKey, payload) {
  const sig = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(canonical(payload))
  );
  return Buffer.from(sig).toString('hex');
}

function statePayload(current) {
  return {
    board: Array.from(current.board),
    turn: current.turn,
    stepCount: current.stepCount,
    winner: current.winner || null,
    seed: current.seed,
    pieceCount: current.pieceCount,
    lastMove: current.lastMove || null,
    ...(current.rules ? { rules: current.rules } : {}),
  };
}

function playToEnd(seed, rules = null) {
  let state = OTTGameEngine.createGame(seed, 9, rules);
  const initialState = OTTGameEngine.serialize(state);
  const moves = [];
  let guard = 0;
  while (!state.winner && guard < 400) {
    guard += 1;
    const legal = OTTGameEngine.getAllValidMoves(state);
    if (!legal.length) break;
    const chosen = legal[0];
    const move = { from: chosen.from, to: chosen.to };
    const nonce = `n${guard}`;
    const commit = sha256Canonical({
      matchId: '__MATCH__',
      stepCount: state.stepCount,
      player: state.turn,
      move,
      nonce,
    });
    const player = state.turn;
    state = OTTGameEngine.applyMove(state, move);
    moves.push({
      stepCount: state.stepCount,
      player,
      move,
      nonce,
      commit,
      stateHash: sha256Canonical(statePayload(state)),
    });
  }
  return { winner: state.winner, stepCount: state.stepCount, initialState, moves, finalHash: sha256Canonical(statePayload(state)) };
}

async function run() {
  const stamp = Date.now();
  const emailA = `flow.a.${stamp}@ottv2.test`;
  const emailB = `flow.b.${stamp}@ottv2.test`;
  const emailC = `flow.c.${stamp}@ottv2.test`;
  const password = 'halloween2026';

  // Health
  {
    const r = await api('/health');
    check('GET /health', r.status === 200 && r.json.ok === true, JSON.stringify(r.json.mode));
  }

  // Auth validation
  {
    const badEmail = await api('/api/auth/register', {
      method: 'POST',
      body: { email: 'not-an-email', password, displayName: 'X' },
    });
    check('register invalid email', badEmail.status === 400);

    const shortPw = await api('/api/auth/register', {
      method: 'POST',
      body: { email: emailA, password: 'short', displayName: 'X' },
    });
    check('register short password', shortPw.status === 400);

    const noName = await api('/api/auth/register', {
      method: 'POST',
      body: { email: emailA, password, displayName: '  ' },
    });
    check('register empty name', noName.status === 400);
  }

  const regA = await api('/api/auth/register', {
    method: 'POST',
    body: { email: emailA, password, displayName: 'Flow Alpha' },
  });
  check('register user A', regA.status === 201 && Boolean(regA.json.token), `elo=${regA.json.user?.elo}`);
  const tokenA = regA.json.token;
  const userA = regA.json.user;

  const dup = await api('/api/auth/register', {
    method: 'POST',
    body: { email: emailA, password, displayName: 'Dup' },
  });
  check('register duplicate email', dup.status === 409);

  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: emailA, password: 'wrong-password-xx' },
  });
  check('login wrong password', badLogin.status === 401);

  const sysLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'guardian@ottv2.local', password },
  });
  check('login system bot blocked', sysLogin.status === 401);

  const loginA = await api('/api/auth/login', {
    method: 'POST',
    body: { email: emailA, password },
  });
  check('login user A', loginA.status === 200 && Boolean(loginA.json.token));

  const noAuth = await api('/api/me');
  check('GET /api/me without token', noAuth.status === 401);

  const meA = await api('/api/me', { token: tokenA });
  check('GET /api/me', meA.status === 200 && meA.json.user?.email === emailA);

  const patchBad = await api('/api/me', {
    method: 'PATCH',
    token: tokenA,
    body: { displayName: '' },
  });
  check('PATCH empty displayName', patchBad.status === 400);

  const patchHalf = await api('/api/me', {
    method: 'PATCH',
    token: tokenA,
    body: { newPassword: 'newpassword123' },
  });
  check('PATCH password without current', patchHalf.status === 400);

  const patchOk = await api('/api/me', {
    method: 'PATCH',
    token: tokenA,
    body: { displayName: 'Flow Alpha+' },
  });
  check('PATCH displayName', patchOk.status === 200 && patchOk.json.user?.displayName === 'Flow Alpha+');

  const loginAdmin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@ottv2.local', password },
  });
  check('login seed admin', loginAdmin.status === 200 && loginAdmin.json.user?.isAdmin === true);
  const tokenAdmin = loginAdmin.json.token;

  const lb = await api('/api/leaderboard');
  check(
    'GET /api/leaderboard',
    lb.status === 200 && Array.isArray(lb.json.players) && lb.json.players.length >= 5
  );

  const matchesEmpty = await api('/api/matches', { token: tokenA });
  check('GET /api/matches empty', matchesEmpty.status === 200 && Array.isArray(matchesEmpty.json.matches));

  const tours = await api('/api/tournaments');
  check('GET /api/tournaments', tours.status === 200 && tours.json.tournaments?.length >= 1);
  const tQual = tours.json.tournaments.find((t) => t.status === 'qualifying');
  const tReg = tours.json.tournaments.find((t) => t.status === 'registration');
  check('seed qualifying tournament exists', Boolean(tQual), tQual?.name);
  check('seed registration tournament exists', Boolean(tReg), tReg?.name);

  const tDetailAnon = await api(`/api/tournaments/${tQual.id}`);
  check(
    'GET tournament detail anonymous',
    tDetailAnon.status === 200 && tDetailAnon.json.myEntry === null && Array.isArray(tDetailAnon.json.standings)
  );

  const missingT = await api('/api/tournaments/not-a-real-id');
  check('GET missing tournament', missingT.status === 404);

  const joinA = await api(`/api/tournaments/${tQual.id}/register`, { method: 'POST', token: tokenA });
  check('register tournament A', joinA.status === 201 && joinA.json.entry?.player_id === userA.id);

  const joinAgain = await api(`/api/tournaments/${tQual.id}/register`, { method: 'POST', token: tokenA });
  check('register tournament idempotent', joinAgain.status === 200 && joinAgain.json.alreadyRegistered === true);

  const tDetailAuth = await api(`/api/tournaments/${tQual.id}`, { token: tokenA });
  check('GET tournament myEntry present', Boolean(tDetailAuth.json.myEntry));

  const createForbidden = await api('/api/tournaments', {
    method: 'POST',
    token: tokenA,
    body: {
      name: 'Should fail',
      description: 'x',
      registrationClosesAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
      maxTeams: 8,
      sprintRules: ['standard', 'center_blockers', 'clipped_corners', 'corridor'],
    },
  });
  check('create tournament without admin', createForbidden.status === 403);

  const createBadRules = await api('/api/tournaments', {
    method: 'POST',
    token: tokenAdmin,
    body: {
      name: 'Bad rules cup',
      description: 'x',
      registrationClosesAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
      maxTeams: 8,
      sprintRules: ['standard', 'standard'],
    },
  });
  check('create tournament invalid sprintRules', createBadRules.status === 400);

  const createPast = await api('/api/tournaments', {
    method: 'POST',
    token: tokenAdmin,
    body: {
      name: 'Past cup',
      description: 'x',
      registrationClosesAt: new Date(Date.now() - 86400000).toISOString(),
      endsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
      maxTeams: 8,
      sprintRules: ['standard', 'center_blockers', 'clipped_corners', 'corridor'],
    },
  });
  check('create tournament past registration', createPast.status === 400);

  const created = await api('/api/tournaments', {
    method: 'POST',
    token: tokenAdmin,
    body: {
      name: `Flow Cup ${stamp}`,
      description: 'audit',
      registrationClosesAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      endsAt: new Date(Date.now() + 20 * 86400000).toISOString(),
      maxTeams: 8,
      sprintRules: ['corridor', 'standard', 'clipped_corners', 'center_blockers'],
    },
  });
  check('create tournament as admin', created.status === 201 && created.json.tournament?.status === 'registration');
  const newTid = created.json.tournament?.id;

  const startForbidden = await api(`/api/tournaments/${newTid}/start`, { method: 'POST', token: tokenA });
  check('start tournament without admin', startForbidden.status === 403);

  const started = await api(`/api/tournaments/${newTid}/start`, { method: 'POST', token: tokenAdmin });
  check(
    'start tournament as admin',
    started.status === 200 && started.json.tournament?.status === 'qualifying' && started.json.tournament?.current_week === 1
  );

  const startAgain = await api(`/api/tournaments/${newTid}/start`, { method: 'POST', token: tokenAdmin });
  check('start tournament not in registration', startAgain.status === 409);

  const botBad = await api('/api/bots/me', { method: 'POST', token: tokenA, body: { code: 'print(1)' } });
  check('save bot missing get_next_move', botBad.status === 400);

  const botOk = await api('/api/bots/me', {
    method: 'POST',
    token: tokenA,
    body: {
      code: `def get_next_move(my_player_id, game_state):
    moves = game_state.get('validMoves', [])
    if not moves:
        return None
    m = moves[0]
    return {'fromRow': m['fromRow'], 'fromCol': m['fromCol'], 'toRow': m['toRow'], 'toCol': m['toCol']}
`,
    },
  });
  check('save bot python', botOk.status === 201 && botOk.json.version >= 1);

  const botMe = await api('/api/bots/me', { token: tokenA });
  check('GET /api/bots/me', botMe.status === 200 && botMe.json.bot?.version >= 1);

  const claim = await api('/api/match/claim-disconnect', { method: 'POST', token: tokenA, body: {} });
  check('claim-disconnect stub', claim.status === 202 && claim.json.status === 'needs-review');

  const dispute = await api('/api/match/consensus-dispute', { method: 'POST', token: tokenA, body: {} });
  check('consensus-dispute stub (local)', dispute.status === 200);

  const replayMissing = await api('/api/matches/does-not-exist/replay', { token: tokenA });
  check('replay missing match', replayMissing.status === 404);

  const submitMissing = await api('/api/match/submit-result', {
    method: 'POST',
    token: tokenA,
    body: { matchId: 'nope' },
  });
  check('submit-result unknown match', submitMissing.status === 404);

  // WS: unauthenticated timeout/close
  {
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({ type: 'ping' }));
    const closed = await new Promise((resolve) => {
      ws.once('close', (code) => resolve(code));
      setTimeout(() => resolve('timeout'), 3000);
    });
    check('WS rejects non-auth first packet', closed === 4401, `code=${closed}`);
  }

  // WS ping + queue + cancel
  {
    const ws = await connectAuth(tokenA);
    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await waitFor(ws, (p) => p.type === 'pong');
    check('WS ping/pong', Boolean(pong.at));

    ws.send(JSON.stringify({ type: 'find-match' }));
    const searching = await waitFor(ws, (p) => p.type === 'searching');
    check('WS find-match searching', searching.mode === 'human');

    ws.send(JSON.stringify({ type: 'cancel-match' }));
    const cancelled = await waitFor(ws, (p) => p.type === 'search-cancelled');
    check('WS cancel-match', cancelled.type === 'search-cancelled');
    ws.close();
  }

  // WS tournament match without register on new tournament
  {
    const ws = await connectAuth(tokenA);
    ws.send(JSON.stringify({ type: 'find-tournament-match', tournamentId: newTid }));
    const err = await waitFor(ws, (p) => p.type === 'error');
    check('WS tournament match without entry', /Tham gia giải/i.test(err.message || ''), err.message);
    ws.close();
  }

  // Two-player pairing (bot queue)
  const regB = await api('/api/auth/register', {
    method: 'POST',
    body: { email: emailB, password, displayName: 'Flow Beta' },
  });
  check('register user B', regB.status === 201);
  const tokenB = regB.json.token;

  let pairedMatch = null;
  {
    const wsA = await connectAuth(tokenA);
    const wsB = await connectAuth(tokenB);
    const foundA = waitFor(wsA, (p) => p.type === 'match-found', 8000);
    const foundB = waitFor(wsB, (p) => p.type === 'match-found', 8000);
    wsA.send(JSON.stringify({ type: 'find-bot-match' }));
    await new Promise((r) => setTimeout(r, 80));
    wsB.send(JSON.stringify({ type: 'find-bot-match' }));
    const [a, b] = await Promise.all([foundA, foundB]);
    pairedMatch = a.match;
    check(
      'WS two-player bot pair',
      a.match?.id === b.match?.id && a.seat !== b.seat && a.match?.mode === 'bot',
      `match=${a.match?.id} seats=${a.seat}/${b.seat}`
    );

    wsA.send(JSON.stringify({ type: 'session-key', matchId: a.match.id, publicKey: { kty: 'EC', crv: 'P-256', x: 'aa', y: 'bb' } }));
    const accepted = await waitFor(wsA, (p) => p.type === 'session-key-accepted');
    check('WS session-key-accepted', accepted.matchId === a.match.id);

    wsA.send(JSON.stringify({ type: 'match-relay', matchId: a.match.id, payload: { type: 'HELLO_TEST', n: 1 } }));
    const relayed = await waitFor(wsB, (p) => p.type === 'match-relay' && p.payload?.type === 'HELLO_TEST');
    check('WS match-relay peer delivery', relayed.from === userA.id);

    wsA.close();
    wsB.close();
  }

  // Submit-result missing proofs on active match
  if (pairedMatch) {
    const r = await api('/api/match/submit-result', {
      method: 'POST',
      token: tokenA,
      body: { matchId: pairedMatch.id, proofs: {}, replay: {} },
    });
    check('submit-result missing proofs', r.status === 400);
  }

  // Sparring instant match + full verified submit
  const idHuman = await makeIdentity();
  const wsSpar = await connectAuth(tokenA);
  const foundSpar = waitFor(wsSpar, (p) => p.type === 'match-found', 8000);
  const readySpar = waitFor(wsSpar, (p) => p.type === 'sparring-ready', 8000);
  wsSpar.send(JSON.stringify({ type: 'find-sparring-match', mode: 'bot' }));
  const [matchPkt, readyPkt] = await Promise.all([foundSpar, readySpar]);
  check(
    'WS sparring match-found',
    Boolean(matchPkt.match?.id) &&
      (matchPkt.opponent?.id === '00000000-0000-4000-8000-000000000001' || matchPkt.match.player1.id === '00000000-0000-4000-8000-000000000001'),
    `match=${matchPkt.match?.id} seat=${matchPkt.seat}`
  );
  check('WS sparring-ready', readyPkt.matchId === matchPkt.match.id && Boolean(readyPkt.publicKey));

  wsSpar.send(
    JSON.stringify({
      type: 'session-key',
      matchId: matchPkt.match.id,
      publicKey: idHuman.publicJwk,
    })
  );
  await waitFor(wsSpar, (p) => p.type === 'session-key-accepted');

  const seed = matchPkt.match.seed;
  const matchId = matchPkt.match.id;
  const game = playToEnd(seed, matchPkt.match.rules || null);
  check('engine can finish a seeded game', Boolean(game.winner) && game.moves.length > 0, `winner=${game.winner} steps=${game.stepCount}`);

  for (const mv of game.moves) {
    mv.commit = sha256Canonical({
      matchId,
      stepCount: mv.stepCount - 1,
      player: mv.player,
      move: mv.move,
      nonce: mv.nonce,
    });
  }

  const proof = {
    matchId,
    roomId: matchId,
    stepCount: game.stepCount,
    stateHash: game.finalHash,
    winner: game.winner,
  };
  const humanSig = await signPayload(idHuman.keys.privateKey, proof);

  // Bot key is already registered; we cannot sign as bot from here without private key.
  // Submit with two human-like proofs should fail signature.
  const badDual = await api('/api/match/submit-result', {
    method: 'POST',
    token: tokenA,
    body: {
      matchId,
      proofs: {
        player1: { proof, signature: humanSig },
        player2: { proof, signature: humanSig },
      },
      replay: {
        format: 'ottv2-replay-v1',
        matchId,
        seed,
        initialState: game.initialState,
        moves: game.moves,
      },
    },
  });
  check('submit-result rejects mismatched signatures', badDual.status === 400, badDual.json.error);

  wsSpar.close();

  // Tournament sparring without register on new tournament — currently allowed by local server
  {
    const ws = await connectAuth(tokenA);
    const found = waitFor(ws, (p) => p.type === 'match-found' || p.type === 'error', 8000);
    ws.send(JSON.stringify({ type: 'find-sparring-match', mode: 'bot', tournamentId: newTid }));
    const pkt = await found;
    check(
      'NOTE sparring tournament without entry still pairs',
      pkt.type === 'match-found' && pkt.match?.tournamentId === newTid,
      pkt.type === 'error' ? pkt.message : `phase=${pkt.match?.tournamentPhase}`
    );
    ws.close();
  }

  // Register B + pair tournament
  await api(`/api/tournaments/${tQual.id}/register`, { method: 'POST', token: tokenB });
  {
    const wsA = await connectAuth(tokenA);
    const wsB = await connectAuth(tokenB);
    const foundA = waitFor(wsA, (p) => p.type === 'match-found' || p.type === 'error', 8000);
    const foundB = waitFor(wsB, (p) => p.type === 'match-found' || p.type === 'error', 8000);
    wsA.send(JSON.stringify({ type: 'find-tournament-match', tournamentId: tQual.id }));
    await new Promise((r) => setTimeout(r, 80));
    wsB.send(JSON.stringify({ type: 'find-tournament-match', tournamentId: tQual.id }));
    const [a, b] = await Promise.all([foundA, foundB]);
    check(
      'WS tournament pair',
      a.type === 'match-found' && b.type === 'match-found' && a.match.id === b.match.id && a.match.mode === 'bot',
      `phase=${a.match?.tournamentPhase} rules=${a.match?.rules?.id || 'none'}`
    );
    wsA.close();
    wsB.close();
  }

  // Human queue pair
  const regC = await api('/api/auth/register', {
    method: 'POST',
    body: { email: emailC, password, displayName: 'Flow Gamma' },
  });
  const tokenC = regC.json.token;
  {
    const wsA = await connectAuth(tokenA);
    const wsC = await connectAuth(tokenC);
    const foundA = waitFor(wsA, (p) => p.type === 'match-found', 8000);
    const foundC = waitFor(wsC, (p) => p.type === 'match-found', 8000);
    wsA.send(JSON.stringify({ type: 'find-match' }));
    await new Promise((r) => setTimeout(r, 80));
    wsC.send(JSON.stringify({ type: 'find-match' }));
    const [a, c] = await Promise.all([foundA, foundC]);
    check(
      'WS two-player human pair',
      a.match?.id === c.match?.id && a.match?.mode === 'human',
      `match=${a.match?.id}`
    );
    wsA.close();
    wsC.close();
  }

  const toggle = await api('/api/dev/toggle-admin', { method: 'POST', token: tokenA });
  check('dev toggle-admin grants admin', toggle.status === 200 && toggle.json.user?.isAdmin === true);
  const toggleBack = await api('/api/dev/toggle-admin', { method: 'POST', token: tokenA });
  check('dev toggle-admin revoke', toggleBack.status === 200 && toggleBack.json.user?.isAdmin === false);

  console.log('\n========== SUMMARY ==========');
  console.log(`passed=${passed} failed=${failed} total=${passed + failed}`);
  if (failed) {
    for (const r of results.filter((x) => !x.ok)) console.log(' -', r.name, r.detail);
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('AUDIT CRASH', err);
  process.exit(1);
});
