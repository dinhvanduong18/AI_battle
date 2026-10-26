const QUEUE = 'ottv2:matchmaking';
const BOT_QUEUE = 'ottv2:bot-matchmaking';
const MATCH_SCRIPT = `
local own = ARGV[1]
local elo = tonumber(ARGV[2])
local gap = tonumber(ARGV[3])
local items = redis.call('ZRANGEBYSCORE', KEYS[1], elo-gap, elo+gap)
local best, bestDelta = nil, math.huge
for _, item in ipairs(items) do
  local sep = string.find(item, '|', 1, true)
  local id = string.sub(item, 1, sep-1)
  local rating = tonumber(string.sub(item, sep+1))
  if id ~= own and math.abs(rating-elo) < bestDelta then best, bestDelta = item, math.abs(rating-elo) end
end
if best then redis.call('ZREM', KEYS[1], best); redis.call('ZREM', KEYS[1], own .. '|' .. elo); return best end
redis.call('ZREM', KEYS[1], own .. '|' .. elo)
redis.call('ZADD', KEYS[1], elo, own .. '|' .. elo)
return false
`;

export async function enqueueOrMatch(redis, user, config) {
  const gap = Math.min(config.maxEloGap, config.currentGap || config.minEloGap);
  const queue = config.queueName || QUEUE;
  const found = await redis.eval(MATCH_SCRIPT, { keys: [queue], arguments: [user.id, String(user.elo), String(gap)] });
  if (!found) return null;
  const [opponentId] = String(found).split('|');
  if (!opponentId || opponentId === user.id) return null;
  return { opponentId, queuedAt: Date.now() };
}

export async function cancelQueue(redis, userId, queueName = null) {
  const queues = queueName ? [queueName] : [QUEUE, BOT_QUEUE];
  for (const queue of queues) {
    const entries = await redis.zRange(queue, 0, -1);
    const mine = entries.filter(item => item.startsWith(`${userId}|`));
    if (mine.length) await redis.zRem(queue, mine);
  }
}

export async function putBackInQueue(redis, userId) {
  // Elo is embedded in the existing member; matchmaking invokes this only with a known member.
  const entries = await redis.zRange(QUEUE, 0, -1);
  return entries.find(item => item.startsWith(`${userId}|`)) || null;
}

const TOURNAMENT_MATCH_SCRIPT = `
local ownTeam = ARGV[1]
local ownMember = ARGV[2]
local elo = tonumber(ARGV[3])
local gap = tonumber(ARGV[4])
local randomMode = tonumber(ARGV[5]) or 0
local randOffset = tonumber(ARGV[6]) or 0
local ownFirst = string.find(ownMember, '|', 1, true)
local ownSecond = string.find(ownMember, '|', ownFirst+1, true)
local ownUser = string.sub(ownMember, ownFirst+1, ownSecond-1)
local items = redis.call('ZRANGEBYSCORE', KEYS[1], elo-gap, elo+gap)
local best, bestDelta = nil, math.huge
local candidates = {}
for _, item in ipairs(items) do
  local first = string.find(item, '|', 1, true)
  local team = string.sub(item, 1, first-1)
  local second = string.find(item, '|', first+1, true)
  local user = string.sub(item, first+1, second-1)
  local rating = tonumber(string.match(item, '[^|]+$'))
  if team ~= ownTeam and user ~= ownUser and rating then
    table.insert(candidates, item)
    if math.abs(rating-elo) < bestDelta then
      best, bestDelta = item, math.abs(rating-elo)
    end
  end
end
if randomMode == 1 and #candidates > 0 then
  local idx = (randOffset % #candidates) + 1
  best = candidates[idx]
end
if best then
  redis.call('ZREM', KEYS[1], best)
  redis.call('ZREM', KEYS[1], ownMember)
  return best
end
redis.call('ZREM', KEYS[1], ownMember)
redis.call('ZADD', KEYS[1], elo, ownMember)
return false
`;

export async function enqueueTournamentOrMatch(
  redis,
  { teamId, userId, version, elo, tier, week },
  tournamentId,
  gap,
  namespace = 'ottv2:tournament',
  options = {}
) {
  const queue = `${namespace}:${tournamentId}:${week || 1}:${tier || 'Bronze'}`;
  const member = `${teamId}|${userId}|${version}|${elo}`;
  const randomMode = options.randomPairing ? '1' : '0';
  const randOffset = String(Math.floor(Math.random() * 1000000));
  const found = await redis.eval(TOURNAMENT_MATCH_SCRIPT, {
    keys: [queue],
    arguments: [teamId, member, String(elo), String(gap), randomMode, randOffset]
  });
  if (!found) return null;
  const [opponentTeamId, opponentUserId, opponentVersion, opponentElo] = String(found).split('|');
  if (!opponentTeamId || !opponentUserId || opponentTeamId === teamId) return null;
  return {
    queue,
    week: Number(week) || 1,
    opponentTeamId,
    opponentUserId,
    opponentVersion: Number(opponentVersion),
    opponentElo: Number(opponentElo),
    member
  };
}

export async function cancelTournamentQueue(redis, tournamentId, teamId, userId = null, week = 1, namespace = 'ottv2:tournament') {
  if (!tournamentId || !teamId) return;
  const prefix = userId ? `${teamId}|${userId}|` : `${teamId}|`;
  for (const tier of ['Bronze', 'Silver', 'Gold', 'Master', 'Challenger', 'Practice']) {
    const queue = `${namespace}:${tournamentId}:${week}:${tier}`;
    const entries = await redis.zRange(queue, 0, -1);
    const mine = entries.filter(item => item.startsWith(prefix));
    if (mine.length) await redis.zRem(queue, mine);
  }
}
