import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../../server.ts';

test('Group Knockout Tournament E2E: creation, registration, 8 Elo tiers distribution and queue scheduling', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ottv2-group-tour-'));
  const dbPath = path.join(tmpDir, 'test-db.json');

  // Step 1: Boot server once to generate initial schema & password hashes, then close
  const boot = await startServer({
    port: 0,
    dbPath,
    skipVite: true,
    testAdminEmails: ['admin@ottv2.local'],
  });
  await boot.close();

  // Step 2: Seed 16 contestants with distinct Elo ratings (1250 to 2000)
  const rawDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const adminUser = rawDb.users.find((u) => u.email === 'admin@ottv2.local');
  const pwHash = adminUser.password_hash;
  const tourId = randomUUID();
  const now = Date.now();

  rawDb.tournaments.push({
    id: tourId,
    name: 'Giải Đấu 8 Bảng Elo Tự Động',
    format: 'group_knockout',
    description: 'Test tự động chia 8 bảng phân theo các mức elo',
    status: 'registration',
    registration_opens_at: new Date(now - 10000).toISOString(),
    registration_closes_at: new Date(now + 1000000).toISOString(),
    tournament_starts_at: new Date(now + 2000000).toISOString(),
    ends_at: new Date(now + 90 * 86400000).toISOString(),
    max_teams: 2147483647,
    group_count: null,
    current_week: 0,
    last_reset_week: 0,
    week_started_at: null,
    rules_json: {
      id: 'group-knockout-custom',
      title: 'Giải đấu bảng + knock-out',
      week: 1,
      rows: 9,
      cols: 9,
      blockedCells: [11, 19],
      moveLimitRule: 'remaining-pieces',
      moveLimit: 25,
    },
    rules_schedule: [],
    created_at: new Date().toISOString(),
  });

  const seededTokens = [];
  for (let i = 0; i < 16; i++) {
    const elo = 1250 + i * 50; // 1250, 1300, ..., 2000
    const uid = `player-elo-${elo}-${i}`;
    rawDb.users.push({
      id: uid,
      email: `player_${elo}@ottv2.local`,
      password_hash: pwHash,
      display_name: `Contestant_${elo}`,
      elo,
      is_admin: false,
      active_bot_version: 1,
      created_at: new Date(now - 100000 + i * 1000).toISOString(),
    });
    rawDb.botVersions.push({
      id: randomUUID(),
      user_id: uid,
      version: 1,
      code: `def get_next_move(my_player_id, game_state):\n    moves = game_state.get('validMoves', [])\n    return moves[0] if moves else None\n`,
      created_at: new Date().toISOString(),
    });
    rawDb.tournamentEntries.push({
      tournament_id: tourId,
      player_id: uid,
      bot_version: 1,
      matches_played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      tournament_elo: elo,
      tier: 'Bronze',
      rank_stars: 0,
      season_points: 0,
      registered_at: new Date(now - 50000 + i * 1000).toISOString(),
    });
  }
  fs.writeFileSync(dbPath, JSON.stringify(rawDb, null, 2), 'utf8');

  // Step 3: Start live server from seeded DB
  const srv = await startServer({
    port: 0,
    dbPath,
    skipVite: true,
    testAdminEmails: ['admin@ottv2.local'],
  });

  try {
    const addr = srv.httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    async function api(method, route, token = null, body = undefined) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${route}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, data: json };
    }

    const adminLogin = await api('POST', '/api/auth/login', null, {
      email: 'admin@ottv2.local',
      password: 'halloween2026',
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token;

    // Step 4: Admin divides contestants into 8 groups by Elo tiers
    const groupRes = await api('POST', `/api/tournaments/${tourId}/groups`, adminToken, {
      groupCount: 8,
    });
    assert.equal(groupRes.status, 201);
    assert.equal(groupRes.data.groups.length, 8);

    // Verify Elo tiering:
    // Sorted descending: Contestant_2000 and Contestant_1950 in Group 1,
    // Contestant_1300 and Contestant_1250 in Group 8.
    const g1 = groupRes.data.groups[0];
    const g8 = groupRes.data.groups[7];
    assert.equal(g1.number, 1);
    assert.equal(g8.number, 8);
    assert.equal(g1.avgElo, 1975);
    assert.equal(g1.minElo, 1950);
    assert.equal(g1.maxElo, 2000);

    assert.equal(g8.avgElo, 1275);
    assert.equal(g8.minElo, 1250);
    assert.equal(g8.maxElo, 1300);

    assert.ok(g1.avgElo > g8.avgElo, 'Group 1 Elo should be strictly higher than Group 8 Elo');

    // Step 5: Fetch tournament details and verify minElo, maxElo, avgElo are returned
    const det = await api('GET', `/api/tournaments/${tourId}`, adminToken);
    assert.equal(det.status, 200);
    assert.equal(det.data.groups.length, 8);
    for (const group of det.data.groups) {
      assert.ok(Number.isInteger(group.avgElo), `Group ${group.group_number} avgElo should be an integer`);
      assert.ok(Number.isInteger(group.minElo), `Group ${group.group_number} minElo should be an integer`);
      assert.ok(Number.isInteger(group.maxElo), `Group ${group.group_number} maxElo should be an integer`);
      assert.equal(group.members.length, 2);
    }

    // Step 6: Start group stage
    const startRes = await api('POST', `/api/tournaments/${tourId}/start-groups`, adminToken);
    assert.equal(startRes.status, 200);
    assert.equal(startRes.data.tournament.status, 'group_running');

    // Step 7: Fair interleaved queue runner
    const autoRes = await api('POST', `/api/tournaments/${tourId}/run-auto`, adminToken);
    assert.equal(autoRes.status, 200);
    assert.equal(autoRes.data.success, true);
  } finally {
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
