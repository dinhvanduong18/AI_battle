import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomInt, randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { createToken, hashPassword, verifyPassword, verifyToken } from './auth.js';
import { calculateElo } from './elo.js';
import { enqueueOrMatch, cancelQueue, enqueueTournamentOrMatch, cancelTournamentQueue } from './matchmaker.js';
import { hashCanonical, verifyConsensusDispute, verifyReplay, verifySessionProof } from './replay.js';
import { createReplayStorage } from './storage.js';
import {
  applyTournamentResult,
  formatTournamentStandings,
  rankTier,
  TOURNAMENT_RANKS,
  tournamentRanks
} from './tournament-ranks.js';
import { areBothMatchPlayersOffline } from './match-disconnect.js';

const pool = new Pool({ connectionString: config.databaseUrl });
const redis = createClient({ url: config.redisUrl });
redis.on('error', err => console.error('Redis error:', err.message));
const redisEvents = redis.duplicate();
const instanceId = randomUUID();
const replayStorage = createReplayStorage(config);
const liveSockets = new Map();
const searchTimers = new Map();
const MAX_BODY = 2 * 1024 * 1024;
let tournamentLifecycleTimer = null;
let disconnectForfeitTimer = null;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DISCONNECT_FORFEIT_MS = 0;
const TOURNAMENT_QUEUE_TIERS = [...TOURNAMENT_RANKS, 'Practice'];
const DEFAULT_SPRINT_RULES = ['standard', 'center_blockers', 'clipped_corners', 'corridor'];
const SPRINT_RULE_LAYOUTS = {
  standard: { title: 'Bàn chuẩn', blockedCells: [] },
  center_blockers: { title: 'Chướng ngại trung tâm', blockedCells: [30, 31, 32, 39, 40, 41, 48, 49, 50] },
  clipped_corners: { title: 'Bàn vát góc', blockedCells: [0, 1, 9, 10, 70, 71, 79, 80] },
  corridor: { title: 'Hành lang vật cản', blockedCells: [22, 24, 38, 40, 42, 56, 58] }
};

function tournamentQueueNamespace(search) {
  if (search.phase === 'practice') return 'ottv2:tournament-practice';
  return search.individual ? 'ottv2:tournament-player' : 'ottv2:tournament';
}

function weeklyRules(week, schedule = DEFAULT_SPRINT_RULES) {
  const sprint = Math.max(1, Number(week) || 1);
  const configuredSchedule = Array.isArray(schedule) && schedule.length ? schedule : DEFAULT_SPRINT_RULES;
  const layoutId = configuredSchedule[(sprint - 1) % configuredSchedule.length];
  const layout = SPRINT_RULE_LAYOUTS[layoutId] || SPRINT_RULE_LAYOUTS.standard;
  return { id: `sprint-${sprint}-${layoutId}`, week: sprint, title: layout.title, rows: 9, cols: 9, blockedCells: [...layout.blockedCells] };
}

async function clearTournamentQueues(tournamentId, ...weeks) {
  const keys = [...new Set(weeks.flatMap(week => ['ottv2:tournament', 'ottv2:tournament-player', 'ottv2:tournament-practice'].flatMap(namespace => TOURNAMENT_QUEUE_TIERS.map(tier => `${namespace}:${tournamentId}:${week}:${tier}`))))];
  if (keys.length) await redis.del(keys);
}

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
};
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === config.origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
const publicUser = user => ({ id: user.id, email: user.email, displayName: user.display_name, elo: user.elo, isAdmin: Boolean(user.is_admin) });
const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > MAX_BODY) {
      tooLarge = true;
      chunks.length = 0;
      reject(Object.assign(new Error('Request body too large'), { status: 413 }));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) return;
    try {
      const body = Buffer.concat(chunks).toString('utf8');
      resolve(body ? JSON.parse(body) : {});
    } catch {
      reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
    }
  });
  req.on('aborted', () => reject(new Error('Request body was aborted')));
  req.on('error', reject);
});
function authFromHeader(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) throw Object.assign(new Error('Authentication required'), { status: 401 });
  return verifyToken(match[1], config.jwtSecret);
}
function optionalAuthFromHeader(req) {
  return req.headers.authorization ? authFromHeader(req) : null;
}
function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}
function userSocket(userId) {
  const current = liveSockets.get(userId);
  return current && current.readyState === WebSocket.OPEN ? current : null;
}
async function deliverToUser(userId, type, data) {
  const socket = userSocket(userId);
  if (socket) {
    if (type === 'match-found') {
      socket.searchCancelled = true;
      socket.searching = false;
      const timer = searchTimers.get(userId); if (timer) clearTimeout(timer);
      searchTimers.delete(userId);
      await cancelQueue(redis, userId).catch(() => {});
      if (socket.tournamentSearch) {
        const search = socket.tournamentSearch;
        await cancelTournamentQueue(redis, search.tournamentId, search.teamId, userId, search.week, tournamentQueueNamespace(search)).catch(() => {});
        socket.tournamentSearch = null;
      }
    }
    send(socket, type, data);
    return;
  }
  await redis.publish(`ottv2:user:${userId}`, JSON.stringify({ type, data }));
}
function canonicalMatchIds(match) { return [match.player1_id, match.player2_id]; }

async function createMatch(user, paired, mode = 'human') {
  const [opponentResult] = await Promise.all([pool.query('SELECT id, email, display_name, elo FROM users WHERE id=$1', [paired.opponentId])]);
  const opponent = opponentResult.rows[0];
  if (!opponent) throw new Error('Opponent account no longer exists');
  const player1 = user.id < opponent.id ? user : opponent;
  const player2 = user.id < opponent.id ? opponent : user;
  const matchId = randomUUID();
  const seed = randomInt(1, 0x7fffffff);
  const matchType = mode === 'bot' ? 'bot' : 'human';
  await pool.query('INSERT INTO matches(id, seed, player1_id, player2_id, status, match_type) VALUES($1,$2,$3,$4,\'active\',$5)', [matchId, seed, player1.id, player2.id, matchType]);
  const record = { id: matchId, seed, player1_id: player1.id, player2_id: player2.id, match_type: matchType, created_at: new Date().toISOString() };
  for (const [player, role, other] of [[player1, 'player1', player2], [player2, 'player2', player1]]) {
    await deliverToUser(player.id, 'match-found', { match: record, role, opponent: publicUser(other), signaling: 'server-relay', mode });
  }
}

async function createTournamentMatch(user, pairing) {
  const tournamentResult = await pool.query('SELECT current_week,rules_json FROM tournaments WHERE id=$1 AND status=\'qualifying\'', [pairing.tournamentId]);
  const tournament = tournamentResult.rows[0];
  if (!tournament) throw Object.assign(new Error('Giải đã đổi trạng thái, hãy tìm lại trận.'), { status: 409 });
  if (pairing.week && Number(pairing.week) !== Number(tournament.current_week)) throw Object.assign(new Error('Luật tuần vừa được cập nhật; hãy tìm lại trận.'), { status: 409 });
  const rules = pairing.rules || (tournament.rules_json?.id ? tournament.rules_json : weeklyRules(tournament.current_week || 1));
  const opponentResult = await pool.query('SELECT id,email,display_name,elo,is_admin FROM users WHERE id=$1', [pairing.opponentUserId]);
  const opponent = opponentResult.rows[0];
  if (!opponent) throw new Error('Opponent account no longer exists');
  const teamsResult = await pool.query(
    `SELECT t.id,t.name,b.version,b.code,b.code_sha256
     FROM teams t JOIN team_bot_versions b ON b.team_id=t.id
     WHERE (t.id=$1 AND b.version=$2) OR (t.id=$3 AND b.version=$4)`,
    [pairing.teamId, pairing.botVersion, pairing.opponentTeamId, pairing.opponentVersion]
  );
  const teamMap = new Map(teamsResult.rows.map(team => [team.id, team]));
  const ownTeam = teamMap.get(pairing.teamId);
  const opponentTeam = teamMap.get(pairing.opponentTeamId);
  if (!ownTeam || !opponentTeam) throw new Error('A submitted bot version could not be found');
  const first = user.id < opponent.id
    ? { user, team: ownTeam }
    : { user: opponent, team: opponentTeam };
  const second = user.id < opponent.id
    ? { user: opponent, team: opponentTeam }
    : { user, team: ownTeam };
  const matchId = randomUUID();
  const seed = randomInt(1, 0x7fffffff);
  await pool.query(
    `INSERT INTO matches(id,seed,player1_id,player2_id,status,match_type,tournament_id,player1_team_id,player2_team_id,player1_bot_version,player2_bot_version,tournament_rules)
     VALUES($1,$2,$3,$4,'active','bot',$5,$6,$7,$8,$9,$10)`,
    [matchId, seed, first.user.id, second.user.id, pairing.tournamentId, first.team.id, second.team.id, first.team.version, second.team.version, JSON.stringify(rules)]
  );
  const record = {
    id: matchId, seed, player1_id: first.user.id, player2_id: second.user.id,
    tournament_id: pairing.tournamentId, created_at: new Date().toISOString()
  };
  for (const [player, role, other] of [[first, 'player1', second], [second, 'player2', first]]) {
    await deliverToUser(player.user.id, 'match-found', {
      match: record,
      role,
      opponent: publicUser(other.user),
      signaling: 'server-relay',
      tournamentRules: rules,
      tournamentBot: {
        tournamentId: pairing.tournamentId,
        teamId: player.team.id,
        teamName: player.team.name,
        version: player.team.version,
        sha256: player.team.code_sha256,
        code: player.team.code
      }
    });
  }
}

async function createIndividualTournamentMatch(user, pairing) {
  const tournamentResult = await pool.query(
    `SELECT id,status,registration_closes_at,ends_at,max_teams,current_week,rules_json
     FROM tournaments WHERE id=$1`,
    [pairing.tournamentId]
  );
  const tournament = tournamentResult.rows[0];
  if (!tournament) throw Object.assign(new Error('Không tìm thấy giải đấu.'), { status: 404 });
  const phase = pairing.phase;
  let rules = null;
  if (phase === 'practice') {
    const participantCount = await pool.query('SELECT count(*)::int AS count FROM tournament_entries WHERE tournament_id=$1', [pairing.tournamentId]);
    if (tournament.status !== 'registration' || new Date(tournament.registration_closes_at) <= new Date() ||
        new Date(tournament.ends_at) <= new Date() || participantCount.rows[0].count >= tournament.max_teams) {
      throw Object.assign(new Error('Vòng chạy đà đã kết thúc; hãy tìm trận chính thức nếu giải đã mở.'), { status: 409 });
    }
  } else {
    if (tournament.status !== 'qualifying' || new Date(tournament.ends_at) <= new Date()) {
      throw Object.assign(new Error('Giải chưa mở thi đấu chính thức hoặc đã kết thúc.'), { status: 409 });
    }
    if (Number(pairing.week) !== Number(tournament.current_week)) {
      throw Object.assign(new Error('Sprint vừa chuyển tuần; hãy tìm lại trận.'), { status: 409 });
    }
    rules = tournament.rules_json?.id ? tournament.rules_json : weeklyRules(tournament.current_week || 1);
  }
  const participants = await pool.query(
    'SELECT id,email,display_name,elo,is_admin FROM users WHERE id=ANY($1::uuid[])',
    [[user.id, pairing.opponentUserId]]
  );
  const byUser = new Map(participants.rows.map(row => [row.id, row]));
  const own = byUser.get(user.id);
  const opponent = byUser.get(pairing.opponentUserId);
  if (!own || !opponent) throw new Error('Không tìm thấy tài khoản của người chơi.');
  const first = user.id < opponent.id ? own : opponent;
  const second = user.id < opponent.id ? opponent : own;
  const matchId = randomUUID();
  const seed = randomInt(1, 0x7fffffff);
  await pool.query(
    `INSERT INTO matches(id,seed,player1_id,player2_id,status,match_type,tournament_id,tournament_phase,tournament_rules)
     VALUES($1,$2,$3,$4,'active','bot',$5,$6,$7)`,
    [matchId, seed, first.id, second.id, pairing.tournamentId, phase, rules ? JSON.stringify(rules) : null]
  );
  const record = { id: matchId, seed, player1_id: first.id, player2_id: second.id, tournament_id: pairing.tournamentId, created_at: new Date().toISOString() };
  for (const [player, role, other] of [[first, 'player1', second], [second, 'player2', first]]) {
    await deliverToUser(player.id, 'match-found', {
      match: record, role, opponent: publicUser(other), signaling: 'server-relay',
      mode: 'bot', tournamentPhase: phase, tournamentRules: rules
    });
  }
}

async function runIndividualTournamentSearch(userId) {
  await updateTournamentLifecycle();
  searchTimers.delete(userId);
  const socket = userSocket(userId);
  const search = socket?.tournamentSearch;
  if (!socket || !search || socket.searchCancelled) return;
  const result = await pool.query(
    `SELECT t.id AS tournament_id,t.status,t.registration_closes_at,t.ends_at,t.max_teams,
            t.current_week,t.rules_json,e.rank_stars,e.tier,u.elo,
            (SELECT count(*)::int FROM tournament_entries entries WHERE entries.tournament_id=t.id) AS participant_count
     FROM tournaments t JOIN tournament_entries e ON e.tournament_id=t.id AND e.player_id=$2
     JOIN users u ON u.id=e.player_id
     WHERE t.id=$1`, [search.tournamentId, userId]
  );
  const row = result.rows[0];
  if (!row || row.status === 'completed' || new Date(row.ends_at).getTime() <= Date.now()) {
    socket.searchCancelled = true; socket.searching = false;
    await cancelTournamentQueue(redis, search.tournamentId, userId, userId, search.week, tournamentQueueNamespace(search));
    socket.tournamentSearch = null;
    return send(socket, 'error', { message: 'Giải đấu đã kết thúc hoặc bạn chưa đăng ký.' });
  }
  if (socket.searchCancelled || socket.tournamentSearch !== search) return;
  const phase = row.status === 'registration' ? 'practice' : 'ranked';
  if (phase === 'practice' && (new Date(row.registration_closes_at).getTime() <= Date.now() ||
      row.participant_count >= row.max_teams)) {
    socket.searchCancelled = true; socket.searching = false;
    await cancelTournamentQueue(redis, search.tournamentId, userId, userId, search.week, tournamentQueueNamespace(search));
    socket.tournamentSearch = null;
    return send(socket, 'error', { message: 'Vòng chạy đà đã kết thúc; hãy tìm trận chính thức nếu giải đã mở.' });
  }
  const priorPhase = search.phase;
  const priorWeek = search.week;
  const priorNamespace = tournamentQueueNamespace(search);
  search.phase = phase;
  search.week = phase === 'practice' ? 1 : row.current_week || 1;
  search.tier = phase === 'practice' ? 'Practice' : row.tier;
  const namespace = tournamentQueueNamespace(search);
  if (priorPhase !== phase || Number(priorWeek) !== Number(search.week)) {
    await cancelTournamentQueue(redis, search.tournamentId, userId, userId, priorWeek, priorNamespace);
    send(socket, 'searching', {
      tournamentId: row.tournament_id, tournament: true, phase,
      tier: row.tier, week: row.current_week, rules: phase === 'ranked' ? row.rules_json : null
    });
  }
  const started = socket.searchStartedAt || Date.now();
  const gap = Math.min(config.maxEloGap, config.minEloGap + Math.floor((Date.now() - started) / config.expandEveryMs) * config.minEloGap);
  const paired = await enqueueTournamentOrMatch(
    redis,
    { teamId: userId, userId, version: 0, elo: phase === 'practice' ? row.elo : row.rank_stars * 100,
      tier: phase === 'practice' ? 'Practice' : row.tier, week: search.week },
    row.tournament_id, gap, namespace
  );
  if (paired) {
    socket.searchCancelled = true; socket.searching = false;
    const otherSocket = userSocket(paired.opponentUserId);
    if (otherSocket) { otherSocket.searchCancelled = true; otherSocket.searching = false; }
    await Promise.all([
      cancelTournamentQueue(redis, row.tournament_id, userId, userId, search.week, namespace),
      cancelTournamentQueue(redis, row.tournament_id, paired.opponentTeamId, paired.opponentUserId, paired.week, namespace)
    ]);
    const userResult = await pool.query('SELECT id,email,display_name,elo,is_admin FROM users WHERE id=$1', [userId]);
    await createIndividualTournamentMatch(userResult.rows[0], {
      tournamentId: row.tournament_id, phase, week: search.week,
      opponentUserId: paired.opponentUserId
    });
    socket.tournamentSearch = null;
    if (otherSocket) otherSocket.tournamentSearch = null;
    return;
  }
  searchTimers.set(userId, setTimeout(() => runIndividualTournamentSearch(userId).catch(error => {
    console.error('Individual tournament matchmaking retry failed:', error);
    socket.searchCancelled = true; socket.searching = false;
    cancelTournamentQueue(redis, search.tournamentId, userId, userId, search.week, tournamentQueueNamespace(search)).catch(() => {});
    socket.tournamentSearch = null;
    send(socket, 'error', { message: 'Không thể tìm trận giải đấu lúc này.' });
  }), 2000));
}

async function runTournamentSearch(userId) {
  if (userSocket(userId)?.tournamentSearch?.individual) return runIndividualTournamentSearch(userId);
  await updateTournamentLifecycle();
  searchTimers.delete(userId);
  const socket = userSocket(userId);
  const search = socket?.tournamentSearch;
  if (!socket || !search || socket.searchCancelled) return;
  const entry = await pool.query(
    `SELECT t.id AS tournament_id,t.name AS tournament_name,t.status,t.ends_at,t.current_week,t.rules_json,
            e.rank_stars,e.tier,team.id AS team_id,team.name AS team_name,team.captain_id,
            bot.version,bot.code,bot.code_sha256
     FROM tournaments t
     JOIN tournament_entries e ON e.tournament_id=t.id AND e.team_id=$2
     JOIN teams team ON team.id=e.team_id
     JOIN team_bot_versions bot ON bot.team_id=team.id AND bot.version=$3
     WHERE t.id=$1`,
    [search.tournamentId, search.teamId, search.botVersion]
  );
  const row = entry.rows[0];
  if (!row || row.status !== 'qualifying' || new Date(row.ends_at).getTime() <= Date.now()) {
    socket.searchCancelled = true;
    socket.searching = false;
    await cancelTournamentQueue(redis, search.tournamentId, search.teamId, userId, search.week);
    socket.tournamentSearch = null;
    return send(socket, 'error', { message: 'Giải không ở giai đoạn vòng loại hoặc đã kết thúc.' });
  }
  if (row.captain_id !== userId) {
    socket.searchCancelled = true;
    socket.searching = false;
    socket.tournamentSearch = null;
    return send(socket, 'error', { message: 'Chỉ đội trưởng mới có thể đưa đội vào hàng chờ giải.' });
  }
  const priorWeek = search.week;
  const priorTier = search.tier;
  if (search.week && Number(search.week) !== Number(row.current_week)) {
    await cancelTournamentQueue(redis, search.tournamentId, search.teamId, userId, search.week);
  }
  search.week = row.current_week || 1;
  search.tier = row.tier;
  if (Number(priorWeek) !== Number(search.week) || priorTier !== search.tier) {
    send(socket, 'searching', { tournamentId: row.tournament_id, teamId: row.team_id, tournament: true, tier: row.tier, week: row.current_week, rules: row.rules_json });
  }
  const started = socket.searchStartedAt || Date.now();
  const gap = Math.min(config.maxEloGap, config.minEloGap + Math.floor((Date.now() - started) / config.expandEveryMs) * config.minEloGap);
  const paired = await enqueueTournamentOrMatch(redis, {
    teamId: row.team_id, userId, version: row.version, elo: row.rank_stars * 100, tier: row.tier, week: row.current_week
  }, row.tournament_id, gap);
  if (paired) {
    socket.searchCancelled = true;
    socket.searching = false;
    const otherSocket = userSocket(paired.opponentUserId);
    if (otherSocket) { otherSocket.searchCancelled = true; otherSocket.searching = false; }
    await Promise.all([
      cancelTournamentQueue(redis, row.tournament_id, row.team_id, userId, row.current_week),
      cancelTournamentQueue(redis, row.tournament_id, paired.opponentTeamId, paired.opponentUserId, paired.week)
    ]);
    const userResult = await pool.query('SELECT id,email,display_name,elo,is_admin FROM users WHERE id=$1', [userId]);
    await createTournamentMatch(userResult.rows[0], {
      tournamentId: row.tournament_id,
      tier: row.tier,
      week: row.current_week,
      rules: row.rules_json,
      teamId: row.team_id,
      botVersion: row.version,
      opponentTeamId: paired.opponentTeamId,
      opponentUserId: paired.opponentUserId,
      opponentVersion: paired.opponentVersion
    });
    socket.tournamentSearch = null;
    if (otherSocket) otherSocket.tournamentSearch = null;
    return;
  }
  searchTimers.set(userId, setTimeout(() => runTournamentSearch(userId).catch(error => {
    console.error('Tournament matchmaking retry failed:', error);
    socket.searchCancelled = true;
    socket.searching = false;
    cancelTournamentQueue(redis, search.tournamentId, search.teamId, userId, search.week).catch(() => {});
    socket.tournamentSearch = null;
    send(socket, 'error', { message: 'Không thể tìm trận giải đấu lúc này.' });
  }), 2000));
}

async function runSearch(userId, mode = 'human') {
  searchTimers.delete(userId);
  const socket = userSocket(userId);
  if (!socket || socket.searchCancelled) return;
  const userResult = await pool.query('SELECT id, email, display_name, elo FROM users WHERE id=$1', [userId]);
  const user = userResult.rows[0];
  if (!user) return;
  const started = socket.searchStartedAt || Date.now();
  const gap = Math.min(config.maxEloGap, config.minEloGap + Math.floor((Date.now() - started) / config.expandEveryMs) * config.minEloGap);
  const queueName = mode === 'bot' ? 'ottv2:bot-matchmaking' : 'ottv2:matchmaking';
  const paired = await enqueueOrMatch(redis, user, { ...config, currentGap: gap, queueName });
  if (paired) {
    socket.searchCancelled = true;
    await Promise.all([cancelQueue(redis, userId, queueName), cancelQueue(redis, paired.opponentId, queueName)]);
    await createMatch(user, paired, mode);
    return;
  }
  searchTimers.set(userId, setTimeout(() => runSearch(userId, mode).catch(err => {
    console.error('Matchmaking retry failed:', err);
    searchTimers.delete(userId);
    if (liveSockets.get(userId) === socket) {
      socket.searchCancelled = true;
      socket.searching = false;
    }
    cancelQueue(redis, userId, queueName).catch(cleanupError => {
      console.error('Could not clear failed matchmaking queue entry:', cleanupError);
    });
    send(socket, 'error', { message: 'Matchmaking temporarily unavailable', mode });
  }), 2000));
}

async function initializeTournamentEntries(tournamentId) {
  await pool.query(
    `UPDATE tournament_entries entry SET
       tournament_elo=COALESCE(rating.elo,1200),
       tier=CASE WHEN COALESCE(rating.elo,1200)>=1600 THEN 'Gold'
                 WHEN COALESCE(rating.elo,1200)>=1350 THEN 'Silver' ELSE 'Bronze' END,
       rank_stars=0,season_points=0
     FROM (SELECT tm.team_id,ROUND(AVG(u.elo))::int AS elo FROM team_members tm JOIN users u ON u.id=tm.user_id GROUP BY tm.team_id) rating
     WHERE entry.tournament_id=$1 AND entry.team_id=rating.team_id AND entry.matches_played=0`,
    [tournamentId]
  );
  await pool.query(
    `UPDATE tournament_entries entry SET tournament_elo=u.elo,
       tier=CASE WHEN u.elo>=1600 THEN 'Gold'
                 WHEN u.elo>=1350 THEN 'Silver' ELSE 'Bronze' END,
       rank_stars=0,season_points=0
     FROM users u WHERE entry.tournament_id=$1 AND entry.player_id=u.id AND entry.matches_played=0`,
    [tournamentId]
  );
}

async function captureTournamentSprint(tournamentId, sprint) {
  await pool.query(
    `INSERT INTO tournament_sprint_standings
       (tournament_id,sprint,player_id,tier,rank_stars,season_points,matches_played,wins,draws,losses,registered_at)
     SELECT tournament_id,$2,player_id,tier,rank_stars,season_points,matches_played,wins,draws,losses,registered_at
     FROM tournament_entries
     WHERE tournament_id=$1 AND player_id IS NOT NULL
     ON CONFLICT (tournament_id,sprint,player_id) DO NOTHING`,
    [tournamentId, sprint]
  );
}

async function updateTournamentLifecycle() {
  const uninitialized = await pool.query("SELECT id,rules_schedule FROM tournaments WHERE status='qualifying' AND week_started_at IS NULL");
  for (const tournament of uninitialized.rows) {
    const initialized = await pool.query(
      "UPDATE tournaments SET current_week=1,week_started_at=now(),rules_json=$1::jsonb WHERE id=$2 AND week_started_at IS NULL RETURNING id",
      [JSON.stringify(weeklyRules(1, tournament.rules_schedule)), tournament.id]
    );
    if (!initialized.rowCount) continue;
    await initializeTournamentEntries(tournament.id);
    await clearTournamentQueues(tournament.id, 0, 1);
  }
  const starting = await pool.query(
    `SELECT t.id,t.rules_schedule FROM tournaments t
     WHERE t.status='registration' AND t.ends_at>now()
       AND (t.registration_closes_at<=now() OR
         (SELECT count(*) FROM tournament_entries entries WHERE entries.tournament_id=t.id)>=t.max_teams)`
  );
  for (const tournament of starting.rows) {
    const started = await pool.query(
      `UPDATE tournaments SET status='qualifying',current_week=1,week_started_at=now(),rules_json=$1::jsonb
       WHERE id=$2 AND status='registration' RETURNING id`,
      [JSON.stringify(weeklyRules(1, tournament.rules_schedule)), tournament.id]
    );
    if (started.rowCount) {
      await initializeTournamentEntries(tournament.id);
      await clearTournamentQueues(tournament.id, 0, 1);
    }
  }

  await pool.query(
    `UPDATE matches m SET status='abandoned'
     FROM tournaments t
     WHERE m.tournament_id=t.id AND m.status='active'
       AND (
         t.ends_at <= now() OR
         (m.tournament_phase='practice' AND (
           t.status <> 'registration' OR t.registration_closes_at <= now() OR
           (SELECT count(*) FROM tournament_entries entries WHERE entries.tournament_id=t.id)>=t.max_teams
         )) OR
         (m.tournament_phase <> 'practice' AND (
           t.status <> 'qualifying' OR t.week_started_at IS NULL OR
           COALESCE(
             CASE WHEN (m.tournament_rules->>'week') ~ '^[0-9]+$'
               THEN (m.tournament_rules->>'week')::integer
               ELSE 0
             END,
             0
           ) <> GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (now()-t.week_started_at)) / 604800)::integer + 1)
         ))
       )`
  );

  const active = await pool.query(
    `SELECT id,current_week,week_started_at,rules_schedule FROM tournaments
     WHERE status='qualifying' AND week_started_at IS NOT NULL AND ends_at>now()`
  );
  const now = Date.now();
  for (const tournament of active.rows) {
    const elapsedWeeks = Math.floor((now - new Date(tournament.week_started_at).getTime()) / WEEK_MS);
    const nextWeek = Math.max(1, elapsedWeeks + 1);
    if (nextWeek <= tournament.current_week) continue;
    await captureTournamentSprint(tournament.id, tournament.current_week);
    const rules = weeklyRules(nextWeek, tournament.rules_schedule);
    await pool.query('UPDATE tournaments SET current_week=$1,rules_json=$2::jsonb WHERE id=$3', [nextWeek, JSON.stringify(rules), tournament.id]);
    await clearTournamentQueues(tournament.id, 0, tournament.current_week, nextWeek);
  }
  await pool.query(`UPDATE tournaments SET status='completed' WHERE status <> 'completed' AND ends_at <= now()`);
}

async function registerSessionKey(userId, packet) {
  if (!packet.matchId || !packet.publicKey) throw new Error('Missing matchId/publicKey');
  const result = await pool.query('SELECT id, player1_id, player2_id FROM matches WHERE id=$1 AND status IN (\'active\',\'pending\')', [packet.matchId]);
  const match = result.rows[0];
  if (!match || !canonicalMatchIds(match).includes(userId)) throw new Error('Player is not part of this active match');
  const key = packet.publicKey;
  if (key.kty !== 'EC' || key.crv !== 'P-256' || typeof key.x !== 'string' || typeof key.y !== 'string') throw new Error('Only ECDSA P-256 session keys are accepted');
  const column = match.player1_id === userId ? 'player1_key' : 'player2_key';
  await pool.query(`UPDATE matches SET ${column}=$1::jsonb WHERE id=$2`, [JSON.stringify(key), packet.matchId]);
  const otherId = match.player1_id === userId ? match.player2_id : match.player1_id;
  await deliverToUser(otherId, 'peer-session-key', { matchId: packet.matchId, playerId: userId, publicKey: key });
}

async function updateTournamentEntriesForResult(client, match, score1) {
  if (!match.tournament_id || match.tournament_phase === 'practice') return;
  if (match.player1_team_id && match.player2_team_id) {
    const entries = await client.query(
      'SELECT team_id,tier,rank_stars,season_points FROM tournament_entries WHERE tournament_id=$1 AND team_id=ANY($2::uuid[]) ORDER BY team_id FOR UPDATE',
      [match.tournament_id, [match.player1_team_id, match.player2_team_id]]
    );
    const firstEntry = entries.rows.find(entry => entry.team_id === match.player1_team_id);
    const secondEntry = entries.rows.find(entry => entry.team_id === match.player2_team_id);
    if (!firstEntry || !secondEntry) throw Object.assign(new Error('Tournament entry missing for this match'), { status: 409 });
    for (const [entry, score] of [[firstEntry, score1], [secondEntry, 1 - score1]]) {
      const progress = applyTournamentResult(entry.tier, entry.rank_stars, entry.season_points, score);
      await client.query(
        `UPDATE tournament_entries SET
           matches_played=matches_played+1,
           wins=wins+CASE WHEN $3=1 THEN 1 ELSE 0 END,
           draws=draws+CASE WHEN $3=0.5 THEN 1 ELSE 0 END,
           losses=losses+CASE WHEN $3=0 THEN 1 ELSE 0 END,
           tier=$4,rank_stars=$5,season_points=$6
         WHERE tournament_id=$1 AND team_id=$2`,
        [match.tournament_id, entry.team_id, score, progress.tier, progress.stars, progress.seasonPoints]
      );
    }
    return;
  }
  const entries = await client.query(
    'SELECT player_id,tier,rank_stars,season_points FROM tournament_entries WHERE tournament_id=$1 AND player_id=ANY($2::uuid[]) ORDER BY player_id FOR UPDATE',
    [match.tournament_id, [match.player1_id, match.player2_id]]
  );
  const firstEntry = entries.rows.find(entry => entry.player_id === match.player1_id);
  const secondEntry = entries.rows.find(entry => entry.player_id === match.player2_id);
  if (!firstEntry || !secondEntry) throw Object.assign(new Error('Individual tournament entry missing for this match'), { status: 409 });
  for (const [entry, score] of [[firstEntry, score1], [secondEntry, 1 - score1]]) {
    const progress = applyTournamentResult(entry.tier, entry.rank_stars, entry.season_points, score);
    await client.query(
      `UPDATE tournament_entries SET
         matches_played=matches_played+1,
         wins=wins+CASE WHEN $3=1 THEN 1 ELSE 0 END,
         draws=draws+CASE WHEN $3=0.5 THEN 1 ELSE 0 END,
         losses=losses+CASE WHEN $3=0 THEN 1 ELSE 0 END,
         tier=$4,rank_stars=$5,season_points=$6
       WHERE tournament_id=$1 AND player_id=$2`,
      [match.tournament_id, entry.player_id, score, progress.tier, progress.stars, progress.seasonPoints]
    );
  }
}

async function submitResult(userId, body) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [body.matchId]);
    const match = result.rows[0];
    if (!match || !canonicalMatchIds(match).includes(userId)) throw Object.assign(new Error('Match not found for this player'), { status: 404 });
    if (match.status === 'completed') {
      const prior = await client.query('SELECT * FROM match_results WHERE match_id=$1', [body.matchId]);
      await client.query('COMMIT');
      const row = prior.rows[0];
      return { alreadySubmitted: true, matchId: match.id, winnerId: match.winner_id, finalStateHash: match.final_state_hash,
        elo: { player1: { before: row.player1_elo_before, after: row.player1_elo_after }, player2: { before: row.player2_elo_before, after: row.player2_elo_after } },
        eloUpdated: match.match_type === 'bot',
        replaySha256: match.replay_sha256 };
    }
    if (match.status !== 'active') throw Object.assign(new Error('Match is not active'), { status: 409 });
    if (match.tournament_id) {
      const lifecycle = await client.query(
        `WITH checked AS (SELECT clock_timestamp() AS at)
         SELECT t.status,t.registration_closes_at,t.ends_at,t.max_teams,t.week_started_at,
                checked.at < t.ends_at AS before_end,
                checked.at < t.registration_closes_at AS before_registration_close,
                (SELECT count(*)::int FROM tournament_entries entries WHERE entries.tournament_id=t.id) AS participant_count,
                CASE WHEN t.week_started_at IS NULL THEN NULL
                     ELSE GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (checked.at-t.week_started_at)) / 604800)::integer + 1)
                END AS active_week
         FROM tournaments t CROSS JOIN checked WHERE t.id=$1`,
        [match.tournament_id]
      );
      const tournament = lifecycle.rows[0];
      const practiceStillOpen = tournament?.status === 'registration' && tournament.before_registration_close &&
        tournament.participant_count < tournament.max_teams;
      const matchWeek = Number(match.tournament_rules?.week);
      const rankedSprintStillOpen = tournament?.status === 'qualifying' && tournament.before_end &&
        Number.isInteger(matchWeek) && matchWeek === Number(tournament.active_week);
      const validPhase = match.tournament_phase === 'practice' ? practiceStillOpen : rankedSprintStillOpen;
      if (!validPhase) {
        await client.query("UPDATE matches SET status='abandoned' WHERE id=$1 AND status='active'", [match.id]);
        await client.query('COMMIT');
        return {
          rejectedLate: true,
          matchId: match.id,
          error: match.tournament_phase === 'practice'
            ? 'Vòng chạy đà đã kết thúc trước khi kết quả được nộp; trận bị loại và không được tính Elo.'
            : 'Sprint hoặc giải đã kết thúc trước khi kết quả được nộp; trận bị loại và không được tính điểm hay Elo.'
        };
      }
    }
    const p1 = body.proofs?.player1;
    const p2 = body.proofs?.player2;
    if (!p1?.proof || !p1.signature || !p2?.proof || !p2.signature) throw Object.assign(new Error('Both signed player proofs are required'), { status: 400 });
    if (!match.player1_key || !match.player2_key) throw Object.assign(new Error('Both session public keys must be registered over the authenticated WebSocket'), { status: 409 });
    const proofShapeValid = proof => proof.matchId === match.id && proof.roomId === match.id &&
      Number.isInteger(proof.stepCount) && proof.stepCount >= 1 && /^[0-9a-f]{64}$/i.test(proof.stateHash || '') &&
      Number.isInteger(proof.winner) && [1, 2, 3].includes(proof.winner);
    if (!proofShapeValid(p1.proof) || !proofShapeValid(p2.proof) ||
        p1.proof.winner !== p2.proof.winner || p1.proof.stepCount !== p2.proof.stepCount || p1.proof.stateHash !== p2.proof.stateHash) {
      throw Object.assign(new Error('Players submitted conflicting final proofs'), { status: 409 });
    }
    if (!verifySessionProof(match.player1_key, p1.proof, p1.signature) || !verifySessionProof(match.player2_key, p2.proof, p2.signature)) {
      throw Object.assign(new Error('A final proof signature is invalid'), { status: 400 });
    }
    const replayResult = verifyReplay(body.replay, match.seed, match.id, match.tournament_rules || null);
    if (replayResult.finalHash !== p1.proof.stateHash || replayResult.stepCount !== p1.proof.stepCount || replayResult.winner !== p1.proof.winner) {
      throw Object.assign(new Error('Replay result does not match signed final proof'), { status: 400 });
    }
    const usersResult = await client.query('SELECT id, elo FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[match.player1_id, match.player2_id]]);
    const u1 = usersResult.rows.find(user => user.id === match.player1_id);
    const u2 = usersResult.rows.find(user => user.id === match.player2_id);
    const score1 = replayResult.winner === 1 ? 1 : replayResult.winner === 2 ? 0 : 0.5;
    const eloUpdated = match.match_type === 'bot';
    const elo1 = eloUpdated ? calculateElo(u1.elo, u2.elo, score1, config.fideK) : u1.elo;
    const elo2 = eloUpdated ? calculateElo(u2.elo, u1.elo, 1 - score1, config.fideK) : u2.elo;
    const storedReplay = await replayStorage.put(match.id, body.replay);
    if (eloUpdated) {
      await client.query('UPDATE users SET elo=$1 WHERE id=$2', [elo1, u1.id]);
      await client.query('UPDATE users SET elo=$1 WHERE id=$2', [elo2, u2.id]);
    }
    await client.query('INSERT INTO match_results(match_id,player1_elo_before,player2_elo_before,player1_elo_after,player2_elo_after,result_player1) VALUES($1,$2,$3,$4,$5,$6)', [match.id, u1.elo, u2.elo, elo1, elo2, score1]);
    let winnerId = replayResult.winner === 1 ? u1.id : replayResult.winner === 2 ? u2.id : null;
    await updateTournamentEntriesForResult(client, match, score1);
    await client.query(`UPDATE matches SET status='completed', winner_id=$1, final_state_hash=$2, replay_key=$3, replay_sha256=$4, replay_json=$5::jsonb, player1_proof=$6::jsonb, player2_proof=$7::jsonb, completed_at=now() WHERE id=$8`, [winnerId, replayResult.finalHash, storedReplay.key, storedReplay.checksum, storedReplay.json ? JSON.stringify(storedReplay.json) : null, JSON.stringify(p1), JSON.stringify(p2), match.id]);
    await client.query('COMMIT');
    return { matchId: match.id, winnerId, finalStateHash: replayResult.finalHash, elo: { player1: { before: u1.elo, after: elo1 }, player2: { before: u2.elo, after: elo2 } }, eloUpdated, replaySha256: storedReplay.checksum };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

async function resolveDisconnectedMatch(matchId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM matches
       WHERE id=$1 AND status='active'
         AND disconnected_player_id IS NOT NULL
         AND disconnected_at <= clock_timestamp() - ($2 * interval '1 millisecond')
       FOR UPDATE`,
      [matchId, DISCONNECT_FORFEIT_MS]
    );
    const match = found.rows[0];
    if (!match) {
      await client.query('COMMIT');
      return null;
    }

    if (await areBothMatchPlayersOffline(redis, match.player1_id, match.player2_id)) {
      await client.query(
        `UPDATE matches SET status='abandoned',completed_at=now(),
           disconnected_player_id=NULL,disconnected_at=NULL
         WHERE id=$1 AND status='active'`,
        [match.id]
      );
      await client.query('COMMIT');
      return {
        matchId: match.id,
        abandoned: true,
        bothPlayersDisconnected: true,
        player1Id: match.player1_id,
        player2Id: match.player2_id
      };
    }

    if (match.tournament_id) {
      const lifecycle = await client.query(
        `WITH checked AS (SELECT clock_timestamp() AS at)
         SELECT t.status,t.registration_closes_at,t.ends_at,t.max_teams,
                checked.at < t.ends_at AS before_end,
                checked.at < t.registration_closes_at AS before_registration_close,
                (SELECT count(*)::int FROM tournament_entries entries WHERE entries.tournament_id=t.id) AS participant_count,
                CASE WHEN t.week_started_at IS NULL THEN NULL
                     ELSE GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (checked.at-t.week_started_at)) / 604800)::integer + 1)
                END AS active_week
         FROM tournaments t CROSS JOIN checked WHERE t.id=$1`,
        [match.tournament_id]
      );
      const tournament = lifecycle.rows[0];
      const practiceStillOpen = match.tournament_phase === 'practice' &&
        tournament?.status === 'registration' && tournament.before_registration_close &&
        tournament.before_end && tournament.participant_count < tournament.max_teams;
      const matchWeek = Number(match.tournament_rules?.week);
      const rankedSprintStillOpen = match.tournament_phase === 'ranked' &&
        tournament?.status === 'qualifying' && tournament.before_end &&
        Number.isInteger(matchWeek) && matchWeek === Number(tournament.active_week);
      if (!practiceStillOpen && !rankedSprintStillOpen) {
        await client.query("UPDATE matches SET status='abandoned',completed_at=now() WHERE id=$1 AND status='active'", [match.id]);
        await client.query('COMMIT');
        return { matchId: match.id, abandoned: true, player1Id: match.player1_id, player2Id: match.player2_id };
      }
    }

    const disconnectedId = match.disconnected_player_id;
    const winnerId = disconnectedId === match.player1_id ? match.player2_id : match.player1_id;
    const score1 = winnerId === match.player1_id ? 1 : 0;
    const users = await client.query(
      'SELECT id,elo FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[match.player1_id, match.player2_id]]
    );
    const player1 = users.rows.find(user => user.id === match.player1_id);
    const player2 = users.rows.find(user => user.id === match.player2_id);
    if (!player1 || !player2) throw new Error('A player in the disconnected match no longer exists');

    const eloUpdated = match.match_type === 'bot';
    const player1EloAfter = eloUpdated ? calculateElo(player1.elo, player2.elo, score1, config.fideK) : player1.elo;
    const player2EloAfter = eloUpdated ? calculateElo(player2.elo, player1.elo, 1 - score1, config.fideK) : player2.elo;
    if (eloUpdated) {
      await client.query('UPDATE users SET elo=$1 WHERE id=$2', [player1EloAfter, player1.id]);
      await client.query('UPDATE users SET elo=$1 WHERE id=$2', [player2EloAfter, player2.id]);
    }
    await client.query(
      `INSERT INTO match_results
         (match_id,player1_elo_before,player2_elo_before,player1_elo_after,player2_elo_after,result_player1)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [match.id, player1.elo, player2.elo, player1EloAfter, player2EloAfter, score1]
    );
    await updateTournamentEntriesForResult(client, match, score1);
    await client.query(
      `UPDATE matches SET status='completed',winner_id=$1,completed_at=now(),
         disconnected_player_id=NULL,disconnected_at=NULL
       WHERE id=$2 AND status='active'`,
      [winnerId, match.id]
    );
    await client.query('COMMIT');
    return {
      matchId: match.id, winnerId, disconnectedId, player1Id: match.player1_id, player2Id: match.player2_id,
      eloUpdated, player1EloAfter, player2EloAfter
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processDisconnectedMatches() {
  const due = await pool.query(
    `SELECT id FROM matches
     WHERE status='active' AND disconnected_player_id IS NOT NULL
       AND disconnected_at <= clock_timestamp() - ($1 * interval '1 millisecond')
     ORDER BY disconnected_at LIMIT 50`,
    [DISCONNECT_FORFEIT_MS]
  );
  for (const { id } of due.rows) {
    const result = await resolveDisconnectedMatch(id);
    if (!result) continue;
    const players = [result.player1Id, result.player2Id];
    if (result.abandoned) {
      for (const playerId of players) {
        await deliverToUser(playerId, 'match-aborted', {
          matchId: result.matchId,
          message: result.bothPlayersDisconnected
            ? 'Trận đã bị hủy vì cả hai người chơi đều rời trận. Không tính thắng thua hoặc Elo.'
            : 'Trận đã bị hủy vì Sprint hoặc giai đoạn giải đấu đã kết thúc trước khi đối thủ ngắt kết nối đủ lâu.'
        });
      }
      continue;
    }
    for (const playerId of players) {
      const playerNumber = playerId === result.player1Id ? 1 : 2;
      const isWinner = playerId === result.winnerId;
      await deliverToUser(playerId, isWinner ? 'match-forfeited-win' : 'match-forfeited-loss', {
        matchId: result.matchId,
        winnerId: result.winnerId,
        winnerPlayer: result.winnerId === result.player1Id ? 1 : 2,
        disconnectedId: result.disconnectedId,
        message: isWinner
          ? 'Bạn thắng do đối thủ đã rời trận.'
          : 'Bạn thua do đã rời trận.',
        eloUpdated: result.eloUpdated,
        eloAfter: playerNumber === 1 ? result.player1EloAfter : result.player2EloAfter
      });
    }
  }
}

async function submitConsensusDispute(userId, body) {
  const report = body?.report;
  const evidence = body?.evidence;
  const proof = report?.payload;
  if (!proof || proof.kind !== 'consensus-dispute' || typeof report.signature !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(proof.evidenceHash || '') ||
      !/^[0-9a-f]{64}$/i.test(proof.localHash || '') ||
      !/^[0-9a-f]{64}$/i.test(proof.remoteHash || '')) {
    throw Object.assign(new Error('Malformed consensus dispute report'), { status: 400 });
  }
  const client = await pool.connect();
  let outcome;
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [proof.matchId]);
    const match = found.rows[0];
    if (!match || !canonicalMatchIds(match).includes(userId)) {
      throw Object.assign(new Error('Active match not found for this player'), { status: 404 });
    }
    if (match.status !== 'active') {
      const prior = await client.query(
        `SELECT d.status,d.winner_id,d.offender_id,d.reason,m.player1_id,m.player2_id,m.match_type,
                r.player1_elo_after,r.player2_elo_after
         FROM match_disputes d
         JOIN matches m ON m.id=d.match_id
         LEFT JOIN match_results r ON r.match_id=m.id
         WHERE d.match_id=$1`,
        [match.id]
      );
      if (prior.rows[0]) {
        const decision = prior.rows[0];
        await client.query('COMMIT');
        return {
          matchId: match.id,
          resolved: decision.status === 'adjudicated',
          winnerPlayer: decision.winner_id === match.player1_id ? 1 : decision.winner_id === match.player2_id ? 2 : null,
          offenderPlayer: decision.offender_id === match.player1_id ? 1 : decision.offender_id === match.player2_id ? 2 : null,
          eloUpdated: decision.status === 'adjudicated' && match.match_type === 'bot',
          player1EloAfter: decision.player1_elo_after,
          player2EloAfter: decision.player2_elo_after,
          message: 'This match dispute has already been processed.'
        };
      }
      throw Object.assign(new Error('Active match not found for this player'), { status: 404 });
    }
    const claimantSeat = match.player1_id === userId ? 1 : 2;
    if (proof.claimantSeat !== claimantSeat || proof.stepCount !== evidence?.moves?.length + 1 ||
        proof.stepCount !== evidence?.disputedStep?.stepCount ||
        !Array.isArray(evidence?.disputedStep?.acknowledgements) ||
        evidence.disputedStep.acknowledgements.length !== 2 ||
        evidence.matchId !== match.id || hashCanonical(evidence) !== proof.evidenceHash) {
      throw Object.assign(new Error('Consensus dispute report does not match its evidence'), { status: 400 });
    }
    const localAcknowledgement = evidence.disputedStep.acknowledgements.find(item => item?.payload?.player === claimantSeat);
    const remoteAcknowledgement = evidence.disputedStep.acknowledgements.find(item => item?.payload?.player !== claimantSeat);
    if (proof.localHash !== localAcknowledgement?.payload?.stateHash ||
        proof.remoteHash !== remoteAcknowledgement?.payload?.stateHash ||
        proof.localHash !== evidence.disputedStep.stateHash ||
        proof.localHash === proof.remoteHash) {
      throw Object.assign(new Error('Reported hashes do not match the signed acknowledgements'), { status: 400 });
    }
    const claimantKey = claimantSeat === 1 ? match.player1_key : match.player2_key;
    if (!verifySessionProof(claimantKey, proof, report.signature)) {
      throw Object.assign(new Error('Consensus dispute report signature is invalid'), { status: 400 });
    }
    const decision = verifyConsensusDispute(evidence, match);
    if (!decision.adjudicated) {
      await client.query(
        `INSERT INTO match_disputes(match_id,claimant_id,evidence,status,reason)
         VALUES($1,$2,$3::jsonb,'unresolved',$4)`,
        [match.id, userId, JSON.stringify(evidence), decision.reason]
      );
      await client.query("UPDATE matches SET status='disputed',completed_at=now() WHERE id=$1", [match.id]);
      outcome = {
        matchId: match.id, resolved: false,
        message: 'Server xác nhận có bất đồng hash nhưng bằng chứng chưa chỉ ra duy nhất bên sai. Trận bị hủy, không tính Elo hoặc rank.'
      };
    } else {
      const offenderId = decision.offenderSeat === 1 ? match.player1_id : match.player2_id;
      const winnerId = offenderId === match.player1_id ? match.player2_id : match.player1_id;
      const score1 = winnerId === match.player1_id ? 1 : 0;
      const users = await client.query(
        'SELECT id,elo FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[match.player1_id, match.player2_id]]
      );
      const player1 = users.rows.find(user => user.id === match.player1_id);
      const player2 = users.rows.find(user => user.id === match.player2_id);
      if (!player1 || !player2) throw new Error('A player in the disputed match no longer exists');
      const eloUpdated = match.match_type === 'bot';
      const player1EloAfter = eloUpdated ? calculateElo(player1.elo, player2.elo, score1, config.fideK) : player1.elo;
      const player2EloAfter = eloUpdated ? calculateElo(player2.elo, player1.elo, 1 - score1, config.fideK) : player2.elo;
      if (eloUpdated) {
        await client.query('UPDATE users SET elo=$1 WHERE id=$2', [player1EloAfter, player1.id]);
        await client.query('UPDATE users SET elo=$1 WHERE id=$2', [player2EloAfter, player2.id]);
      }
      await client.query(
        `INSERT INTO match_results
           (match_id,player1_elo_before,player2_elo_before,player1_elo_after,player2_elo_after,result_player1)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [match.id, player1.elo, player2.elo, player1EloAfter, player2EloAfter, score1]
      );
      await updateTournamentEntriesForResult(client, match, score1);
      await client.query(
        `INSERT INTO match_disputes(match_id,claimant_id,evidence,status,offender_id,winner_id,reason)
         VALUES($1,$2,$3::jsonb,'adjudicated',$4,$5,$6)`,
        [match.id, userId, JSON.stringify(evidence), offenderId, winnerId, decision.reason]
      );
      await client.query(
        `UPDATE matches SET status='completed',winner_id=$1,completed_at=now(),
           disconnected_player_id=NULL,disconnected_at=NULL WHERE id=$2`,
        [winnerId, match.id]
      );
      outcome = {
        matchId: match.id, resolved: true, winnerId,
        winnerPlayer: winnerId === match.player1_id ? 1 : 2,
        offenderId, offenderPlayer: decision.offenderSeat,
        stepCount: decision.stepCount, eloUpdated,
        player1EloAfter, player2EloAfter,
        message: 'Server đã xác minh transcript và xử thua bên gửi hash sai.'
      };
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  for (const playerId of [outcome.winnerId, outcome.offenderId].filter(Boolean)) {
    const playerNumber = playerId === outcome.winnerId ? outcome.winnerPlayer : outcome.offenderPlayer;
    await deliverToUser(playerId, 'match-dispute-result', {
      matchId: outcome.matchId,
      resolved: outcome.resolved,
      winnerPlayer: outcome.winnerPlayer || null,
      offenderPlayer: outcome.offenderPlayer || null,
      eloUpdated: outcome.eloUpdated || false,
      eloAfter: playerNumber === 1 ? outcome.player1EloAfter : outcome.player2EloAfter,
      message: outcome.message
    });
  }
  if (!outcome.resolved) {
    const match = await pool.query('SELECT player1_id,player2_id FROM matches WHERE id=$1', [outcome.matchId]);
    for (const playerId of [match.rows[0].player1_id, match.rows[0].player2_id]) {
      await deliverToUser(playerId, 'match-dispute-result', {
        matchId: outcome.matchId, resolved: false, message: outcome.message
      });
    }
  }
  return outcome;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const displayName = String(body.displayName || '').trim().slice(0, 40);
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10 || !displayName) return json(res, 400, { error: 'Provide a valid email, display name and password of at least 10 characters' });
      const passwordHash = await hashPassword(password);
      const created = await pool.query('INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) RETURNING id,email,display_name,elo', [email, passwordHash, displayName]);
      const user = created.rows[0];
      return json(res, 201, { token: createToken(user, config.jwtSecret), user: publicUser(user) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const result = await pool.query('SELECT id,email,password_hash,display_name,elo,is_admin FROM users WHERE email=$1', [email]);
      const user = result.rows[0];
      if (!user || !await verifyPassword(String(body.password || ''), user.password_hash)) return json(res, 401, { error: 'Email or password is incorrect' });
      return json(res, 200, { token: createToken(user, config.jwtSecret), user: publicUser(user) });
    }
    if (req.method === 'GET' && url.pathname === '/api/tournaments') {
      await updateTournamentLifecycle();
      const result = await pool.query(
        `SELECT t.id,t.name,t.format,t.description,t.status,t.registration_closes_at,t.ends_at,
                t.max_teams,t.current_week,t.rules_json,t.created_at,
                count(e.tournament_id)::int AS participant_count
         FROM tournaments t LEFT JOIN tournament_entries e ON e.tournament_id=t.id
         WHERE t.status IN ('registration','qualifying','completed')
         GROUP BY t.id ORDER BY CASE t.status WHEN 'registration' THEN 0 WHEN 'qualifying' THEN 1 ELSE 2 END,t.created_at DESC`
      );
      return json(res, 200, { tournaments: result.rows });
    }
    if (req.method === 'GET' && /^\/api\/tournaments\/[0-9a-f-]+$/i.test(url.pathname)) {
      await updateTournamentLifecycle();
      const tournamentId = url.pathname.split('/')[3];
      const result = await pool.query('SELECT * FROM tournaments WHERE id=$1', [tournamentId]);
      const tournament = result.rows[0];
      if (!tournament) return json(res, 404, { error: 'Tournament not found' });
      const auth = optionalAuthFromHeader(req);
      const sprintStartedAt = tournament.week_started_at
        ? new Date(tournament.week_started_at).getTime() + (Number(tournament.current_week) - 1) * WEEK_MS
        : 0;
      const sprintRevealOpen = tournament.status === 'qualifying' &&
        Number(tournament.current_week) > 1 &&
        Date.now() >= sprintStartedAt && Date.now() < sprintStartedAt + 24 * 60 * 60 * 1000;
      const [participants, participantNames, ownEntry, matches, sprintStandings, finalStandings] = await Promise.all([
        pool.query('SELECT count(*)::int AS count FROM tournament_entries WHERE tournament_id=$1', [tournamentId]),
        pool.query(
          `SELECT u.display_name AS "displayName"
           FROM tournament_entries e JOIN users u ON u.id=e.player_id
           WHERE e.tournament_id=$1 AND e.player_id IS NOT NULL
           ORDER BY e.registered_at ASC`,
          [tournamentId]
        ),
        auth
          ? pool.query(
            `SELECT COALESCE(entry.player_id,entry.team_id) AS "playerId",entry.tier,entry.rank_stars AS "stars",
                    entry.season_points AS "seasonPoints",entry.matches_played AS "matchesPlayed",entry.wins,entry.draws,entry.losses,
                    CASE WHEN entry.tier='Challenger' THEN (
                      SELECT count(*)::int+1 FROM tournament_entries ahead
                      WHERE ahead.tournament_id=entry.tournament_id AND ahead.tier='Challenger'
                        AND (ahead.season_points>entry.season_points OR
                          (ahead.season_points=entry.season_points AND ahead.wins>entry.wins) OR
                          (ahead.season_points=entry.season_points AND ahead.wins=entry.wins AND ahead.registered_at<entry.registered_at))
                    ) ELSE NULL END AS "privateRank"
             FROM tournament_entries entry WHERE entry.tournament_id=$1 AND (entry.player_id=$2 OR entry.team_id IN (
               SELECT team_id FROM team_members WHERE user_id=$2
             )) ORDER BY CASE WHEN entry.player_id=$2 THEN 0 ELSE 1 END LIMIT 1`,
            [tournamentId, auth.sub]
          )
          : Promise.resolve({ rows: [] }),
        pool.query(
        `SELECT m.id,m.status,m.seed,m.tournament_phase AS "tournamentPhase",
                m.tournament_rules->>'week' AS sprint,
                m.player1_bot_version AS "player1BotVersion",m.player2_bot_version AS "player2BotVersion",
                m.created_at AS "createdAt",m.completed_at AS "completedAt",m.winner_id AS "winnerUserId",
                COALESCE(t1.name,u1.display_name) AS "player1Name",COALESCE(t2.name,u2.display_name) AS "player2Name",
                CASE WHEN m.winner_id=m.player1_id THEN u1.display_name
                     WHEN m.winner_id=m.player2_id THEN u2.display_name
                     WHEN m.winner_id=m.player1_team_id THEN t1.name
                     WHEN m.winner_id=m.player2_team_id THEN t2.name END AS "winnerName",
                CASE WHEN m.winner_id=m.player1_id THEN COALESCE(m.player1_team_id,m.player1_id) WHEN m.winner_id=m.player2_id THEN COALESCE(m.player2_team_id,m.player2_id) END AS "winnerId"
         FROM matches m LEFT JOIN teams t1 ON t1.id=m.player1_team_id LEFT JOIN teams t2 ON t2.id=m.player2_team_id
         JOIN users u1 ON u1.id=m.player1_id JOIN users u2 ON u2.id=m.player2_id
         WHERE m.tournament_id=$1 AND $2::uuid IS NOT NULL
           AND (
             m.player1_id=$2 OR m.player2_id=$2 OR
             m.player1_team_id IN (SELECT team_id FROM team_members WHERE user_id=$2) OR
             m.player2_team_id IN (SELECT team_id FROM team_members WHERE user_id=$2)
           )
         ORDER BY m.created_at DESC LIMIT 100`, [tournamentId, auth?.sub || null]
        ),
        sprintRevealOpen
          ? pool.query(
            `SELECT s.player_id AS "playerId",u.display_name AS "displayName",s.tier,s.rank_stars AS stars,
                    s.season_points AS "seasonPoints",s.matches_played AS "matchesPlayed",
                    s.wins,s.draws,s.losses
             FROM tournament_sprint_standings s JOIN users u ON u.id=s.player_id
             WHERE s.tournament_id=$1 AND s.sprint=$2
             ORDER BY CASE s.tier WHEN 'Challenger' THEN 5 WHEN 'Master' THEN 4 WHEN 'Gold' THEN 3 WHEN 'Silver' THEN 2 ELSE 1 END DESC,
                      CASE WHEN s.tier='Challenger' THEN s.season_points ELSE s.rank_stars END DESC,
                      s.wins DESC,s.registered_at ASC`,
            [tournamentId, Number(tournament.current_week) - 1]
          )
          : Promise.resolve({ rows: [] }),
        tournament.status === 'completed'
          ? pool.query(
            `SELECT e.player_id AS "playerId",u.display_name AS "displayName",e.tier,e.rank_stars AS stars,
                    e.season_points AS "seasonPoints",e.matches_played AS "matchesPlayed",
                    e.wins,e.draws,e.losses
             FROM tournament_entries e JOIN users u ON u.id=e.player_id
             WHERE e.tournament_id=$1 AND e.player_id IS NOT NULL
             ORDER BY CASE e.tier WHEN 'Challenger' THEN 5 WHEN 'Master' THEN 4 WHEN 'Gold' THEN 3 WHEN 'Silver' THEN 2 ELSE 1 END DESC,
                      CASE WHEN e.tier='Challenger' THEN e.season_points ELSE e.rank_stars END DESC,
                      e.wins DESC,e.registered_at ASC`,
            [tournamentId]
          )
          : Promise.resolve({ rows: [] })
      ]);
      const privateEntry = ownEntry.rows[0] || null;
      if (privateEntry) delete privateEntry.privateRank;
      delete tournament.rules_schedule;
      return json(res, 200, {
        tournament,
        participantCount: participants.rows[0].count,
        participants: participantNames.rows.map(row => row.displayName),
        ranks: tournamentRanks(),
        myEntry: privateEntry,
        matches: matches.rows,
        standings: tournament.status === 'completed'
          ? formatTournamentStandings(finalStandings.rows)
          : sprintRevealOpen
            ? formatTournamentStandings(sprintStandings.rows)
            : null,
        sprintStandings: sprintRevealOpen ? {
          sprint: Number(tournament.current_week) - 1,
          temporary: true,
          players: sprintStandings.rows
        } : null,
        finalStandings: tournament.status === 'completed' ? finalStandings.rows : null
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/tournaments') {
      const auth = authFromHeader(req);
      const admin = await pool.query('SELECT is_admin FROM users WHERE id=$1', [auth.sub]);
      if (!admin.rows[0]?.is_admin) throw Object.assign(new Error('Tournament organizer permission required'), { status: 403 });
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 100);
      const format = String(body.format || 'ranked_weekly').trim();
      const description = String(body.description || '').trim().slice(0, 2000);
      const registrationClosesAt = new Date(body.registrationClosesAt);
      const endsAt = new Date(body.endsAt);
      const maxTeams = Math.min(256, Math.max(2, Number(body.maxTeams) || 64));
      const sprintRules = Array.isArray(body.sprintRules) ? body.sprintRules : DEFAULT_SPRINT_RULES;
      if (format !== 'ranked_weekly') return json(res, 400, { error: 'Thể thức này chưa được hỗ trợ.' });
      if (!name) return json(res, 400, { error: 'Vui lòng nhập tên giải.' });
      if (sprintRules.length !== 4 || sprintRules.some(rule => !Object.hasOwn(SPRINT_RULE_LAYOUTS, rule))) {
        return json(res, 400, { error: 'Hãy chọn luật hợp lệ cho đủ 4 Sprint.' });
      }
      if (!Number.isFinite(registrationClosesAt.getTime())) return json(res, 400, { error: 'Thời điểm đóng đăng ký không hợp lệ.' });
      if (!Number.isFinite(endsAt.getTime())) return json(res, 400, { error: 'Thời điểm kết thúc giải không hợp lệ.' });
      if (registrationClosesAt <= new Date()) return json(res, 400, { error: 'Thời điểm đóng đăng ký phải nằm trong tương lai.' });
      if (endsAt <= registrationClosesAt) return json(res, 400, { error: 'Thời điểm kết thúc giải phải sau thời điểm đóng đăng ký.' });
      const created = await pool.query(
        `INSERT INTO tournaments(name,format,description,registration_closes_at,ends_at,max_teams,rules_schedule)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
        [name, format, description, registrationClosesAt, endsAt, maxTeams, JSON.stringify(sprintRules)]
      );
      return json(res, 201, { tournament: created.rows[0] });
    }
    if (req.method === 'POST' && /^\/api\/tournaments\/[0-9a-f-]+\/start$/i.test(url.pathname)) {
      const auth = authFromHeader(req);
      const admin = await pool.query('SELECT is_admin FROM users WHERE id=$1', [auth.sub]);
      if (!admin.rows[0]?.is_admin) throw Object.assign(new Error('Tournament organizer permission required'), { status: 403 });
      const tournamentId = url.pathname.split('/')[3];
      const scheduleResult = await pool.query("SELECT rules_schedule FROM tournaments WHERE id=$1 AND status='registration' AND ends_at>now()", [tournamentId]);
      if (!scheduleResult.rowCount) throw Object.assign(new Error('Không tìm thấy giải đang trong giai đoạn đăng ký.'), { status: 409 });
      const result = await pool.query(
        `UPDATE tournaments SET status='qualifying',current_week=1,week_started_at=now(),rules_json=$2::jsonb
         WHERE id=$1 AND status='registration' AND ends_at>now() RETURNING *`,
        [tournamentId, JSON.stringify(weeklyRules(1, scheduleResult.rows[0].rules_schedule))]
      );
      if (!result.rows[0]) throw Object.assign(new Error('Tournament cannot start in its current state'), { status: 409 });
      await clearTournamentQueues(tournamentId, 0, 1);
      return json(res, 200, { tournament: result.rows[0] });
    }
    if (req.method === 'GET' && url.pathname === '/api/bots/me') {
      const auth = authFromHeader(req);
      const result = await pool.query(
        `SELECT u.active_bot_version AS version,b.code,b.code_sha256 AS sha256,b.created_at AS "createdAt",
                COALESCE((SELECT json_agg(e.tournament_id) FROM tournament_entries e WHERE e.player_id=u.id),'[]'::json) AS "tournamentIds"
         FROM users u LEFT JOIN user_bot_versions b ON b.user_id=u.id AND b.version=u.active_bot_version WHERE u.id=$1`, [auth.sub]
      );
      return json(res, 200, { bot: result.rows[0] || { version: 0, code: '', sha256: '', tournamentIds: [] } });
    }
    if (req.method === 'POST' && url.pathname === '/api/bots/me') {
      const auth = authFromHeader(req);
      const body = await readBody(req);
      const code = String(body.code || '');
      if (!code.trim() || code.length > 120000) return json(res, 400, { error: 'Mã Python phải có từ 1 đến 120000 ký tự.' });
      if (!/^\s*def\s+(get_next_move|getNextMove)\s*\(/m.test(code)) return json(res, 400, { error: 'Bot cần định nghĩa hàm get_next_move(my_player_id, game_state).' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const owner = await client.query('SELECT active_bot_version FROM users WHERE id=$1 FOR UPDATE', [auth.sub]);
        if (!owner.rows[0]) throw Object.assign(new Error('Không tìm thấy tài khoản.'), { status: 404 });
        const version = owner.rows[0].active_bot_version + 1;
        const sha256 = createHash('sha256').update(code).digest('hex');
        // Each account owns one current bot slot; saving publishes a new revision
        // into that slot instead of accumulating separately selectable bots.
        await client.query('DELETE FROM user_bot_versions WHERE user_id=$1', [auth.sub]);
        await client.query('INSERT INTO user_bot_versions(user_id,version,code,code_sha256) VALUES($1,$2,$3,$4)', [auth.sub, version, code, sha256]);
        await client.query('UPDATE users SET active_bot_version=$1 WHERE id=$2', [version, auth.sub]);
        await client.query(
          `UPDATE tournament_entries e SET bot_version=$2 FROM tournaments t
           WHERE e.tournament_id=t.id AND e.player_id=$1 AND t.status IN ('registration','qualifying')`, [auth.sub, version]
        );
        await client.query('COMMIT');
        try {
          const activeEntries = await pool.query(
            `SELECT t.id,t.current_week FROM tournament_entries e JOIN tournaments t ON t.id=e.tournament_id
             WHERE e.player_id=$1 AND t.status='qualifying'`, [auth.sub]
          );
          for (const entry of activeEntries.rows) await cancelTournamentQueue(redis, entry.id, auth.sub, auth.sub, entry.current_week, 'ottv2:tournament-player');
          const socket = userSocket(auth.sub);
          if (socket?.tournamentSearch) {
            socket.searchCancelled = true;
            socket.searching = false;
            const timer = searchTimers.get(auth.sub); if (timer) clearTimeout(timer);
            searchTimers.delete(auth.sub);
            socket.tournamentSearch = null;
            send(socket, 'search-cancelled', { message: 'Bot đã cập nhật. Hãy tìm trận lại để dùng phiên bản mới.' });
          }
        } catch (queueError) { console.error('Could not refresh tournament queue after bot update:', queueError.message); }
        return json(res, 201, { version, sha256 });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'GET' && url.pathname === '/api/teams') {
      const auth = authFromHeader(req);
      const result = await pool.query(
        `SELECT t.id,t.name,t.captain_id AS "captainId",t.invite_code AS "inviteCode",
                t.active_bot_version AS "activeBotVersion",tm.role,
                COALESCE(bot.code,'') AS "botCode",COALESCE(bot.code_sha256,'') AS "botSha256",
                (SELECT count(*)::int FROM team_members members WHERE members.team_id=t.id) AS "memberCount",
                COALESCE((SELECT json_agg(entry.tournament_id) FROM tournament_entries entry WHERE entry.team_id=t.id),'[]'::json) AS "tournamentIds"
         FROM teams t JOIN team_members tm ON tm.team_id=t.id
         LEFT JOIN team_bot_versions bot ON bot.team_id=t.id AND bot.version=t.active_bot_version
         WHERE tm.user_id=$1 ORDER BY t.created_at DESC`, [auth.sub]
      );
      return json(res, 200, { teams: result.rows });
    }
    if (req.method === 'POST' && url.pathname === '/api/teams') {
      const auth = authFromHeader(req);
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 60);
      if (name.length < 2) return json(res, 400, { error: 'Tên đội cần ít nhất 2 ký tự.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const team = await client.query(
          'INSERT INTO teams(name,captain_id,invite_code) VALUES($1,$2,$3) RETURNING id,name,captain_id AS "captainId",invite_code AS "inviteCode",active_bot_version AS "activeBotVersion"',
          [name, auth.sub, randomBytes(5).toString('hex').toUpperCase()]
        );
        await client.query("INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'captain')", [team.rows[0].id, auth.sub]);
        await client.query('COMMIT');
        return json(res, 201, { team: { ...team.rows[0], role: 'captain', memberCount: 1, botCode: '' } });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'POST' && url.pathname === '/api/teams/join') {
      const auth = authFromHeader(req);
      const body = await readBody(req);
      const inviteCode = String(body.inviteCode || '').trim().toUpperCase();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query('SELECT id,name FROM teams WHERE invite_code=$1 FOR UPDATE', [inviteCode]);
        const team = found.rows[0];
        if (!team) throw Object.assign(new Error('Mã mời đội không hợp lệ.'), { status: 404 });
        const count = await client.query('SELECT count(*)::int AS count FROM team_members WHERE team_id=$1', [team.id]);
        if (count.rows[0].count >= 4) throw Object.assign(new Error('Đội đã đủ tối đa 4 thành viên.'), { status: 409 });
        await client.query("INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member')", [team.id, auth.sub]);
        await client.query('COMMIT');
        return json(res, 200, { team: { id: team.id, name: team.name, role: 'member' } });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'POST' && /^\/api\/teams\/[0-9a-f-]+\/bot$/i.test(url.pathname)) {
      const auth = authFromHeader(req);
      const teamId = url.pathname.split('/')[3];
      const body = await readBody(req);
      const code = String(body.code || '');
      if (!code.trim() || code.length > 120000) return json(res, 400, { error: 'Mã Python phải có từ 1 đến 120000 ký tự.' });
      if (!/^\s*def\s+(get_next_move|getNextMove)\s*\(/m.test(code)) return json(res, 400, { error: 'Bot cần định nghĩa hàm get_next_move(my_player_id, game_state).' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query('SELECT captain_id,active_bot_version FROM teams WHERE id=$1 FOR UPDATE', [teamId]);
        const team = found.rows[0];
        if (!team) throw Object.assign(new Error('Không tìm thấy đội.'), { status: 404 });
        if (team.captain_id !== auth.sub) throw Object.assign(new Error('Chỉ đội trưởng mới được nộp bot.'), { status: 403 });
        const version = team.active_bot_version + 1;
        const codeSha256 = createHash('sha256').update(code).digest('hex');
        await client.query('INSERT INTO team_bot_versions(team_id,version,code,code_sha256,created_by) VALUES($1,$2,$3,$4,$5)', [teamId, version, code, codeSha256, auth.sub]);
        await client.query('UPDATE teams SET active_bot_version=$1 WHERE id=$2', [version, teamId]);
        await client.query('COMMIT');
        return json(res, 201, { version, sha256: codeSha256 });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'POST' && /^\/api\/tournaments\/[0-9a-f-]+\/register$/i.test(url.pathname)) {
      const auth = authFromHeader(req);
      const tournamentId = url.pathname.split('/')[3];
      await updateTournamentLifecycle();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tournamentResult = await client.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [tournamentId]);
        const tournament = tournamentResult.rows[0];
        if (!tournament || tournament.status !== 'registration' || new Date(tournament.registration_closes_at) <= new Date()) {
          throw Object.assign(new Error('Giải không nhận đăng ký ở thời điểm này.'), { status: 409 });
        }
        const playerResult = await client.query('SELECT elo FROM users WHERE id=$1 FOR UPDATE', [auth.sub]);
        const player = playerResult.rows[0];
        if (!player) throw Object.assign(new Error('Không tìm thấy tài khoản.'), { status: 404 });
        const existing = await client.query('SELECT 1 FROM tournament_entries WHERE tournament_id=$1 AND player_id=$2', [tournamentId, auth.sub]);
        if (existing.rowCount) throw Object.assign(new Error('Bạn đã đăng ký giải này rồi.'), { status: 409 });
        const total = await client.query('SELECT count(*)::int AS count FROM tournament_entries WHERE tournament_id=$1', [tournamentId]);
        if (total.rows[0].count >= tournament.max_teams) throw Object.assign(new Error('Giải đã đủ số người tham gia.'), { status: 409 });
        const inserted = await client.query(
          `INSERT INTO tournament_entries(tournament_id,player_id,tournament_elo,tier)
           VALUES($1,$2,$3,'Bronze') ON CONFLICT (tournament_id,player_id) WHERE player_id IS NOT NULL DO NOTHING RETURNING player_id`,
          [tournamentId, auth.sub, player.elo]
        );
        if (!inserted.rowCount) throw Object.assign(new Error('Bạn đã đăng ký giải này rồi.'), { status: 409 });
        await client.query('COMMIT');
        await updateTournamentLifecycle();
        return json(res, 201, { registered: true });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const auth = authFromHeader(req);
      const result = await pool.query('SELECT id,email,display_name,elo,is_admin FROM users WHERE id=$1', [auth.sub]);
      if (!result.rows[0]) return json(res, 401, { error: 'Account not found' });
      return json(res, 200, { user: publicUser(result.rows[0]) });
    }
    if (req.method === 'PATCH' && url.pathname === '/api/me') {
      const auth = authFromHeader(req);
      const body = await readBody(req);
      const displayName = body.displayName === undefined ? null : String(body.displayName).trim().slice(0, 40);
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      if (displayName !== null && !displayName) return json(res, 400, { error: 'Tên hiển thị không được để trống.' });
      if (newPassword && newPassword.length < 10) return json(res, 400, { error: 'Mật khẩu mới cần ít nhất 10 ký tự.' });
      if (Boolean(currentPassword) !== Boolean(newPassword)) return json(res, 400, { error: 'Cần nhập cả mật khẩu hiện tại và mật khẩu mới.' });
      if (displayName === null && !newPassword) return json(res, 400, { error: 'Hãy nhập tên mới hoặc mật khẩu mới.' });

      const found = await pool.query('SELECT id,email,password_hash,display_name,elo,is_admin FROM users WHERE id=$1', [auth.sub]);
      const user = found.rows[0];
      if (!user) return json(res, 401, { error: 'Account not found' });
      if (newPassword && !await verifyPassword(currentPassword, user.password_hash)) {
        return json(res, 400, { error: 'Mật khẩu hiện tại không chính xác.' });
      }
      const nextName = displayName ?? user.display_name;
      if (newPassword) {
        const passwordHash = await hashPassword(newPassword);
        await pool.query('UPDATE users SET display_name=$1,password_hash=$2 WHERE id=$3', [nextName, passwordHash, auth.sub]);
      } else if (displayName !== null) {
        await pool.query('UPDATE users SET display_name=$1 WHERE id=$2', [nextName, auth.sub]);
      }
      const updated = await pool.query('SELECT id,email,display_name,elo,is_admin FROM users WHERE id=$1', [auth.sub]);
      return json(res, 200, { user: publicUser(updated.rows[0]) });
    }
    if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
      const result = await pool.query('SELECT id,display_name,elo FROM users ORDER BY elo DESC,created_at ASC LIMIT 100');
      return json(res, 200, { players: result.rows.map(user => ({ id: user.id, displayName: user.display_name, elo: user.elo })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/matches') {
      const auth = authFromHeader(req);
      const result = await pool.query(`SELECT m.id,m.seed,m.status,m.match_type,m.winner_id,m.final_state_hash,m.replay_sha256,m.created_at,m.completed_at,
        (m.replay_json IS NOT NULL OR (m.replay_key IS NOT NULL AND $2::boolean)) AS replay_available,
        u1.display_name AS player1,u2.display_name AS player2
        FROM matches m JOIN users u1 ON u1.id=m.player1_id JOIN users u2 ON u2.id=m.player2_id
        WHERE m.player1_id=$1 OR m.player2_id=$1 ORDER BY m.created_at DESC LIMIT 50`, [auth.sub, replayStorage.enabled]);
      return json(res, 200, { matches: result.rows });
    }
    if (req.method === 'GET' && /^\/api\/matches\/[0-9a-f-]+\/replay$/i.test(url.pathname)) {
      const auth = authFromHeader(req);
      const matchId = url.pathname.split('/')[3];
      const result = await pool.query('SELECT replay_json,replay_key,player1_id,player2_id FROM matches WHERE id=$1 AND status=\'completed\'', [matchId]);
      const match = result.rows[0];
      if (!match || ![match.player1_id, match.player2_id].includes(auth.sub)) return json(res, 404, { error: 'Replay not found' });
      if (match.replay_json) return json(res, 200, { replay: match.replay_json });
      const downloadUrl = await replayStorage.getUrl(match.replay_key);
      if (!downloadUrl) return json(res, 404, {
        error: 'Trận đấu này không có dữ liệu replay được lưu trên máy chủ.',
        code: 'REPLAY_UNAVAILABLE'
      });
      return json(res, 200, { downloadUrl });
    }
    if (req.method === 'POST' && url.pathname === '/api/match/submit-result') {
      const auth = authFromHeader(req);
      const body = await readBody(req);
      const result = await submitResult(auth.sub, body);
      if (result.rejectedLate) return json(res, 409, { error: result.error, matchStatus: 'abandoned' });
      return json(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/match/claim-disconnect') {
      const auth = authFromHeader(req);
      const body = await readBody(req);
      const proof = body.proof;
      if (!proof || proof.kind !== 'disconnect-claim' || !body.signature || !Number.isInteger(proof.lastAckedStep) ||
          !/^[0-9a-f]{64}$/i.test(proof.lastAckedStateHash || '')) return json(res, 400, { error: 'Malformed disconnect claim' });
      const transaction = await pool.connect();
      try {
        await transaction.query('BEGIN');
        const found = await transaction.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [proof.matchId]);
        const match = found.rows[0];
        if (!match || match.status !== 'active' || !canonicalMatchIds(match).includes(auth.sub)) throw Object.assign(new Error('Active match not found for this player'), { status: 404 });
        const claimantSeat = match.player1_id === auth.sub ? 1 : 2;
        const disconnectedId = claimantSeat === 1 ? match.player2_id : match.player1_id;
        const disconnectedSeat = claimantSeat === 1 ? 2 : 1;
        if (proof.claimantPlayer !== claimantSeat || proof.disconnectedPlayer !== disconnectedSeat || proof.winner !== claimantSeat ||
            match.disconnected_player_id !== disconnectedId || !match.disconnected_at || Date.now() - new Date(match.disconnected_at).getTime() < 10000) {
          throw Object.assign(new Error('Server has not observed the opponent disconnected for 10 seconds'), { status: 409 });
        }
        const key = claimantSeat === 1 ? match.player1_key : match.player2_key;
        if (!verifySessionProof(key, proof, body.signature)) throw Object.assign(new Error('Disconnect claim signature is invalid'), { status: 400 });
        await transaction.query("INSERT INTO disconnect_claims(match_id,claimant_id,disconnected_id,proof,signature,status) VALUES($1,$2,$3,$4::jsonb,$5,'needs-review') ON CONFLICT(match_id,claimant_id) DO NOTHING", [match.id, auth.sub, disconnectedId, JSON.stringify(proof), body.signature]);
        await transaction.query("UPDATE matches SET status='disputed' WHERE id=$1", [match.id]);
        await transaction.query('COMMIT');
        return json(res, 202, { status: 'needs-review', message: 'Signed disconnect evidence stored. The match is disputed; no Elo was awarded automatically.' });
      } catch (err) {
        await transaction.query('ROLLBACK'); throw err;
      } finally { transaction.release(); }
    }
    if (req.method === 'POST' && url.pathname === '/api/match/consensus-dispute') {
      const auth = authFromHeader(req);
      const body = await readBody(req);
      return json(res, 200, await submitConsensusDispute(auth.sub, body));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('HTTP request failed:', err.message);
    const duplicateMessage = err.constraint === 'users_email_key' ? 'Email already registered' : 'Thông tin bị trùng hoặc tài khoản đã thuộc một đội.';
    const serverMessage = err.code === '42703' || err.code === '42P01'
      ? 'Cấu trúc database chưa được cập nhật. Hãy khởi động lại backend để chạy migration.'
      : 'Máy chủ không xử lý được yêu cầu. Hãy kiểm tra log backend.';
    return json(res, err.status || (err.code === '23505' ? 409 : 500), {
      error: err.status ? err.message : err.code === '23505' ? duplicateMessage : serverMessage
    });
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 256 * 1024 });
wss.on('connection', ws => {
  ws.authenticated = false;
  const authTimeout = setTimeout(() => ws.close(4401, 'Authentication timeout'), 5000);
  ws.on('message', async raw => {
    let packet;
    try { packet = JSON.parse(raw.toString()); } catch { return send(ws, 'error', { message: 'Malformed JSON' }); }
    try {
      if (!ws.authenticated) {
        if (packet.type !== 'auth' || typeof packet.token !== 'string') return ws.close(4401, 'Send auth token first');
        const auth = verifyToken(packet.token, config.jwtSecret);
        const userResult = await pool.query('SELECT id,email,display_name,elo,is_admin FROM users WHERE id=$1', [auth.sub]);
        if (!userResult.rows[0]) return ws.close(4401, 'Unknown account');
        clearTimeout(authTimeout);
        ws.authenticated = true;
        ws.user = userResult.rows[0];
        ws.searchStartedAt = 0;
        const previous = liveSockets.get(ws.user.id);
        liveSockets.set(ws.user.id, ws);
        if (previous && previous !== ws) previous.close(4001, 'Replaced by a newer session');
        await cancelQueue(redis, ws.user.id).catch(() => {});
        await redis.set(`ottv2:presence:${ws.user.id}`, instanceId, { EX: 60 });
        await pool.query("UPDATE matches SET disconnected_player_id=NULL, disconnected_at=NULL WHERE status='active' AND disconnected_player_id=$1", [ws.user.id]);
        send(ws, 'authenticated', { user: publicUser(ws.user) });
        return;
      }
      const userId = ws.user.id;
      if (packet.type === 'find-match' || packet.type === 'find-bot-match') {
        const requestedMode = packet.type === 'find-bot-match' ? 'bot' : 'human';
        if (ws.searching) {
          if (ws.searchMode === requestedMode) {
            send(ws, 'searching', { elo: ws.user.elo, mode: requestedMode });
          } else {
            const activeMode = ws.tournamentSearch ? 'giải đấu' : (ws.searchMode === 'bot' ? 'Bot đấu Bot' : 'Người đấu người');
            send(ws, 'error', {
              mode: requestedMode,
              message: `Tài khoản đang tìm trận ${activeMode}. Hãy hủy lượt tìm hiện tại trước khi đổi chế độ.`
            });
          }
          return;
        }
        ws.searching = true;
        ws.searchCancelled = false;
        ws.searchStartedAt = Date.now();
        ws.searchMode = requestedMode;
        send(ws, 'searching', { elo: ws.user.elo, mode: requestedMode });
        await runSearch(userId, ws.searchMode);
      } else if (packet.type === 'find-tournament-match') {
        if (ws.searching) return;
        if (!/^[0-9a-f-]{36}$/i.test(packet.tournamentId || '')) {
          throw Object.assign(new Error('Mã giải đấu không hợp lệ.'), { status: 400 });
        }
        await updateTournamentLifecycle();
        const result = await pool.query(
          `SELECT t.id,t.name,t.status,t.registration_closes_at,t.ends_at,t.max_teams,
                  t.current_week,t.rules_json,e.rank_stars,e.tier,u.elo,
                  (SELECT count(*)::int FROM tournament_entries entries WHERE entries.tournament_id=t.id) AS participant_count
           FROM tournaments t JOIN tournament_entries e ON e.tournament_id=t.id
           JOIN users u ON u.id=e.player_id
           WHERE t.id=$1 AND e.player_id=$2`, [packet.tournamentId, userId]
        );
        const entry = result.rows[0];
        if (!entry || entry.status === 'completed' || new Date(entry.ends_at) <= new Date()) {
          throw Object.assign(new Error('Bạn chưa đăng ký hoặc giải đã kết thúc.'), { status: 409 });
        }
        const phase = entry.status === 'registration' ? 'practice' : 'ranked';
        if (phase === 'practice' && (new Date(entry.registration_closes_at) <= new Date() ||
            entry.participant_count >= entry.max_teams)) {
          throw Object.assign(new Error('Vòng chạy đà đã kết thúc; hãy tìm trận chính thức nếu giải đã mở.'), { status: 409 });
        }
        ws.searching = true;
        ws.searchCancelled = false;
        ws.searchStartedAt = Date.now();
        ws.tournamentSearch = {
          tournamentId: entry.id,
          tournamentName: entry.name,
          teamId: userId,
          individual: true,
          phase,
          elo: phase === 'practice' ? entry.elo : entry.rank_stars * 100,
          tier: phase === 'practice' ? 'Practice' : entry.tier,
          week: phase === 'practice' ? 1 : entry.current_week || 1
        };
        send(ws, 'searching', {
          tournamentId: entry.id, tournament: true, phase,
          tier: entry.tier, week: entry.current_week, rules: phase === 'ranked' ? entry.rules_json : null
        });
        await runTournamentSearch(userId);
      } else if (packet.type === 'cancel-match') {
        ws.searching = false;
        ws.searchCancelled = true;
        const timer = searchTimers.get(userId); if (timer) clearTimeout(timer);
        searchTimers.delete(userId);
        await cancelQueue(redis, userId);
        if (ws.tournamentSearch) {
          await cancelTournamentQueue(redis, ws.tournamentSearch.tournamentId, ws.tournamentSearch.teamId, userId, ws.tournamentSearch.week, tournamentQueueNamespace(ws.tournamentSearch));
          ws.tournamentSearch = null;
        }
        send(ws, 'search-cancelled');
      } else if (packet.type === 'bot-setup-failed') {
        const found = await pool.query('SELECT id,player1_id,player2_id,status FROM matches WHERE id=$1', [packet.matchId]);
        const match = found.rows[0];
        if (!match || match.status !== 'active' || !canonicalMatchIds(match).includes(userId)) throw new Error('Not authorized to abort this match');
        await pool.query("UPDATE matches SET status='abandoned' WHERE id=$1 AND status='active'", [match.id]);
        const otherId = match.player1_id === userId ? match.player2_id : match.player1_id;
        const message = 'Trận đã hủy vì một bot không khởi động được. Hãy kiểm tra mã Python rồi tìm lại trận.';
        await deliverToUser(otherId, 'match-aborted', { matchId: match.id, message });
        send(ws, 'match-aborted', { matchId: match.id, message });
      } else if (packet.type === 'session-key') {
        await registerSessionKey(userId, packet);
        send(ws, 'session-key-accepted', { matchId: packet.matchId });
      } else if (packet.type === 'rtc-disconnected' || packet.type === 'rtc-connected') {
        const found = await pool.query('SELECT id,player1_id,player2_id,status FROM matches WHERE id=$1', [packet.matchId]);
        const match = found.rows[0];
        if (!match || match.status !== 'active' || !canonicalMatchIds(match).includes(userId)) throw new Error('Not authorized for this match');
        if (packet.type === 'rtc-disconnected') {
          const peerId = match.player1_id === userId ? match.player2_id : match.player1_id;
          const peerPresence = await redis.get(`ottv2:presence:${peerId}`);
          if (!peerPresence) {
            await pool.query(
              `UPDATE matches SET disconnected_at=CASE WHEN disconnected_player_id=$1 THEN disconnected_at ELSE now() END,
                 disconnected_player_id=$1 WHERE id=$2 AND status='active'`,
              [peerId, match.id]
            );
          }
        } else {
          await pool.query('UPDATE matches SET disconnected_player_id=NULL, disconnected_at=NULL WHERE id=$1 AND status=\'active\'', [match.id]);
        }
      } else if (packet.type === 'signal' || packet.type === 'match-relay') {
        if (!packet.matchId || !packet.payload) throw new Error('Missing signaling payload');
        const result = await pool.query('SELECT player1_id,player2_id,status FROM matches WHERE id=$1', [packet.matchId]);
        const match = result.rows[0];
        if (!match || match.status !== 'active' || !canonicalMatchIds(match).includes(userId)) throw new Error('Not authorized to signal this match');
        const peerId = match.player1_id === userId ? match.player2_id : match.player1_id;
        const online = await redis.get(`ottv2:presence:${peerId}`);
        if (!online) return send(ws, 'peer-offline', { matchId: packet.matchId });
        await deliverToUser(peerId, packet.type, { matchId: packet.matchId, from: userId, payload: packet.payload });
      } else if (packet.type === 'ping') send(ws, 'pong', { at: Date.now() });
      else send(ws, 'error', { message: 'Unknown message type' });
    } catch (err) {
      if (packet.type === 'find-match' || packet.type === 'find-bot-match') {
        ws.searchCancelled = true;
        ws.searching = false;
        const timer = searchTimers.get(ws.user?.id);
        if (timer) clearTimeout(timer);
        searchTimers.delete(ws.user?.id);
        const queueName = ws.searchMode === 'bot' ? 'ottv2:bot-matchmaking' : 'ottv2:matchmaking';
        await cancelQueue(redis, ws.user?.id, queueName).catch(cleanupError => {
          console.error('Could not clear failed matchmaking queue entry:', cleanupError);
        });
      }
      if (packet.type === 'find-tournament-match' && ws.tournamentSearch) {
        const search = ws.tournamentSearch;
        ws.searching = false;
        ws.searchCancelled = true;
        ws.tournamentSearch = null;
        const timer = searchTimers.get(ws.user?.id);
        if (timer) clearTimeout(timer);
        searchTimers.delete(ws.user?.id);
        await cancelTournamentQueue(redis, search.tournamentId, search.teamId, ws.user?.id, search.week, tournamentQueueNamespace(search)).catch(() => {});
      }
      send(ws, 'error', {
        message: err.message,
        ...(['find-match', 'find-bot-match'].includes(packet.type)
          ? { mode: packet.type === 'find-bot-match' ? 'bot' : 'human' }
          : {})
      });
    }
  });
  ws.on('close', async () => {
    clearTimeout(authTimeout);
    if (!ws.user) return;
    const isCurrentSession = liveSockets.get(ws.user.id) === ws;
    if (!isCurrentSession) return;
    liveSockets.delete(ws.user.id);
    ws.searchCancelled = true;
    const timer = searchTimers.get(ws.user.id); if (timer) clearTimeout(timer);
    searchTimers.delete(ws.user.id);
    await cancelQueue(redis, ws.user.id).catch(() => {});
    if (ws.tournamentSearch) await cancelTournamentQueue(redis, ws.tournamentSearch.tournamentId, ws.tournamentSearch.teamId, ws.user.id, ws.tournamentSearch.week, tournamentQueueNamespace(ws.tournamentSearch)).catch(() => {});
    const presence = await redis.get(`ottv2:presence:${ws.user.id}`).catch(() => null);
    if (presence === instanceId) await redis.del(`ottv2:presence:${ws.user.id}`).catch(() => {});
    const active = await pool.query("SELECT id, player1_id, player2_id FROM matches WHERE status='active' AND (player1_id=$1 OR player2_id=$1)", [ws.user.id]).catch(() => ({ rows: [] }));
    for (const match of active.rows) {
      const peerId = match.player1_id === ws.user.id ? match.player2_id : match.player1_id;
      try {
        const marked = await pool.query(
          `UPDATE matches SET disconnected_at=CASE WHEN disconnected_player_id=$1 THEN disconnected_at ELSE now() END,
             disconnected_player_id=$1 WHERE id=$2 AND status='active' RETURNING id`,
          [ws.user.id, match.id]
        );
        if (marked.rowCount) {
          await deliverToUser(peerId, 'peer-disconnected', { matchId: match.id, disconnectedPlayerId: ws.user.id });
          await processDisconnectedMatches();
        }
      } catch (error) {
        console.error(`Could not record disconnect for match ${match.id}:`, error.message);
      }
    }
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [userId, socket] of liveSockets) {
    if (socket.readyState === WebSocket.OPEN) redis.set(`ottv2:presence:${userId}`, instanceId, { EX: 60 }).catch(() => {});
  }
}, 30000);
wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

async function main() {
  await redis.connect();
  await redisEvents.connect();
  await redisEvents.pSubscribe('ottv2:user:*', (message, channel) => {
    const userId = channel.slice('ottv2:user:'.length);
    const socket = userSocket(userId);
    if (!socket) return;
    try {
      const event = JSON.parse(message);
      if (event.type === 'match-found') {
        socket.searchCancelled = true;
        socket.searching = false;
        const timer = searchTimers.get(userId); if (timer) clearTimeout(timer);
        searchTimers.delete(userId);
        cancelQueue(redis, userId).catch(() => {});
        if (socket.tournamentSearch) {
          const search = socket.tournamentSearch;
          cancelTournamentQueue(redis, search.tournamentId, search.teamId, userId, search.week, tournamentQueueNamespace(search)).catch(() => {});
          socket.tournamentSearch = null;
        }
      }
      send(socket, event.type, event.data);
    } catch (err) { console.error('Invalid Redis event:', err.message); }
  });
  await pool.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/002_individual_bots.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/003_match_elo_mode.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/004_admin_sprint_rules.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/005_star_rank_system.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/006_tournament_phases_and_standings.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/007_match_disputes.sql', import.meta.url), 'utf8'));
  await updateTournamentLifecycle();
  tournamentLifecycleTimer = setInterval(() => updateTournamentLifecycle().catch(error => {
    console.error('Tournament lifecycle update failed:', error.message);
  }), 60000);
  disconnectForfeitTimer = setInterval(() => processDisconnectedMatches().catch(error => {
    console.error('Disconnected match resolution failed:', error.message);
  }), 1000);
  disconnectForfeitTimer.unref();
  httpServer.listen(config.port, () => console.log(`OTTv2 backend listening on :${config.port}`));
}
async function shutdown() {
  clearInterval(heartbeat);
  if (tournamentLifecycleTimer) clearInterval(tournamentLifecycleTimer);
  if (disconnectForfeitTimer) clearInterval(disconnectForfeitTimer);
  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
  await redis.quit().catch(() => {});
  await redisEvents.quit().catch(() => {});
  await pool.end().catch(() => {});
  httpServer.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
main().catch(err => { console.error('Backend startup failed:', err); process.exit(1); });
