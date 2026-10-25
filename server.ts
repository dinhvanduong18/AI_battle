import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
  verify as verifySignature,
  webcrypto,
} from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import type { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyConsensusDispute } from './server/src/replay.js';

const require = createRequire(import.meta.url);
const { OTTGameEngine } = require('./shared/OTTGameEngine.js');

const scrypt = promisify(scryptCb);
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ottv2-local-dev-secret-key-minimum-32-chars';
const FIDE_K = Number(process.env.FIDE_K_FACTOR) || 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const TOURNAMENT_RANKS = ['Bronze', 'Silver', 'Gold', 'Master', 'Challenger'] as const;
type RankTier = (typeof TOURNAMENT_RANKS)[number];

const RANK_LABELS: Record<RankTier, string> = {
  Bronze: 'Đồng',
  Silver: 'Bạc',
  Gold: 'Vàng',
  Master: 'Cao Thủ',
  Challenger: 'Thách Đấu',
};

const RANK_PROMOTION_STARS: Record<RankTier, number> = {
  Bronze: 10,
  Silver: 20,
  Gold: 30,
  Master: 40,
  Challenger: 40,
};

const SPRINT_RULE_LAYOUTS: Record<string, { title: string; blockedCells: number[] }> = {
  standard: { title: 'Bàn chuẩn', blockedCells: [] },
  center_blockers: { title: 'Chướng ngại trung tâm', blockedCells: [30, 31, 32, 39, 40, 41, 48, 49, 50] },
  clipped_corners: { title: 'Bàn vát góc', blockedCells: [0, 1, 9, 10, 70, 71, 79, 80] },
  corridor: { title: 'Hành lang vật cản', blockedCells: [22, 24, 38, 40, 42, 56, 58] },
};

const DEFAULT_SPRINT_RULES = ['standard', 'center_blockers', 'clipped_corners', 'corridor'];

function weeklyRules(week: number, schedule: string[] = DEFAULT_SPRINT_RULES) {
  const sprint = Math.max(1, Number(week) || 1);
  const configured = Array.isArray(schedule) && schedule.length ? schedule : DEFAULT_SPRINT_RULES;
  const layoutId = configured[(sprint - 1) % configured.length];
  const layout = SPRINT_RULE_LAYOUTS[layoutId] || SPRINT_RULE_LAYOUTS.standard;
  return {
    id: `sprint-${sprint}-${layoutId}`,
    week: sprint,
    title: layout.title,
    rows: 9,
    cols: 9,
    blockedCells: [...layout.blockedCells],
  };
}

function rankTierFromElo(elo: number): RankTier {
  if (elo >= 1600) return 'Gold';
  if (elo >= 1350) return 'Silver';
  return 'Bronze';
}

function applyTournamentResult(tier: RankTier, stars: number, seasonPoints: number, score: number) {
  const rankIndex = TOURNAMENT_RANKS.indexOf(tier);
  let nextTier: RankTier = tier;
  let nextStars = stars;
  let nextPoints = seasonPoints;

  if (score === 1) {
    if (tier === 'Challenger') {
      nextStars = Math.min(RANK_PROMOTION_STARS.Challenger, stars + 1);
      nextPoints += 1;
    } else if (stars + 1 >= RANK_PROMOTION_STARS[tier]) {
      nextTier = TOURNAMENT_RANKS[rankIndex + 1];
      nextStars = 0;
      if (nextTier === 'Challenger') nextPoints = 0;
    } else {
      nextStars += 1;
    }
  } else if (score === 0) {
    if (stars > 0) {
      nextStars -= 1;
      if (tier === 'Challenger') nextPoints = Math.max(0, seasonPoints - 1);
    } else if (rankIndex > 0) {
      nextTier = TOURNAMENT_RANKS[rankIndex - 1];
      nextStars = RANK_PROMOTION_STARS[nextTier] - 1;
      if (tier === 'Challenger') nextPoints = 0;
    }
  }
  return { tier: nextTier, stars: nextStars, seasonPoints: nextPoints };
}

function calculateElo(rating: number, opponentRating: number, score: number, kFactor = FIDE_K) {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  return Math.max(100, Math.round(rating + kFactor * (score - expected)));
}

// ── Crypto & Auth Helpers ─────────────────────────────────────
const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyPassword(password: string, encoded: string) {
  const [scheme, saltText, hashText] = String(encoded).split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = (await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createToken(user: { id: string; email: string }, ttlSeconds = 86400 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: user.id, email: user.email, iat: now, exp: now + ttlSeconds }));
  const unsigned = `${header}.${payload}`;
  const sig = createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

function verifyToken(token: string): { sub: string; email: string; exp: number } {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Phiên đăng nhập không hợp lệ.'), { status: 401 });
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', JWT_SECRET).update(unsigned).digest();
  const actual = Buffer.from(parts[2], 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw Object.assign(new Error('Phiên đăng nhập không hợp lệ.'), { status: 401 });
  }
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!payload?.sub || payload.exp <= Date.now() / 1000) {
    throw Object.assign(new Error('Phiên đăng nhập đã hết hạn.'), { status: 401 });
  }
  return payload;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256Canonical = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

function webCryptoSignatureToDer(raw: string) {
  const bytes = Buffer.from(raw, 'hex');
  if (bytes.length !== 64) throw new Error('ECDSA P-256 signature must be 64 bytes');
  const integer = (part: Buffer) => {
    let val = Buffer.from(part);
    while (val.length > 1 && val[0] === 0) val = val.subarray(1);
    if (val[0] & 0x80) val = Buffer.concat([Buffer.from([0]), val]);
    return Buffer.concat([Buffer.from([0x02, val.length]), val]);
  };
  const r = integer(bytes.subarray(0, 32));
  const s = integer(bytes.subarray(32));
  const body = Buffer.concat([r, s]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function verifySessionProof(jwk: Record<string, unknown> | null, proof: unknown, signature: string) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !proof || typeof signature !== 'string') return false;
  try {
    const key = createPublicKey({ key: jwk as any, format: 'jwk' });
    return verifySignature('sha256', Buffer.from(canonical(proof)), key, webCryptoSignatureToDer(signature));
  } catch {
    return false;
  }
}

function statePayload(current: any) {
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

function verifyReplay(replay: any, expectedSeed: number, expectedMatchId: string, expectedRules: any = null) {
  if (
    !replay ||
    replay.format !== 'ottv2-replay-v1' ||
    replay.matchId !== expectedMatchId ||
    replay.seed !== expectedSeed ||
    !Array.isArray(replay.moves)
  ) {
    throw new Error('Metadata của Replay không khớp với trận đấu đã đăng ký.');
  }
  let state = OTTGameEngine.deserialize(replay.initialState);
  if (state.seed !== expectedSeed || state.stepCount !== 0 || state.winner) {
    throw new Error('Trạng thái khởi tạo của Replay không hợp lệ.');
  }
  const generated = OTTGameEngine.createGame(expectedSeed, state.pieceCount, expectedRules);
  if (canonical(state.rules || null) !== canonical(generated.rules || null)) {
    throw new Error('Luật bàn cờ trong Replay không khớp với luật của trận đấu.');
  }
  if (sha256Canonical(statePayload(state)) !== sha256Canonical(statePayload(generated))) {
    throw new Error('Bàn cờ ban đầu không khớp với Seed tất định.');
  }
  for (let i = 0; i < replay.moves.length; i++) {
    const entry = replay.moves[i];
    if (
      !entry ||
      entry.stepCount !== i + 1 ||
      ![1, 2].includes(entry.player) ||
      entry.player !== state.turn ||
      !entry.move ||
      !Number.isInteger(entry.move.from) ||
      !Number.isInteger(entry.move.to) ||
      typeof entry.nonce !== 'string'
    ) {
      throw new Error(`Nước đi thứ ${i + 1} có dữ liệu không hợp lệ.`);
    }
    const expectedCommit = sha256Canonical({
      matchId: expectedMatchId,
      stepCount: i,
      player: entry.player,
      move: entry.move,
      nonce: entry.nonce,
    });
    if (entry.commit && entry.commit !== expectedCommit) {
      throw new Error(`Mã cam kết nước đi thứ ${i + 1} không khớp.`);
    }
    state = OTTGameEngine.applyMove(state, { from: entry.move.from, to: entry.move.to });
    const currentHash = sha256Canonical(statePayload(state));
    if (entry.stateHash && entry.stateHash !== currentHash) {
      throw new Error(`Mã băm trạng thái lượt ${i + 1} không khớp.`);
    }
  }
  if (state.winner === null || state.winner === undefined) throw new Error('Replay chưa đi đến trạng thái phân định thắng thua.');
  return {
    winner: state.winner as 1 | 2 | 0,
    stepCount: state.stepCount as number,
    finalHash: sha256Canonical(statePayload(state)),
  };
}

// ── Persistent Local Dev Store ────────────────────────────────
interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  elo: number;
  avatar_id?: string;
  is_admin: boolean;
  active_bot_version: number;
  is_system_bot?: boolean;
  created_at: string;
}

interface BotVersionRecord {
  user_id: string;
  version: number;
  code: string;
  code_sha256: string;
  created_at: string;
}

interface TournamentRecord {
  id: string;
  name: string;
  format: 'ranked_weekly';
  description: string;
  status: 'registration' | 'qualifying' | 'completed';
  registration_closes_at: string;
  ends_at: string;
  max_teams: number;
  current_week: number;
  week_started_at: string | null;
  rules_json: any;
  rules_schedule: string[];
  created_at: string;
}

interface TournamentEntryRecord {
  tournament_id: string;
  player_id: string;
  bot_version: number;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  tournament_elo: number;
  tier: RankTier;
  rank_stars: number;
  season_points: number;
  registered_at: string;
}

interface MatchRecord {
  id: string;
  seed: number;
  player1_id: string;
  player2_id: string;
  match_type: 'human' | 'bot';
  is_sparring?: boolean;
  status: 'pending' | 'active' | 'completed' | 'disputed' | 'abandoned';
  tournament_id: string | null;
  tournament_phase: 'practice' | 'ranked' | null;
  tournament_rules: any | null;
  disconnected_player_id?: string | null;
  disconnected_at?: string | null;
  player1_bot_version?: number;
  player2_bot_version?: number;
  player1_bot_code?: string;
  player2_bot_code?: string;
  player1_key: Record<string, unknown> | null;
  player2_key: Record<string, unknown> | null;
  winner_id: string | null;
  final_state_hash: string | null;
  replay_sha256: string | null;
  replay_json: any | null;
  player1_proof: any | null;
  player2_proof: any | null;
  created_at: string;
  completed_at: string | null;
}

interface MatchResultRecord {
  match_id: string;
  player1_elo_before: number;
  player2_elo_before: number;
  player1_elo_after: number;
  player2_elo_after: number;
  result_player1: number;
  created_at: string;
}

interface DatabaseSchema {
  users: UserRecord[];
  botVersions: BotVersionRecord[];
  tournaments: TournamentRecord[];
  tournamentEntries: TournamentEntryRecord[];
  matches: MatchRecord[];
  matchResults: MatchResultRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'local-db.json');

const DEFAULT_MINIMAX_PYTHON = `def get_next_move(my_player_id, game_state):
    valid_moves = game_state.get('validMoves', [])
    if not valid_moves:
        return None
    goal_row, goal_col = (0, 0) if my_player_id == 1 else (8, 8)
    best_move = valid_moves[0]
    best_score = float('-inf')
    for move in valid_moves:
        score = 150 if move.get('isAttack') else 0
        distance = abs(move['toRow'] - goal_row) + abs(move['toCol'] - goal_col)
        score -= distance * 10
        score -= abs(move['toRow'] - 4) + abs(move['toCol'] - 4)
        if score > best_score:
            best_score = score
            best_move = move
    return {
        'fromRow': best_move['fromRow'],
        'fromCol': best_move['fromCol'],
        'toRow': best_move['toRow'],
        'toCol': best_move['toCol'],
    }`;

async function createSeedDatabase(): Promise<DatabaseSchema> {
  const now = Date.now();
  const pwHash = await hashPassword('halloween2026');
  const systemBotId = '00000000-0000-4000-8000-000000000001';
  const adminId = '00000000-0000-4000-8000-000000000002';
  const p2Id = '00000000-0000-4000-8000-000000000003';
  const p3Id = '00000000-0000-4000-8000-000000000004';
  const p4Id = '00000000-0000-4000-8000-000000000005';

  const users: UserRecord[] = [
    {
      id: systemBotId,
      email: 'guardian@ottv2.local',
      password_hash: pwHash,
      display_name: 'Hắc Kỵ Sĩ AI (Sparring)',
      elo: 1320,
      is_admin: false,
      active_bot_version: 1,
      is_system_bot: true,
      created_at: new Date(now - 14 * 86400000).toISOString(),
    },
    {
      id: adminId,
      email: 'admin@ottv2.local',
      password_hash: pwHash,
      display_name: 'Minh Quân · BTC',
      elo: 1685,
      is_admin: true,
      active_bot_version: 2,
      created_at: new Date(now - 12 * 86400000).toISOString(),
    },
    {
      id: p2Id,
      email: 'linhdan@ottv2.local',
      password_hash: pwHash,
      display_name: 'Linh Đan AI',
      elo: 1560,
      is_admin: false,
      active_bot_version: 3,
      created_at: new Date(now - 10 * 86400000).toISOString(),
    },
    {
      id: p3Id,
      email: 'hoangnam@ottv2.local',
      password_hash: pwHash,
      display_name: 'Hoàng Nam · AlphaRPS',
      elo: 1435,
      is_admin: false,
      active_bot_version: 1,
      created_at: new Date(now - 8 * 86400000).toISOString(),
    },
    {
      id: p4Id,
      email: 'thaovy@ottv2.local',
      password_hash: pwHash,
      display_name: 'Thảo Vy · NightOwl',
      elo: 1290,
      is_admin: false,
      active_bot_version: 1,
      created_at: new Date(now - 5 * 86400000).toISOString(),
    },
  ];

  const codeSha = createHash('sha256').update(DEFAULT_MINIMAX_PYTHON).digest('hex');
  const botVersions: BotVersionRecord[] = users.map((u) => ({
    user_id: u.id,
    version: u.active_bot_version,
    code: DEFAULT_MINIMAX_PYTHON,
    code_sha256: codeSha,
    created_at: u.created_at,
  }));

  const t1Id = '11111111-2222-4333-8444-555555555501';
  const t2Id = '11111111-2222-4333-8444-555555555502';
  const sprint2Rules = weeklyRules(2, ['standard', 'center_blockers', 'clipped_corners', 'corridor']);

  const tournaments: TournamentRecord[] = [
    {
      id: t1Id,
      name: 'Halloween Blood Moon Cup 2026',
      format: 'ranked_weekly',
      description:
        'Giải đấu sự kiện Halloween chính thức của OTTv2. Bàn cờ hiện đang ở Sprint 2 (Chướng ngại trung tâm) — tích lũy Sao để thăng hạng lên Thách Đấu trước đêm 31/10!',
      status: 'qualifying',
      registration_closes_at: new Date(now - 8 * 86400000).toISOString(),
      ends_at: new Date(now + 20 * 86400000).toISOString(),
      max_teams: 64,
      current_week: 2,
      week_started_at: new Date(now - 8 * 86400000).toISOString(),
      rules_json: sprint2Rules,
      rules_schedule: ['standard', 'center_blockers', 'clipped_corners', 'corridor'],
      created_at: new Date(now - 12 * 86400000).toISOString(),
    },
    {
      id: t2Id,
      name: 'OTTv2 Open Sprint — Mùa Thu Đông',
      format: 'ranked_weekly',
      description:
        'Mùa giải mở rộng dành cho mọi lập trình viên AI. Hiện đang mở đăng ký và Vòng Chạy Đà — người chơi có thể vào thi đấu luyện tập bằng Bot mẫu hoặc Bot Python cá nhân.',
      status: 'registration',
      registration_closes_at: new Date(now + 5 * 86400000).toISOString(),
      ends_at: new Date(now + 33 * 86400000).toISOString(),
      max_teams: 128,
      current_week: 0,
      week_started_at: null,
      rules_json: {},
      rules_schedule: ['standard', 'clipped_corners', 'center_blockers', 'corridor'],
      created_at: new Date(now - 2 * 86400000).toISOString(),
    },
  ];

  const tournamentEntries: TournamentEntryRecord[] = [
    {
      tournament_id: t1Id,
      player_id: systemBotId,
      bot_version: 1,
      matches_played: 8,
      wins: 4,
      draws: 0,
      losses: 4,
      points: 4,
      tournament_elo: 1320,
      tier: 'Bronze',
      rank_stars: 4,
      season_points: 0,
      registered_at: new Date(now - 10 * 86400000).toISOString(),
    },
    {
      tournament_id: t1Id,
      player_id: adminId,
      bot_version: 2,
      matches_played: 18,
      wins: 14,
      draws: 0,
      losses: 4,
      points: 14,
      tournament_elo: 1685,
      tier: 'Master',
      rank_stars: 12,
      season_points: 0,
      registered_at: new Date(now - 11 * 86400000).toISOString(),
    },
    {
      tournament_id: t1Id,
      player_id: p2Id,
      bot_version: 3,
      matches_played: 14,
      wins: 10,
      draws: 0,
      losses: 4,
      points: 10,
      tournament_elo: 1560,
      tier: 'Gold',
      rank_stars: 8,
      season_points: 0,
      registered_at: new Date(now - 10 * 86400000).toISOString(),
    },
    {
      tournament_id: t2Id,
      player_id: systemBotId,
      bot_version: 1,
      matches_played: 2,
      wins: 1,
      draws: 0,
      losses: 1,
      points: 0,
      tournament_elo: 1320,
      tier: 'Bronze',
      rank_stars: 0,
      season_points: 0,
      registered_at: new Date(now - 86400000).toISOString(),
    },
    {
      tournament_id: t2Id,
      player_id: p3Id,
      bot_version: 1,
      matches_played: 3,
      wins: 2,
      draws: 0,
      losses: 1,
      points: 0,
      tournament_elo: 1435,
      tier: 'Silver',
      rank_stars: 0,
      season_points: 0,
      registered_at: new Date(now - 86400000).toISOString(),
    },
  ];

  return {
    users,
    botVersions,
    tournaments,
    tournamentEntries,
    matches: [],
    matchResults: [],
  };
}

let db: DatabaseSchema;

function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Could not persist local DB:', err);
  }
}

async function initDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      return;
    }
  } catch {
    // Recreate on corrupt JSON
  }
  db = await createSeedDatabase();
  saveDb();
}

function publicUser(u: UserRecord) {
  return {
    id: u.id,
    displayName: u.display_name,
    elo: u.elo,
    avatarId: u.avatar_id || 'pumpkin',
    isAdmin: Boolean(u.is_admin),
    activeBotVersion: u.active_bot_version || 0,
  };
}

function playerStats(userId: string) {
  const completed = db.matches.filter(
    (match) =>
      match.status === 'completed' &&
      (match.player1_id === userId || match.player2_id === userId)
  );
  const wins = completed.filter((match) => match.winner_id === userId).length;
  const draws = completed.filter((match) => match.winner_id === null).length;
  return {
    matchesPlayed: completed.length,
    wins,
    draws,
    losses: completed.length - wins - draws,
  };
}

function updateTournamentLifecycle() {
  const now = Date.now();
  let dirty = false;
  for (const t of db.tournaments) {
    const endMs = new Date(t.ends_at).getTime();
    const regCloseMs = new Date(t.registration_closes_at).getTime();
    const entryCount = db.tournamentEntries.filter((e) => e.tournament_id === t.id).length;

    if (t.status !== 'completed' && now >= endMs) {
      t.status = 'completed';
      dirty = true;
    } else if (t.status === 'registration' && (now >= regCloseMs || entryCount >= t.max_teams)) {
      t.status = 'qualifying';
      t.current_week = 1;
      t.week_started_at = new Date(now).toISOString();
      t.rules_json = weeklyRules(1, t.rules_schedule);
      for (const entry of db.tournamentEntries.filter((e) => e.tournament_id === t.id)) {
        const u = db.users.find((usr) => usr.id === entry.player_id);
        entry.tier = rankTierFromElo(u?.elo || 1200);
        entry.rank_stars = 0;
        entry.season_points = 0;
      }
      dirty = true;
    } else if (t.status === 'qualifying' && t.week_started_at) {
      const startMs = new Date(t.week_started_at).getTime();
      const computedWeek = Math.max(1, Math.floor((now - startMs) / WEEK_MS) + 1);
      if (computedWeek !== t.current_week) {
        t.current_week = computedWeek;
        t.rules_json = weeklyRules(computedWeek, t.rules_schedule);
        dirty = true;
      }
    }
  }
  if (dirty) saveDb();
}

function getAuthUser(req: Request): UserRecord {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    throw Object.assign(new Error('Vui lòng đăng nhập để thực hiện thao tác này.'), { status: 401 });
  }
  const payload = verifyToken(header.slice(7));
  const user = db.users.find((u) => u.id === payload.sub);
  if (!user) throw Object.assign(new Error('Không tìm thấy tài khoản.'), { status: 401 });
  return user;
}

function getOptionalAuthUser(req: Request): UserRecord | null {
  try {
    return getAuthUser(req);
  } catch {
    return null;
  }
}

// ── Server-Side Sparring Bot Controller (For 1-Tab Solo Ranked Testing) ──
interface SparringSession {
  matchId: string;
  humanSeat: 1 | 2;
  botSeat: 1 | 2;
  privateKey: CryptoKey;
  publicJwk: Record<string, unknown>;
  state: any;
  pendingCommits: Map<number, { commit: string; commitAttestation: any }>;
  moves: any[];
  destroyed: boolean;
}

const sparringSessions = new Map<string, SparringSession>();

function pickTacticalBotMove(state: any, botSeat: 1 | 2) {
  const botState = OTTGameEngine.createBotGameState(state, botSeat);
  const validMoves = botState.validMoves || [];
  if (!validMoves.length) return null;
  let best = validMoves[0];
  let bestScore = -Infinity;
  for (const m of validMoves) {
    const targetWin = botSeat === 1 ? 8 : 72;
    if (m.to === targetWin) {
      return { from: m.from, to: m.to };
    }
    let score = m.isAttack ? 145 : 0;
    const distA1 = Math.abs(m.toRow - 8) + Math.abs(m.toCol - 0);
    const distI9 = Math.abs(m.toRow - 0) + Math.abs(m.toCol - 8);
    score -= Math.min(distA1, distI9) * 12;
    score -= (Math.abs(m.toRow - 4) + Math.abs(m.toCol - 4)) * 2;
    score += (Math.random() - 0.5) * 10;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return { from: best.from, to: best.to };
}

async function signWithWebCrypto(privateKey: CryptoKey, payload: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(canonical(payload));
  const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoded);
  return Buffer.from(sig).toString('hex');
}

// ── Start Full-Stack Server ───────────────────────────────────
async function startServer() {
  await initDb();

  const app = express();
  const httpServer = http.createServer(app);

  app.use(express.json({ limit: '2mb' }));

  // CORS for local or cross-origin testing
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, mode: 'local-embedded', timestamp: new Date().toISOString() });
  });

  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const displayName = String(req.body?.displayName || '').trim().slice(0, 40);
      if (!email.includes('@')) {
        res.status(400).json({ error: 'Địa chỉ email không hợp lệ.' });
        return;
      }
      if (password.length < 10) {
        res.status(400).json({ error: 'Mật khẩu phải có ít nhất 10 ký tự.' });
        return;
      }
      if (!displayName) {
        res.status(400).json({ error: 'Vui lòng nhập tên hiển thị.' });
        return;
      }
      if (db.users.some((u) => u.email === email)) {
        res.status(409).json({ error: 'Email này đã được đăng ký.' });
        return;
      }
      const user: UserRecord = {
        id: randomUUID(),
        email,
        password_hash: await hashPassword(password),
        display_name: displayName,
        elo: 1200,
        avatar_id: 'pumpkin',
        is_admin: false,
        active_bot_version: 0,
        created_at: new Date().toISOString(),
      };
      db.users.push(user);
      saveDb();
      res.status(201).json({ token: createToken(user), user: { ...publicUser(user), email: user.email } });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || 'Lỗi đăng ký tài khoản.' });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const user = db.users.find((u) => u.email === email && !u.is_system_bot);
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' });
        return;
      }
      res.json({ token: createToken(user), user: { ...publicUser(user), email: user.email } });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || 'Lỗi đăng nhập.' });
    }
  });

  app.get('/api/me', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      res.json({ user: { ...publicUser(user), email: user.email, stats: playerStats(user.id) } });
    } catch (err: any) {
      res.status(err.status || 401).json({ error: err.message });
    }
  });

  app.patch('/api/me', async (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      const displayName =
        req.body?.displayName === undefined ? null : String(req.body.displayName).trim().slice(0, 40);
      const avatarId = req.body?.avatarId === undefined ? null : String(req.body.avatarId);
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');

      if (displayName !== null && !displayName) {
        res.status(400).json({ error: 'Tên hiển thị không được để trống.' });
        return;
      }
      if (avatarId !== null && !['pumpkin', 'ghost', 'bat', 'knight', 'fox', 'crown'].includes(avatarId)) {
        res.status(400).json({ error: 'Avatar không hợp lệ.' });
        return;
      }
      if (newPassword && newPassword.length < 10) {
        res.status(400).json({ error: 'Mật khẩu mới cần ít nhất 10 ký tự.' });
        return;
      }
      if (Boolean(currentPassword) !== Boolean(newPassword)) {
        res.status(400).json({ error: 'Cần nhập cả mật khẩu hiện tại và mật khẩu mới.' });
        return;
      }
      if (displayName === null && avatarId === null && !newPassword) {
        res.status(400).json({ error: 'Hãy nhập tên mới, avatar mới hoặc mật khẩu mới.' });
        return;
      }
      if (newPassword && !(await verifyPassword(currentPassword, user.password_hash))) {
        res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' });
        return;
      }
      if (displayName !== null) user.display_name = displayName;
      if (avatarId !== null) user.avatar_id = avatarId;
      if (newPassword) user.password_hash = await hashPassword(newPassword);
      saveDb();
      res.json({ user: { ...publicUser(user), email: user.email, stats: playerStats(user.id) } });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Convenient Local Dev helper: Toggle BTC Organizer role without running manual SQL
  app.post('/api/dev/toggle-admin', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      user.is_admin = !user.is_admin;
      saveDb();
      res.json({ user: publicUser(user) });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get('/api/bots/me', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      const bot = db.botVersions.find((b) => b.user_id === user.id && b.version === user.active_bot_version);
      const tournamentIds = db.tournamentEntries
        .filter((e) => e.player_id === user.id)
        .map((e) => e.tournament_id);
      res.json({
        bot: bot
          ? {
              version: bot.version,
              code: bot.code,
              sha256: bot.code_sha256,
              createdAt: bot.created_at,
              tournamentIds,
            }
          : { version: 0, code: '', sha256: '', tournamentIds },
      });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/bots/me', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      const code = String(req.body?.code || '');
      if (!code.trim() || code.length > 120000) {
        res.status(400).json({ error: 'Mã Python phải có từ 1 đến 120000 ký tự.' });
        return;
      }
      if (!/^\s*def\s+(get_next_move|getNextMove)\s*\(/m.test(code)) {
        res.status(400).json({ error: 'Bot cần định nghĩa hàm get_next_move(my_player_id, game_state).' });
        return;
      }
      const version = (user.active_bot_version || 0) + 1;
      const sha256 = createHash('sha256').update(code).digest('hex');
      db.botVersions = db.botVersions.filter((b) => b.user_id !== user.id);
      db.botVersions.push({
        user_id: user.id,
        version,
        code,
        code_sha256: sha256,
        created_at: new Date().toISOString(),
      });
      user.active_bot_version = version;
      for (const entry of db.tournamentEntries.filter((e) => e.player_id === user.id)) {
        const t = db.tournaments.find((tour) => tour.id === entry.tournament_id);
        if (t && ['registration', 'qualifying'].includes(t.status)) {
          entry.bot_version = version;
        }
      }
      saveDb();
      res.status(201).json({ version, sha256 });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get('/api/leaderboard', (_req: Request, res: Response) => {
    const players = [...db.users]
      .sort((a, b) => b.elo - a.elo || a.created_at.localeCompare(b.created_at))
      .slice(0, 100)
      .map((u) => ({
        id: u.id,
        displayName: u.display_name,
        elo: u.elo,
        avatarId: u.avatar_id || 'pumpkin',
        isSystemBot: Boolean(u.is_system_bot),
      }));
    res.json({ players });
  });

  app.get('/api/matches', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      const matches = db.matches
        .filter(
          (m) =>
            m.status === 'completed' &&
            (m.player1_id === user.id || m.player2_id === user.id)
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((m) => {
          const u1 = db.users.find((u) => u.id === m.player1_id);
          const u2 = db.users.find((u) => u.id === m.player2_id);
          const mr = db.matchResults.find((r) => r.match_id === m.id);
          return {
            id: m.id,
            seed: m.seed,
            status: m.status,
            match_type:
              m.match_type === 'bot' ||
              Boolean(
                mr &&
                  (mr.player1_elo_before !== mr.player1_elo_after ||
                    mr.player2_elo_before !== mr.player2_elo_after)
              )
                ? 'bot'
                : 'human',
            winner_id: m.winner_id,
            final_state_hash: m.final_state_hash,
            replay_sha256: m.replay_sha256,
            created_at: m.created_at,
            completed_at: m.completed_at,
            replay_available: Boolean(m.replay_json),
            player1: u1?.display_name || 'Player 1',
            player2: u2?.display_name || 'Player 2',
            player1_id: m.player1_id,
            player2_id: m.player2_id,
            elo_delta:
              mr && m.match_type === 'bot' && !m.is_sparring
                ? m.player1_id === user.id
                  ? mr.player1_elo_after - mr.player1_elo_before
                  : mr.player2_elo_after - mr.player2_elo_before
                : 0,
          };
        });
      res.json({ matches });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get('/api/matches/:id/replay', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      const match = db.matches.find((m) => m.id === req.params.id && m.status === 'completed');
      if (!match || (match.player1_id !== user.id && match.player2_id !== user.id)) {
        res.status(404).json({ error: 'Không tìm thấy dữ liệu replay của trận đấu này.' });
        return;
      }
      if (!match.replay_json) {
        res.status(404).json({ error: 'Trận đấu này không có dữ liệu replay.', code: 'REPLAY_UNAVAILABLE' });
        return;
      }
      res.json({ replay: match.replay_json });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get('/api/tournaments', (_req: Request, res: Response) => {
    updateTournamentLifecycle();
    const list = [...db.tournaments]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((t) => ({
        ...t,
        participant_count: db.tournamentEntries.filter((e) => e.tournament_id === t.id).length,
      }));
    res.json({ tournaments: list });
  });

  app.get('/api/tournaments/:id', (req: Request, res: Response) => {
    updateTournamentLifecycle();
    const t = db.tournaments.find((tour) => tour.id === req.params.id);
    if (!t) {
      res.status(404).json({ error: 'Không tìm thấy giải đấu.' });
      return;
    }
    const authUser = getOptionalAuthUser(req);
    const entries = db.tournamentEntries.filter((e) => e.tournament_id === t.id);
    const own = authUser ? entries.find((e) => e.player_id === authUser.id) : null;

    const myMatches = authUser
      ? db.matches
          .filter(
            (m) =>
              m.tournament_id === t.id &&
              (m.player1_id === authUser.id || m.player2_id === authUser.id)
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((m) => {
            const u1 = db.users.find((u) => u.id === m.player1_id);
            const u2 = db.users.find((u) => u.id === m.player2_id);
            return {
              id: m.id,
              status: m.status,
              tournament_phase: m.tournament_phase,
              winner_id: m.winner_id,
              created_at: m.created_at,
              completed_at: m.completed_at,
              replay_available: Boolean(m.replay_json),
              player1: u1?.display_name || 'Player 1',
              player2: u2?.display_name || 'Player 2',
            };
          })
      : [];

    const rankOrder = (tier: RankTier) => TOURNAMENT_RANKS.indexOf(tier);
    const sortedStandings = [...entries]
      .map((e) => {
        const u = db.users.find((usr) => usr.id === e.player_id);
        return {
          player_id: e.player_id,
          display_name: u?.display_name || 'Kỳ thủ',
          tier: e.tier,
          rank_stars: e.rank_stars,
          season_points: e.season_points,
          matches_played: e.matches_played,
          wins: e.wins,
          draws: e.draws,
          losses: e.losses,
          elo: u?.elo || e.tournament_elo,
        };
      })
      .sort(
        (a, b) =>
          rankOrder(b.tier) - rankOrder(a.tier) ||
          b.season_points - a.season_points ||
          b.rank_stars - a.rank_stars ||
          b.wins - a.wins
      );

    res.json({
      tournament: t,
      participantCount: entries.length,
      ranks: TOURNAMENT_RANKS.map((tier, index) => ({
        tier,
        label: RANK_LABELS[tier],
        index,
        starsToPromote: RANK_PROMOTION_STARS[tier],
      })),
      myEntry: own || null,
      matches: myMatches,
      standings: sortedStandings,
      finalStandings: t.status === 'completed' ? sortedStandings : null,
    });
  });

  app.post('/api/tournaments', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      if (!user.is_admin) {
        res.status(403).json({ error: 'Cần quyền Ban Tổ Chức (Admin) để tạo giải đấu.' });
        return;
      }
      const name = String(req.body?.name || '').trim().slice(0, 100);
      const description = String(req.body?.description || '').trim().slice(0, 2000);
      const registrationClosesAt = new Date(req.body?.registrationClosesAt);
      const endsAt = new Date(req.body?.endsAt);
      const maxTeams = Math.min(256, Math.max(2, Number(req.body?.maxTeams) || 64));
      const sprintRules: string[] = Array.isArray(req.body?.sprintRules)
        ? req.body.sprintRules
        : DEFAULT_SPRINT_RULES;

      if (!name) {
        res.status(400).json({ error: 'Vui lòng nhập tên giải đấu.' });
        return;
      }
      if (sprintRules.length !== 4 || sprintRules.some((r) => !SPRINT_RULE_LAYOUTS[r])) {
        res.status(400).json({ error: 'Hãy chọn luật hợp lệ cho đủ 4 Sprint.' });
        return;
      }
      if (Number.isNaN(registrationClosesAt.getTime()) || registrationClosesAt <= new Date()) {
        res.status(400).json({ error: 'Thời điểm đóng đăng ký phải nằm trong tương lai.' });
        return;
      }
      if (Number.isNaN(endsAt.getTime()) || endsAt <= registrationClosesAt) {
        res.status(400).json({ error: 'Thời điểm kết thúc giải phải sau thời điểm đóng đăng ký.' });
        return;
      }

      const created: TournamentRecord = {
        id: randomUUID(),
        name,
        format: 'ranked_weekly',
        description,
        status: 'registration',
        registration_closes_at: registrationClosesAt.toISOString(),
        ends_at: endsAt.toISOString(),
        max_teams: maxTeams,
        current_week: 0,
        week_started_at: null,
        rules_json: {},
        rules_schedule: sprintRules,
        created_at: new Date().toISOString(),
      };
      db.tournaments.unshift(created);
      saveDb();
      res.status(201).json({ tournament: created });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/tournaments/:id/start', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      if (!user.is_admin) {
        res.status(403).json({ error: 'Cần quyền Ban Tổ Chức để bắt đầu vòng thi đấu.' });
        return;
      }
      const t = db.tournaments.find((tour) => tour.id === req.params.id);
      if (!t || t.status !== 'registration') {
        res.status(409).json({ error: 'Giải đấu không ở trạng thái đăng ký.' });
        return;
      }
      t.status = 'qualifying';
      t.current_week = 1;
      t.week_started_at = new Date().toISOString();
      t.rules_json = weeklyRules(1, t.rules_schedule);
      for (const entry of db.tournamentEntries.filter((e) => e.tournament_id === t.id)) {
        const u = db.users.find((usr) => usr.id === entry.player_id);
        entry.tier = rankTierFromElo(u?.elo || 1200);
        entry.rank_stars = 0;
        entry.season_points = 0;
      }
      saveDb();
      res.json({ tournament: t });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/tournaments/:id/register', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      updateTournamentLifecycle();
      const t = db.tournaments.find((tour) => tour.id === req.params.id);
      if (!t) {
        res.status(404).json({ error: 'Không tìm thấy giải đấu.' });
        return;
      }
      if (t.status !== 'registration' || new Date(t.registration_closes_at).getTime() <= Date.now()) {
        res.status(409).json({ error: 'Giải đấu đã đóng đăng ký; Sprint đã bắt đầu hoặc hết hạn đăng ký.' });
        return;
      }
      const existing = db.tournamentEntries.find(
        (e) => e.tournament_id === t.id && e.player_id === user.id
      );
      if (existing) {
        res.json({ entry: existing, alreadyRegistered: true });
        return;
      }
      const count = db.tournamentEntries.filter((e) => e.tournament_id === t.id).length;
      if (count >= t.max_teams) {
        res.status(409).json({ error: 'Giải đấu đã đủ số lượng người chơi tối đa.' });
        return;
      }
      const entry: TournamentEntryRecord = {
        tournament_id: t.id,
        player_id: user.id,
        bot_version: user.active_bot_version || 0,
        matches_played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        tournament_elo: user.elo,
        tier: rankTierFromElo(user.elo),
        rank_stars: 0,
        season_points: 0,
        registered_at: new Date().toISOString(),
      };
      db.tournamentEntries.push(entry);
      saveDb();
      res.status(201).json({ entry });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/match/submit-result', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      const body = req.body || {};
      const match = db.matches.find((m) => m.id === body.matchId);
      if (!match || (match.player1_id !== user.id && match.player2_id !== user.id)) {
        res.status(404).json({ error: 'Không tìm thấy trận đấu của bạn.' });
        return;
      }
      if (match.status === 'completed') {
        const mr = db.matchResults.find((r) => r.match_id === match.id);
        res.json({
          alreadySubmitted: true,
          matchId: match.id,
          winnerId: match.winner_id,
          finalStateHash: match.final_state_hash,
          elo: mr
            ? {
                player1: { before: mr.player1_elo_before, after: mr.player1_elo_after },
                player2: { before: mr.player2_elo_before, after: mr.player2_elo_after },
              }
            : null,
          eloUpdated: match.match_type === 'bot' && !match.is_sparring,
          replaySha256: match.replay_sha256,
        });
        return;
      }
      if (match.status !== 'active') {
        res.status(409).json({ error: 'Trận đấu không còn ở trạng thái đang diễn ra.' });
        return;
      }

      const p1 = body.proofs?.player1;
      const p2 = body.proofs?.player2;
      if (!p1?.proof || !p1.signature || !p2?.proof || !p2.signature) {
        res.status(400).json({ error: 'Thiếu chữ ký xác nhận kết quả của cả 2 người chơi.' });
        return;
      }
      if (!match.player1_key || !match.player2_key) {
        res.status(409).json({ error: 'Khóa phiên P-256 chưa được đăng ký đầy đủ.' });
        return;
      }
      if (
        !verifySessionProof(match.player1_key, p1.proof, p1.signature) ||
        !verifySessionProof(match.player2_key, p2.proof, p2.signature)
      ) {
        res.status(400).json({ error: 'Chữ ký xác thực kết quả không hợp lệ.' });
        return;
      }

      const replayResult = verifyReplay(
        body.replay,
        match.seed,
        match.id,
        match.tournament_rules || null
      );
      if (
        replayResult.finalHash !== p1.proof.stateHash ||
        replayResult.stepCount !== p1.proof.stepCount ||
        replayResult.winner !== p1.proof.winner
      ) {
        res.status(400).json({ error: 'Kết quả Replay không khớp với bằng chứng ký số.' });
        return;
      }

      const u1 = db.users.find((u) => u.id === match.player1_id)!;
      const u2 = db.users.find((u) => u.id === match.player2_id)!;
      const score1 = replayResult.winner === 1 ? 1 : replayResult.winner === 2 ? 0 : 0.5;
      const eloUpdated = match.match_type === 'bot' && !match.is_sparring;
      const u1Before = u1.elo;
      const u2Before = u2.elo;
      const u1After = eloUpdated ? calculateElo(u1Before, u2Before, score1) : u1Before;
      const u2After = eloUpdated ? calculateElo(u2Before, u1Before, 1 - score1) : u2Before;

      if (eloUpdated) {
        u1.elo = u1After;
        u2.elo = u2After;
      }

      let tournamentUpdate: any = null;
      if (match.tournament_id) {
        const e1 = db.tournamentEntries.find(
          (e) => e.tournament_id === match.tournament_id && e.player_id === u1.id
        );
        const e2 = db.tournamentEntries.find(
          (e) => e.tournament_id === match.tournament_id && e.player_id === u2.id
        );
        for (const [entry, sc] of [
          [e1, score1],
          [e2, 1 - score1],
        ] as const) {
          if (!entry) continue;
          entry.matches_played += 1;
          if (sc === 1) entry.wins += 1;
          else if (sc === 0) entry.losses += 1;
          else entry.draws += 1;
          if (match.tournament_phase === 'ranked') {
            const prog = applyTournamentResult(entry.tier, entry.rank_stars, entry.season_points, sc);
            entry.tier = prog.tier;
            entry.rank_stars = prog.stars;
            entry.season_points = prog.seasonPoints;
            entry.points = entry.wins;
          }
          if (entry.player_id === user.id) {
            tournamentUpdate = {
              tier: entry.tier,
              stars: entry.rank_stars,
              seasonPoints: entry.season_points,
              phase: match.tournament_phase,
            };
          }
        }
      }

      const replayChecksum = sha256Canonical(body.replay);
      match.status = 'completed';
      match.winner_id = replayResult.winner === 1 ? u1.id : replayResult.winner === 2 ? u2.id : null;
      match.final_state_hash = replayResult.finalHash;
      match.replay_sha256 = replayChecksum;
      match.replay_json = body.replay;
      match.player1_proof = p1;
      match.player2_proof = p2;
      match.completed_at = new Date().toISOString();

      db.matchResults.push({
        match_id: match.id,
        player1_elo_before: u1Before,
        player2_elo_before: u2Before,
        player1_elo_after: u1After,
        player2_elo_after: u2After,
        result_player1: score1,
        created_at: match.completed_at,
      });

      sparringSessions.delete(match.id);
      saveDb();

      res.json({
        matchId: match.id,
        winnerId: match.winner_id,
        finalStateHash: match.final_state_hash,
        elo: {
          player1: { before: u1Before, after: u1After },
          player2: { before: u2Before, after: u2After },
        },
        eloUpdated,
        tournamentUpdate,
        replaySha256: replayChecksum,
      });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.post('/api/match/consensus-dispute', (req: Request, res: Response) => {
    try {
      const user = getAuthUser(req);
      const report = req.body?.report;
      const proof = report?.payload;
      const evidence = req.body?.evidence;
      if (!proof || proof.kind !== 'consensus-dispute' || typeof report.signature !== 'string') {
        res.status(400).json({ error: 'Bằng chứng kiểm tra hash không hợp lệ.' });
        return;
      }
      const match = db.matches.find((entry) => entry.id === proof.matchId);
      if (!match || (match.player1_id !== user.id && match.player2_id !== user.id)) {
        res.status(404).json({ error: 'Không tìm thấy trận đấu của bạn.' });
        return;
      }
      if (match.status !== 'active') {
        res.status(409).json({ error: 'Trận đấu không còn ở trạng thái đang diễn ra.' });
        return;
      }
      const claimantSeat = match.player1_id === user.id ? 1 : 2;
      if (proof.claimantSeat !== claimantSeat || proof.stepCount !== evidence?.moves?.length + 1 ||
          proof.stepCount !== evidence?.disputedStep?.stepCount ||
          !Array.isArray(evidence?.disputedStep?.acknowledgements) ||
          evidence.disputedStep.acknowledgements.length !== 2 || evidence.matchId !== match.id ||
          sha256Canonical(evidence) !== proof.evidenceHash) {
        res.status(400).json({ error: 'Bằng chứng hash không khớp với biên bản trận đấu.' });
        return;
      }
      const localAck = evidence.disputedStep.acknowledgements.find((item: any) => item?.payload?.player === claimantSeat);
      const remoteAck = evidence.disputedStep.acknowledgements.find((item: any) => item?.payload?.player !== claimantSeat);
      if (proof.localHash !== localAck?.payload?.stateHash || proof.remoteHash !== remoteAck?.payload?.stateHash ||
          proof.localHash !== evidence.disputedStep.stateHash || proof.localHash === proof.remoteHash) {
        res.status(400).json({ error: 'Hash báo cáo không khớp với hai chữ ký đã nhận.' });
        return;
      }
      const claimantKey = claimantSeat === 1 ? match.player1_key : match.player2_key;
      if (!verifySessionProof(claimantKey, proof, report.signature)) {
        res.status(400).json({ error: 'Chữ ký bằng chứng kiểm tra hash không hợp lệ.' });
        return;
      }

      const decision = verifyConsensusDispute(evidence, match);
      if (!decision.adjudicated) {
        match.status = 'disputed';
        match.completed_at = new Date().toISOString();
        saveDb();
        const outcome = {
          matchId: match.id,
          claimantId: user.id,
          resolved: false,
          message: 'Hash hai bên bất đồng nhưng máy chủ chưa xác định được duy nhất bên sai. Trận được đánh dấu tranh chấp.',
        };
        for (const playerId of [match.player1_id, match.player2_id]) {
          sendWs(liveSockets.get(playerId), 'match-dispute-result', outcome);
        }
        res.json(outcome);
        return;
      }

      const offenderId = decision.offenderSeat === 1 ? match.player1_id : match.player2_id;
      const winnerId = offenderId === match.player1_id ? match.player2_id : match.player1_id;
      const score1 = winnerId === match.player1_id ? 1 : 0;
      const player1 = db.users.find((entry) => entry.id === match.player1_id)!;
      const player2 = db.users.find((entry) => entry.id === match.player2_id)!;
      const eloUpdated = match.match_type === 'bot' && !match.is_sparring;
      const player1Before = player1.elo;
      const player2Before = player2.elo;
      const player1After = eloUpdated ? calculateElo(player1Before, player2Before, score1) : player1Before;
      const player2After = eloUpdated ? calculateElo(player2Before, player1Before, 1 - score1) : player2Before;
      if (eloUpdated) {
        player1.elo = player1After;
        player2.elo = player2After;
      }
      db.matchResults.push({
        match_id: match.id,
        player1_elo_before: player1Before,
        player2_elo_before: player2Before,
        player1_elo_after: player1After,
        player2_elo_after: player2After,
        result_player1: score1,
        created_at: new Date().toISOString(),
      });
      if (match.tournament_id) {
        for (const [playerId, score] of [[match.player1_id, score1], [match.player2_id, 1 - score1]] as const) {
          const entry = db.tournamentEntries.find((item) => item.tournament_id === match.tournament_id && item.player_id === playerId);
          if (!entry) continue;
          entry.matches_played += 1;
          if (score === 1) entry.wins += 1;
          else entry.losses += 1;
          if (match.tournament_phase === 'ranked') {
            const progress = applyTournamentResult(entry.tier, entry.rank_stars, entry.season_points, score);
            entry.tier = progress.tier;
            entry.rank_stars = progress.stars;
            entry.season_points = progress.seasonPoints;
            entry.points = entry.wins;
          }
        }
      }
      match.status = 'completed';
      match.winner_id = winnerId;
      match.completed_at = new Date().toISOString();
      saveDb();
      const outcome = {
        matchId: match.id,
        claimantId: user.id,
        resolved: true,
        winnerId,
        winnerPlayer: winnerId === match.player1_id ? 1 : 2,
        offenderPlayer: decision.offenderSeat,
        stepCount: decision.stepCount,
        eloUpdated,
        player1EloAfter: player1After,
        player2EloAfter: player2After,
        message: 'Máy chủ xác minh transcript: chữ ký hash của đối thủ không khớp trạng thái bàn cờ.',
      };
      for (const playerId of [winnerId, offenderId]) {
        const playerNumber = playerId === match.player1_id ? 1 : 2;
        sendWs(liveSockets.get(playerId), 'match-dispute-result', {
          ...outcome,
          eloAfter: playerNumber === 1 ? player1After : player2After,
        });
      }
      res.json(outcome);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || 'Không thể xác minh bằng chứng hash.' });
    }
  });

  // ── WebSocket Server (/ws) ────────────────────────────────────
  interface AuthedSocket extends WebSocket {
    authenticated?: boolean;
    userId?: string;
    queueMode?: 'human' | 'bot' | 'tournament' | null;
    tournamentId?: string | null;
  }

  const liveSockets = new Map<string, AuthedSocket>();
  const humanQueue = new Set<string>();
  const botQueue = new Set<string>();
  const tournamentQueue = new Map<string, Set<string>>();

  const sendWs = (ws: WebSocket | undefined, type: string, data: Record<string, unknown> = {}) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }));
    }
  };

  function resolveDisconnectedMatch(match: MatchRecord, now = Date.now()) {
    const disconnectedId = match.disconnected_player_id;
    if (match.status !== 'active' || !disconnectedId) return false;

    const winnerId = disconnectedId === match.player1_id ? match.player2_id : match.player1_id;
    const player1 = db.users.find((entry) => entry.id === match.player1_id);
    const player2 = db.users.find((entry) => entry.id === match.player2_id);
    if (!player1 || !player2) return false;

    const resultPlayer1 = winnerId === match.player1_id ? 1 : 0;
    const eloUpdated = match.match_type === 'bot' && !match.is_sparring;
    const player1Before = player1.elo;
    const player2Before = player2.elo;
    const player1After = eloUpdated ? calculateElo(player1Before, player2Before, resultPlayer1) : player1Before;
    const player2After = eloUpdated ? calculateElo(player2Before, player1Before, 1 - resultPlayer1) : player2Before;
    if (eloUpdated) {
      player1.elo = player1After;
      player2.elo = player2After;
    }

    match.status = 'completed';
    match.winner_id = winnerId;
    match.completed_at = new Date(now).toISOString();
    match.disconnected_player_id = null;
    match.disconnected_at = null;
    db.matchResults.push({
      match_id: match.id,
      player1_elo_before: player1Before,
      player2_elo_before: player2Before,
      player1_elo_after: player1After,
      player2_elo_after: player2After,
      result_player1: resultPlayer1,
      created_at: match.completed_at,
    });

    if (match.tournament_id) {
      for (const [playerId, score] of [[match.player1_id, resultPlayer1], [match.player2_id, 1 - resultPlayer1]] as const) {
        const entry = db.tournamentEntries.find((item) => item.tournament_id === match.tournament_id && item.player_id === playerId);
        if (!entry) continue;
        entry.matches_played += 1;
        if (score === 1) entry.wins += 1;
        else entry.losses += 1;
        if (match.tournament_phase === 'ranked') {
          const progress = applyTournamentResult(entry.tier, entry.rank_stars, entry.season_points, score);
          entry.tier = progress.tier;
          entry.rank_stars = progress.stars;
          entry.season_points = progress.seasonPoints;
          entry.points = entry.wins;
        }
      }
    }

    sparringSessions.delete(match.id);
    saveDb();
    const common = {
      matchId: match.id,
      winnerId,
      winnerPlayer: winnerId === match.player1_id ? 1 : 2,
      disconnectedId,
      eloUpdated,
    };
    sendWs(liveSockets.get(winnerId), 'match-forfeited-win', {
      ...common,
      eloAfter: winnerId === match.player1_id ? player1After : player2After,
      message: 'Bạn thắng kỹ thuật vì đối thủ đã rời trận.',
    });
    sendWs(liveSockets.get(disconnectedId), 'match-forfeited', {
      ...common,
      eloAfter: disconnectedId === match.player1_id ? player1After : player2After,
      message: 'Bạn bị xử thua vì đã rời trận.',
    });
    return true;
  }

  function clearUserQueues(userId: string) {
    humanQueue.delete(userId);
    botQueue.delete(userId);
    for (const set of tournamentQueue.values()) {
      set.delete(userId);
    }
  }

  function pairPlayers(
    u1: UserRecord,
    u2: UserRecord,
    matchType: 'human' | 'bot',
    tournament: TournamentRecord | null = null
  ) {
    const firstIsP1 = Math.random() < 0.5;
    const p1 = firstIsP1 ? u1 : u2;
    const p2 = firstIsP1 ? u2 : u1;
    const seed = randomInt(100000, 2147483000);
    const phase = tournament
      ? tournament.status === 'registration'
        ? 'practice'
        : 'ranked'
      : null;
    const rules =
      tournament && tournament.status === 'qualifying'
        ? tournament.rules_json || weeklyRules(tournament.current_week || 1, tournament.rules_schedule)
        : null;

    const match: MatchRecord = {
      id: randomUUID(),
      seed,
      player1_id: p1.id,
      player2_id: p2.id,
      match_type: matchType,
      status: 'active',
      tournament_id: tournament?.id || null,
      tournament_phase: phase,
      tournament_rules: rules,
      player1_key: null,
      player2_key: null,
      winner_id: null,
      final_state_hash: null,
      replay_sha256: null,
      replay_json: null,
      player1_proof: null,
      player2_proof: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    db.matches.push(match);
    saveDb();

    const baseMatchPayload = {
      id: match.id,
      seed: match.seed,
      pieceCount: 9,
      mode: matchType,
      tournamentId: match.tournament_id,
      tournamentPhase: match.tournament_phase,
      rules: match.tournament_rules,
      player1: { id: p1.id, displayName: p1.display_name, elo: p1.elo },
      player2: { id: p2.id, displayName: p2.display_name, elo: p2.elo },
    };

    const ws1 = liveSockets.get(p1.id);
    const ws2 = liveSockets.get(p2.id);
    if (ws1) {
      ws1.queueMode = null;
      sendWs(ws1, 'match-found', {
        role: 'player1',
        seat: 1,
        match: baseMatchPayload,
        opponent: { id: p2.id, displayName: p2.display_name, elo: p2.elo },
      });
    }
    if (ws2) {
      ws2.queueMode = null;
      sendWs(ws2, 'match-found', {
        role: 'player2',
        seat: 2,
        match: baseMatchPayload,
        opponent: { id: p1.id, displayName: p1.display_name, elo: p1.elo },
      });
    }
    return match;
  }

  // Handle server-side Sparring Bot consensus responses
  async function handleSparringRelay(session: SparringSession, humanWs: AuthedSocket, packet: any) {
    if (session.destroyed) return;
    const sendToHuman = (payload: Record<string, unknown>) => {
      sendWs(humanWs, 'match-relay', {
        matchId: session.matchId,
        from: '00000000-0000-4000-8000-000000000001',
        payload,
      });
    };

    const triggerBotMoveIfNeeded = async () => {
      if (session.destroyed || session.state.winner || session.state.turn !== session.botSeat) return;
      await new Promise((r) => setTimeout(r, 220));
      if (session.destroyed || session.state.winner) return;
      const move = pickTacticalBotMove(session.state, session.botSeat);
      if (!move) return;
      const stepIdx = session.state.stepCount;
      const nonce = randomBytes(32).toString('hex');
      const commit = sha256Canonical({
        matchId: session.matchId,
        stepCount: stepIdx,
        player: session.botSeat,
        move,
        nonce,
      });
      const commitPayload = {
        kind: 'move-commit',
        matchId: session.matchId,
        stepCount: stepIdx,
        player: session.botSeat,
        hash: commit,
      };
      const commitSig = await signWithWebCrypto(session.privateKey, commitPayload);
      sendToHuman({
        type: 'CONSENSUS_COMMIT',
        attestation: { payload: commitPayload, signature: commitSig },
      });

      const revealPayload = {
        kind: 'move-reveal',
        matchId: session.matchId,
        stepCount: stepIdx,
        player: session.botSeat,
        move,
        nonce,
        commit,
      };
      const revealSig = await signWithWebCrypto(session.privateKey, revealPayload);
      session.state = OTTGameEngine.applyMove(session.state, move);
      const stateHash = sha256Canonical(statePayload(session.state));
      const ackPayload = {
        kind: 'state-ack',
        matchId: session.matchId,
        stepCount: session.state.stepCount,
        player: session.botSeat,
        moveCommit: commit,
        stateHash,
      };
      const ackSig = await signWithWebCrypto(session.privateKey, ackPayload);

      sendToHuman({
        type: 'CONSENSUS_REVEAL',
        attestation: { payload: revealPayload, signature: revealSig },
      });
      sendToHuman({
        type: 'CONSENSUS_ACK',
        attestation: { payload: ackPayload, signature: ackSig },
      });

      if (session.state.winner) {
        const finalProof = {
          matchId: session.matchId,
          roomId: session.matchId,
          stepCount: session.state.stepCount,
          stateHash,
          winner: session.state.winner,
        };
        const finalSig = await signWithWebCrypto(session.privateKey, finalProof);
        sendToHuman({
          type: 'FINAL_PROOF',
          seat: session.botSeat,
          proof: finalProof,
          signature: finalSig,
        });
      }
    };

    if (packet.type === 'BOT_READY') {
      sendToHuman({ type: 'BOT_READY', botLabel: 'Hắc Kỵ Sĩ AI (Minimax)' });
      await triggerBotMoveIfNeeded();
      return;
    }

    if (packet.type === 'CONSENSUS_HELLO') {
      sendToHuman({
        type: 'CONSENSUS_HELLO',
        seat: session.botSeat,
        publicKey: session.publicJwk,
      });
      if ( packet.autoStart ) {
        await triggerBotMoveIfNeeded();
      }
      return;
    }

    if (packet.type === 'CONSENSUS_COMMIT') {
      const att = packet.attestation;
      if (att?.payload) {
        session.pendingCommits.set(att.payload.stepCount, {
          commit: att.payload.hash,
          commitAttestation: att,
        });
      }
      return;
    }

    if (packet.type === 'CONSENSUS_REVEAL') {
      const att = packet.attestation;
      const p = att?.payload;
      if (!p || p.player !== session.humanSeat) return;
      session.state = OTTGameEngine.applyMove(session.state, {
        from: p.move.from,
        to: p.move.to,
      });
      const stateHash = sha256Canonical(statePayload(session.state));
      const ackPayload = {
        kind: 'state-ack',
        matchId: session.matchId,
        stepCount: session.state.stepCount,
        player: session.botSeat,
        moveCommit: p.commit,
        stateHash,
      };
      const ackSig = await signWithWebCrypto(session.privateKey, ackPayload);
      sendToHuman({
        type: 'CONSENSUS_ACK',
        attestation: { payload: ackPayload, signature: ackSig },
      });

      if (session.state.winner) {
        const finalProof = {
          matchId: session.matchId,
          roomId: session.matchId,
          stepCount: session.state.stepCount,
          stateHash,
          winner: session.state.winner,
        };
        const finalSig = await signWithWebCrypto(session.privateKey, finalProof);
        sendToHuman({
          type: 'FINAL_PROOF',
          seat: session.botSeat,
          proof: finalProof,
          signature: finalSig,
        });
      } else {
        await triggerBotMoveIfNeeded();
      }
    }
  }

  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 256 * 1024 });

  wss.on('connection', (ws: AuthedSocket) => {
    ws.authenticated = false;
    const authTimer = setTimeout(() => ws.close(4401, 'Authentication timeout'), 8000);

    ws.on('message', async (raw) => {
      let packet: any;
      try {
        packet = JSON.parse(raw.toString());
      } catch {
        sendWs(ws, 'error', { message: 'Dữ liệu JSON không hợp lệ.' });
        return;
      }

      try {
        if (!ws.authenticated) {
          if (packet.type !== 'auth' || typeof packet.token !== 'string') {
            ws.close(4401, 'Send auth token first');
            return;
          }
          const auth = verifyToken(packet.token);
          const user = db.users.find((u) => u.id === auth.sub);
          if (!user) {
            ws.close(4401, 'Unknown account');
            return;
          }
          clearTimeout(authTimer);
          ws.authenticated = true;
          ws.userId = user.id;
          const prev = liveSockets.get(user.id);
          liveSockets.set(user.id, ws);
          if (prev && prev !== ws) prev.close(4001, 'Replaced by newer session');
          sendWs(ws, 'authenticated', { user: publicUser(user) });
          return;
        }

        const user = db.users.find((u) => u.id === ws.userId)!;

        if (packet.type === 'leave-match') {
          const match = db.matches.find((entry) => entry.id === packet.matchId && entry.status === 'active');
          if (!match || (match.player1_id !== user.id && match.player2_id !== user.id)) {
            sendWs(ws, 'error', { message: 'Không tìm thấy trận đấu đang diễn ra.' });
            return;
          }
          match.disconnected_player_id = user.id;
          match.disconnected_at = new Date().toISOString();
          resolveDisconnectedMatch(match);
          saveDb();
          sendWs(ws, 'match-left', { matchId: match.id });        } else if (packet.type === 'find-match' || packet.type === 'find-bot-match') {
          clearUserQueues(user.id);
          const mode: 'human' | 'bot' = packet.type === 'find-bot-match' ? 'bot' : 'human';
          const targetQueue = mode === 'bot' ? botQueue : humanQueue;

          let opponentId: string | null = null;
          for (const candidateId of targetQueue) {
            if (candidateId !== user.id && liveSockets.get(candidateId)?.readyState === WebSocket.OPEN) {
              opponentId = candidateId;
              break;
            }
          }

          if (opponentId) {
            targetQueue.delete(opponentId);
            const opp = db.users.find((u) => u.id === opponentId)!;
            pairPlayers(user, opp, mode, null);
          } else {
            targetQueue.add(user.id);
            ws.queueMode = mode;
            sendWs(ws, 'searching', { elo: user.elo, mode });
          }
        } else if (packet.type === 'find-tournament-match') {
          clearUserQueues(user.id);
          updateTournamentLifecycle();
          const t = db.tournaments.find((tour) => tour.id === packet.tournamentId);
          if (!t || !['registration', 'qualifying'].includes(t.status)) {
            sendWs(ws, 'error', { message: 'Giải đấu hiện không mở ghép trận.' });
            return;
          }
          const entry = db.tournamentEntries.find(
            (e) => e.tournament_id === t.id && e.player_id === user.id
          );
          if (!entry) {
            sendWs(ws, 'error', { message: 'Bạn cần bấm Tham gia giải trước khi tìm trận.' });
            return;
          }

          const qSet = tournamentQueue.get(t.id) || new Set<string>();
          tournamentQueue.set(t.id, qSet);

          let opponentId: string | null = null;
          for (const candidateId of qSet) {
            if (candidateId !== user.id && liveSockets.get(candidateId)?.readyState === WebSocket.OPEN) {
              opponentId = candidateId;
              break;
            }
          }

          if (opponentId) {
            qSet.delete(opponentId);
            const opp = db.users.find((u) => u.id === opponentId)!;
            pairPlayers(user, opp, 'bot', t);
          } else {
            qSet.add(user.id);
            ws.queueMode = 'tournament';
            ws.tournamentId = t.id;
            sendWs(ws, 'searching', { elo: user.elo, mode: 'tournament', tournamentId: t.id });
          }
        } else if (packet.type === 'find-sparring-match') {
          // Instant real server-verified sparring opponent for 1-tab solo testing!
          clearUserQueues(user.id);
          const mode: 'human' | 'bot' = packet.mode === 'human' ? 'human' : 'bot';
          const t = packet.tournamentId
            ? db.tournaments.find((tour) => tour.id === packet.tournamentId) || null
            : null;
          const sysBot = db.users.find((u) => u.is_system_bot)!;
          const match = pairPlayers(user, sysBot, mode, t);
          match.is_sparring = true;
          saveDb();

          const kp = await webcrypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['sign', 'verify']
          );
          const publicJwk = (await webcrypto.subtle.exportKey('jwk', kp.publicKey)) as Record<
            string,
            unknown
          >;

          const humanSeat: 1 | 2 = match.player1_id === user.id ? 1 : 2;
          const botSeat: 1 | 2 = humanSeat === 1 ? 2 : 1;
          if (botSeat === 1) match.player1_key = publicJwk;
          else match.player2_key = publicJwk;
          saveDb();

          sparringSessions.set(match.id, {
            matchId: match.id,
            humanSeat,
            botSeat,
            privateKey: kp.privateKey,
            publicJwk,
            state: OTTGameEngine.createGame(match.seed, 9, match.tournament_rules || null),
            pendingCommits: new Map(),
            moves: [],
            destroyed: false,
          });

          sendWs(ws, 'sparring-ready', { matchId: match.id, botSeat, publicKey: publicJwk });
        } else if (packet.type === 'cancel-match') {
          clearUserQueues(user.id);
          ws.queueMode = null;
          sendWs(ws, 'search-cancelled', {});
        } else if (packet.type === 'session-key') {
          const match = db.matches.find((m) => m.id === packet.matchId && m.status === 'active');
          if (!match) {
            sendWs(ws, 'error', { message: 'Không tìm thấy trận đấu đang diễn ra.' });
            return;
          }
          if (match.player1_id === user.id) match.player1_key = packet.publicKey;
          else if (match.player2_id === user.id) match.player2_key = packet.publicKey;
          saveDb();
          sendWs(ws, 'session-key-accepted', { matchId: match.id });
        } else if (packet.type === 'signal' || packet.type === 'match-relay') {
          const match = db.matches.find((m) => m.id === packet.matchId && m.status === 'active');
          if (!match) return;
          const spar = sparringSessions.get(match.id);
          if (spar && packet.type === 'match-relay') {
            await handleSparringRelay(spar, ws, packet.payload);
            return;
          }
          const peerId = match.player1_id === user.id ? match.player2_id : match.player1_id;
          const peerSocket = liveSockets.get(peerId);
          if (!peerSocket || peerSocket.readyState !== WebSocket.OPEN) {
            match.disconnected_player_id = peerId;
            match.disconnected_at = new Date().toISOString();
            resolveDisconnectedMatch(match);
            saveDb();
            return;
          }
          sendWs(peerSocket, packet.type, {
            matchId: match.id,
            from: user.id,
            payload: packet.payload,
          });
        } else if (packet.type === 'bot-forfeit' || packet.type === 'bot-setup-failed') {
          const match = db.matches.find((m) => m.id === packet.matchId && m.status === 'active');
          if (match) {
            const forfeitingUserId = user.id;
            const winningUserId = match.player1_id === forfeitingUserId ? match.player2_id : match.player1_id;
            match.status = 'completed';
            match.winner_id = winningUserId;
            match.completed_at = new Date().toISOString();
            sparringSessions.delete(match.id);

            const u1 = db.users.find((u) => u.id === match.player1_id)!;
            const u2 = db.users.find((u) => u.id === match.player2_id)!;
            const score1 = winningUserId === match.player1_id ? 1 : 0;
            const eloUpdated = match.match_type === 'bot' && !match.is_sparring;
            const u1Before = u1.elo;
            const u2Before = u2.elo;
            const u1After = eloUpdated ? calculateElo(u1Before, u2Before, score1) : u1Before;
            const u2After = eloUpdated ? calculateElo(u2Before, u1Before, 1 - score1) : u2Before;

            if (eloUpdated) {
              u1.elo = u1After;
              u2.elo = u2After;
            }

            if (match.tournament_id) {
              const e1 = db.tournamentEntries.find((e) => e.tournament_id === match.tournament_id && e.player_id === u1.id);
              const e2 = db.tournamentEntries.find((e) => e.tournament_id === match.tournament_id && e.player_id === u2.id);
              for (const [entry, sc] of [[e1, score1], [e2, 1 - score1]] as const) {
                if (!entry) continue;
                entry.matches_played += 1;
                if (sc === 1) entry.wins += 1;
                else entry.losses += 1;
                if (match.tournament_phase === 'ranked') {
                  const prog = applyTournamentResult(entry.tier, entry.rank_stars, entry.season_points, sc);
                  entry.tier = prog.tier;
                  entry.rank_stars = prog.stars;
                  entry.season_points = prog.seasonPoints;
                  entry.points = entry.wins;
                }
              }
            }

            db.matchResults.push({
              match_id: match.id,
              player1_elo_before: u1Before,
              player2_elo_before: u2Before,
              player1_elo_after: u1After,
              player2_elo_after: u2After,
              result_player1: score1,
              created_at: match.completed_at,
            });

            saveDb();

            const peerSocket = liveSockets.get(winningUserId);
            const forfeitMsg = 'Äá»‘i thá»§ gáº·p lá»—i Python / TLE. Báº¡n giÃ nh chiáº¿n tháº¯ng ká»¹ thuáº­t!';
            sendWs(peerSocket, 'match-forfeited-win', { matchId: match.id, winnerId: winningUserId, message: forfeitMsg });
            sendWs(ws, 'match-forfeited-loss', { matchId: match.id, winnerId: winningUserId, message: 'Bot cá»§a báº¡n gáº·p lá»—i / TLE vÃ  bá»‹ xá»­ thua ká»¹ thuáº­t.' });
          }
} else if (packet.type === 'ping') {
          sendWs(ws, 'pong', { at: Date.now() });
        }
      } catch (err: any) {
        sendWs(ws, 'error', { message: err.message || 'Lỗi xử lý WebSocket.' });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (ws.userId) {
        clearUserQueues(ws.userId);
        if (liveSockets.get(ws.userId) === ws) {
          liveSockets.delete(ws.userId);
          const disconnectedAt = new Date().toISOString();
          for (const match of db.matches) {
            if (match.status !== 'active' || (match.player1_id !== ws.userId && match.player2_id !== ws.userId)) continue;
            match.disconnected_player_id = ws.userId;
            match.disconnected_at = disconnectedAt;
            resolveDisconnectedMatch(match);
          }
          saveDb();
        }
      }
    });
  });

  // ── Vite Middleware (Dev) or Static Serve (Prod) ──────────────
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`OTTv2 Full-Stack Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start OTTv2 server:', err);
  process.exit(1);
});
