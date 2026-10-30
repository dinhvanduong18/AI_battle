import { randomInt } from 'node:crypto';

export const GROUP_COUNTS = [8, 16, 32];
export const TOURNAMENT_MOVE_LIMIT = 25;

export function buildTournamentRules(
  blockedCells,
  moveLimitRule,
  capturedPieceValues = { rock: 1, paper: 2, scissors: 3 }
) {
  if (!Array.isArray(blockedCells) || blockedCells.some((cell) =>
    !Number.isInteger(cell) || cell < 0 || cell >= 81
  )) {
    throw new Error('Ô chướng ngại không hợp lệ.');
  }
  const uniqueBlockedCells = [...new Set(blockedCells)];
  if (uniqueBlockedCells.includes(8) || uniqueBlockedCells.includes(72)) {
    throw new Error('Không thể đặt chướng ngại lên ô đích a1 hoặc i9.');
  }
  const blockedSet = new Set(uniqueBlockedCells);
  if (uniqueBlockedCells.some((cell) =>
    !blockedSet.has((cell % 9) * 9 + Math.floor(cell / 9))
  )) {
    throw new Error('Chướng ngại phải đối xứng để hai bên có bàn đấu cân bằng.');
  }
  const playableStartingPairs = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (row <= col) continue;
      const index = row * 9 + col;
      const mirroredIndex = col * 9 + row;
      if (!uniqueBlockedCells.includes(index) && !uniqueBlockedCells.includes(mirroredIndex)) {
        playableStartingPairs.push(index);
      }
    }
  }
  if (playableStartingPairs.length < 3) {
    throw new Error('Bàn cờ cần còn ít nhất 3 cặp ô khởi đầu đối xứng.');
  }
  if (!['standard', 'remaining-pieces', 'goal-distance', 'captured-points'].includes(moveLimitRule)) {
    throw new Error('Chọn luật xử lý hợp lệ sau 25 nước.');
  }
  const pieceValues = {};
  if (moveLimitRule === 'captured-points') {
    for (const piece of ['rock', 'paper', 'scissors']) {
      const value = Number(capturedPieceValues?.[piece]);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error('Điểm mỗi loại quân phải là số nguyên từ 1 đến 100.');
      }
      pieceValues[piece] = value;
    }
  }
  return {
    id: 'group-knockout-custom',
    title: 'Giải đấu bảng + knock-out',
    week: 1,
    rows: 9,
    cols: 9,
    blockedCells: uniqueBlockedCells.sort((a, b) => a - b),
    moveLimitRule,
    ...(moveLimitRule === 'standard' ? {} : { moveLimit: TOURNAMENT_MOVE_LIMIT }),
    ...(moveLimitRule === 'captured-points' ? { capturedPieceValues: pieceValues } : {}),
  };
}

/**
 * Phân bảng giải đấu:
 * Mặc định: Phân theo các mức Elo (8 mức tương ứng với 8 bảng, chênh lệch Elo trong mỗi bảng là nhỏ nhất).
 * Các thí sinh có Elo cao nhất vào Bảng 1, tiếp theo Bảng 2, ..., thấp nhất Bảng 8.
 * Hỗ trợ fallback bốc thăm ngẫu nhiên nếu truyền options.byElo === false hoặc hàm random tùy chỉnh khi không có elo.
 */
export function distributeTournamentGroups(entries, groupCount = 8, options = {}) {
  if (!GROUP_COUNTS.includes(groupCount)) {
    throw new Error('Số bảng phải là 8, 16 hoặc 32.');
  }
  if (!Array.isArray(entries) || entries.length < groupCount * 2) {
    throw new Error(`Cần tối thiểu ${groupCount * 2} đấu thủ để chia ${groupCount} bảng.`);
  }

  const hasElo = entries.some(e => e && (e.elo !== undefined && e.elo !== null));
  const isCustomFunction = typeof options === 'function';
  const explicitlyDisableElo = typeof options === 'object' && options !== null && options.byElo === false;
  const useElo = !explicitlyDisableElo && (hasElo || (typeof options === 'object' && options?.byElo === true));

  if (useElo && hasElo) {
    // Sắp xếp đấu thủ theo Elo giảm dần (cao xuống thấp)
    // Nếu bằng Elo, ưu tiên thời gian đăng ký sớm hơn để đảm bảo tính xác định (deterministic)
    const sorted = [...entries].sort((a, b) => {
      const eloA = Number(a?.elo ?? a?.rating) || 1200;
      const eloB = Number(b?.elo ?? b?.rating) || 1200;
      if (eloB !== eloA) return eloB - eloA;
      return String(a?.registered_at || '').localeCompare(String(b?.registered_at || '')) ||
             String(a?.player_id || '').localeCompare(String(b?.player_id || ''));
    });

    const groups = Array.from({ length: groupCount }, (_, index) => ({
      number: index + 1,
      entrants: [],
      minElo: null,
      maxElo: null,
      avgElo: null
    }));

    const total = sorted.length;
    sorted.forEach((entry, index) => {
      // Chia 8 mức Elo đều theo phân vị: Bảng 1 gồm top đầu, Bảng 8 gồm top cuối
      const groupIdx = Math.min(groupCount - 1, Math.floor((index * groupCount) / total));
      groups[groupIdx].entrants.push(entry);
    });

    // Tính toán thống kê Elo cho từng bảng
    groups.forEach(group => {
      if (group.entrants.length > 0) {
        const elos = group.entrants.map(e => Number(e?.elo ?? e?.rating) || 1200);
        group.minElo = Math.min(...elos);
        group.maxElo = Math.max(...elos);
        group.avgElo = Math.round(elos.reduce((sum, val) => sum + val, 0) / elos.length);
      }
    });

    return groups;
  }

  // Fallback bốc thăm ngẫu nhiên khi không có dữ liệu Elo
  const random = isCustomFunction ? options : randomInt;
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = random(0, index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const groups = Array.from({ length: groupCount }, (_, index) => ({
    number: index + 1,
    entrants: [],
  }));
  shuffled.forEach((entry, index) => groups[index % groupCount].entrants.push(entry));
  return groups;
}

export function createDoubleRoundRobinFixtures(groups) {
  const fixtures = [];
  for (const group of groups) {
    const entrants = [...group.entrants];
    if (entrants.length % 2 !== 0) entrants.push(null);
    const rotation = [...entrants];
    const roundCount = rotation.length - 1;
    for (let round = 0; round < roundCount; round++) {
      for (let index = 0; index < rotation.length / 2; index++) {
        const first = rotation[index];
        const second = rotation[rotation.length - 1 - index];
        if (first && second) {
          fixtures.push({
            phase: 'group',
            groupNumber: group.number,
            roundNumber: round + 1,
            leg: 1,
            player1Id: first.player_id,
            player2Id: second.player_id,
            status: 'pending',
          });
          fixtures.push({
            phase: 'group',
            groupNumber: group.number,
            roundNumber: round + 1 + roundCount,
            leg: 2,
            player1Id: second.player_id,
            player2Id: first.player_id,
            status: 'pending',
          });
        }
      }
      rotation.splice(1, 0, rotation.pop());
    }
  }
  return fixtures;
}

export function calculateGroupStandings(entrants, fixtures) {
  const standings = new Map(entrants.map((entrant) => [entrant.player_id, {
    ...entrant,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    matchesPlayed: 0,
    moveDifference: 0,
  }]));
  for (const fixture of fixtures) {
    if (fixture.status !== 'completed' || (fixture.phase && fixture.phase !== 'group')) continue;
    const first = standings.get(fixture.player1_id);
    const second = standings.get(fixture.player2_id);
    if (!first || !second) continue;
    const moves = Number(fixture.move_count) || 0;
    first.matchesPlayed++;
    second.matchesPlayed++;
    if (!fixture.winner_id) {
      first.points++;
      second.points++;
      first.draws++;
      second.draws++;
      continue;
    }
    const winner = fixture.winner_id === first.player_id ? first : second;
    const loser = winner === first ? second : first;
    winner.points += 3;
    winner.wins++;
    loser.losses++;
    winner.moveDifference -= moves;
    loser.moveDifference += moves;
  }
  return [...standings.values()].sort((first, second) =>
    Number(first.group_number) - Number(second.group_number) ||
    second.points - first.points ||
    first.moveDifference - second.moveDifference ||
    String(first.registered_at).localeCompare(String(second.registered_at)) ||
    String(first.player_id).localeCompare(String(second.player_id))
  );
}

export function createKnockoutOpeningRound(groupStandings) {
  const byGroup = new Map();
  for (const row of groupStandings) {
    const group = byGroup.get(row.group_number) || [];
    group.push(row);
    byGroup.set(row.group_number, group);
  }
  const groupNumbers = [...byGroup.keys()].sort((a, b) => a - b);
  if (!GROUP_COUNTS.includes(groupNumbers.length) ||
      groupNumbers.some((number) => (byGroup.get(number)?.length || 0) < 2)) {
    throw new Error('Cần tối thiểu 2 đấu thủ trong mỗi bảng để vào vòng knock-out.');
  }
  const fixtures = [];
  for (let index = 0; index < groupNumbers.length; index += 2) {
    const firstGroup = byGroup.get(groupNumbers[index]);
    const secondGroup = byGroup.get(groupNumbers[index + 1]);
    fixtures.push(
      { phase: 'knockout', roundNumber: 1, matchNumber: fixtures.length + 1, player1Id: firstGroup[0].player_id, player2Id: secondGroup[1].player_id, status: 'pending' },
      { phase: 'knockout', roundNumber: 1, matchNumber: fixtures.length + 2, player1Id: secondGroup[0].player_id, player2Id: firstGroup[1].player_id, status: 'pending' }
    );
  }
  return fixtures;
}

export function createNextKnockoutRound(winners, roundNumber) {
  if (winners.length < 2 || winners.length % 2 !== 0) {
    throw new Error('Không đủ người thắng để tạo vòng knock-out tiếp theo.');
  }
  return Array.from({ length: winners.length / 2 }, (_, index) => ({
    phase: 'knockout',
    roundNumber,
    matchNumber: index + 1,
    player1Id: winners[index * 2],
    player2Id: winners[index * 2 + 1],
    status: 'pending',
  }));
}
