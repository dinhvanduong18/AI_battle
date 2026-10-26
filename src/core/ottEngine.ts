/**
 * Deterministic 9x9 Tactical Rock-Paper-Scissors Engine (OTTv2)
 * Bit-for-bit compatible with /shared/OTTGameEngine.js and server replay verification.
 */

export const COLS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
export const ROWS = 9;
export const TOTAL_CELLS = 81;

export const SPECIAL_A1_INDEX = 72; // row 8, col 0 (P2 target / bottom-left shrine)
export const SPECIAL_I9_INDEX = 8;  // row 0, col 8 (P1 target / top-right shrine)

export const PIECE = {
  EMPTY: 0,
  P1_ROCK: 1,
  P1_PAPER: 2,
  P1_SCISSORS: 3,
  P2_ROCK: 4,
  P2_PAPER: 5,
  P2_SCISSORS: 6,
} as const;

export type PieceTypeName = 'rock' | 'paper' | 'scissors';

export const PIECE_TYPE_NAMES: Record<number, PieceTypeName> = {
  1: 'rock',
  2: 'paper',
  3: 'scissors',
  4: 'rock',
  5: 'paper',
  6: 'scissors',
};

export const PIECE_VIET_NAMES: Record<number, string> = {
  1: 'Bí Ngô (Đấm)',
  2: 'Bé Ma (Lá)',
  3: 'Dơi (Kéo)',
  4: 'Bí Ngô (Đấm)',
  5: 'Bé Ma (Lá)',
  6: 'Dơi (Kéo)',
};

export const PIECE_COUNTER_HINTS: Record<PieceTypeName, string> = {
  rock: 'Ăn Dơi (Kéo) · Thua Bé Ma (Lá)',
  paper: 'Ăn Bí Ngô (Đấm) · Thua Dơi (Kéo)',
  scissors: 'Ăn Bé Ma (Lá) · Thua Bí Ngô (Đấm)',
};

export interface BoardRules {
  id: string;
  title: string;
  week: number;
  rows: number;
  cols: number;
  blockedCells: number[];
}

export const SPRINT_RULE_PRESETS: Record<string, { id: string; title: string; subtitle: string; blockedCells: number[] }> = {
  standard: {
    id: 'standard',
    title: 'Bàn chuẩn',
    subtitle: '81 ô mở hoàn toàn, giao tranh trực diện',
    blockedCells: [],
  },
  center_blockers: {
    id: 'center_blockers',
    title: 'Chướng ngại trung tâm',
    subtitle: 'Khóa vùng tâm 3×3 (d6–f4), buộc đánh hai cánh',
    blockedCells: [30, 31, 32, 39, 40, 41, 48, 49, 50],
  },
  clipped_corners: {
    id: 'clipped_corners',
    title: 'Bàn vát góc',
    subtitle: 'Phong ấn 2 góc phụ a9–b8 và h2–i1',
    blockedCells: [0, 1, 9, 10, 70, 71, 79, 80],
  },
  corridor: {
    id: 'corridor',
    title: 'Hành lang vật cản',
    subtitle: '7 cột đá xen kẽ chia cắt trục giữa bàn cờ',
    blockedCells: [22, 24, 38, 40, 42, 56, 58],
  },
};

export function buildRulesFromPreset(presetKey: string, week = 1): BoardRules | null {
  if (!presetKey || presetKey === 'standard') {
    return null;
  }
  const preset = SPRINT_RULE_PRESETS[presetKey];
  if (!preset) return null;
  return {
    id: `sprint-${week}-${preset.id}`,
    title: preset.title,
    week,
    rows: 9,
    cols: 9,
    blockedCells: [...preset.blockedCells],
  };
}

export interface LastMoveInfo {
  from: number;
  to: number;
  isAttack: boolean;
  piece: number;
  captured: number | null;
}

export type DrawReason = 'threefold-repetition' | 'fifty-move-rule' | 'stalemate';

export interface GameState {
  seed: number;
  pieceCount: number;
  board: Int8Array;
  turn: 1 | 2;
  stepCount: number;
  winner: 0 | 1 | 2 | null;
  drawReason?: DrawReason | null;
  noCapturePlies?: number;
  positionCounts?: Record<string, number>;
  lastMove: LastMoveInfo | null;
  rules: BoardRules | null;
}

export function isGameOver(state: Pick<GameState, 'winner'> | null | undefined): boolean {
  if (!state) return false;
  return state.winner === 0 || state.winner === 1 || state.winner === 2;
}

function computePositionKey(board: Int8Array, turn: 1 | 2): string {
  return `${turn}:${Array.from(board).join(',')}`;
}

export interface ValidMove {
  from: number;
  to: number;
  isAttack: boolean;
}

const DIRECTIONS: ReadonlyArray<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function mulberry32(seed: number) {
  let s = seed >>> 0 || 1;
  return function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function computeFastHash(state: GameState): string {
  let hash = 0x811c9dc5;
  const board = state.board;
  for (let i = 0; i < TOTAL_CELLS; i++) {
    hash ^= board[i];
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= state.turn & 0xff;
  hash = Math.imul(hash, 0x01000193);
  hash ^= state.stepCount & 0xffff;
  hash = Math.imul(hash, 0x01000193);
  const winnerCode = state.winner === 0 ? 3 : state.winner || 0;
  hash ^= winnerCode & 0xff;
  hash = Math.imul(hash, 0x01000193);
  if (state.rules) {
    const rules = state.rules;
    const ruleKey = `${rules.id || ''}|${rules.week || 0}|${(rules.blockedCells || []).join(',')}`;
    for (let i = 0; i < ruleKey.length; i++) {
      hash ^= ruleKey.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class OTTGameEngine {
  static isGameOver(state: Pick<GameState, 'winner'> | null | undefined): boolean {
    return isGameOver(state);
  }

  static computeFastHash(state: GameState): string {
    return computeFastHash(state);
  }

  static createInitialState(seed = 1234567, pieceCountPerSide = 9, rules: Partial<BoardRules> | null = null): GameState {
    return this.createGame(seed, pieceCountPerSide, rules);
  }

  static createGame(seed = 1234567, pieceCountPerSide = 9, rules: Partial<BoardRules> | null = null): GameState {
    const count = Math.max(3, Math.min(36, Math.floor(pieceCountPerSide || 9)));
    const board = new Int8Array(TOTAL_CELLS);
    const rng = mulberry32(seed);

    const normalizedRules: BoardRules | null = rules
      ? {
          id: String(rules.id || 'weekly'),
          title: String(rules.title || 'Luật tuần'),
          week: Number(rules.week) || 1,
          rows: Number(rules.rows) || ROWS,
          cols: Number(rules.cols) || 9,
          blockedCells: [
            ...new Set(
              (rules.blockedCells || []).filter(
                (idx) => Number.isInteger(idx) && idx >= 0 && idx < TOTAL_CELLS
              )
            ),
          ].sort((a, b) => a - b),
        }
      : null;

    const blocked = new Set(normalizedRules?.blockedCells || []);
    if (blocked.has(SPECIAL_A1_INDEX) || blocked.has(SPECIAL_I9_INDEX)) {
      throw new Error('Luật tuần không được chặn hai ô mục tiêu chiến thắng.');
    }

    const p1Indices: number[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (r > c && !blocked.has(r * 9 + c) && !blocked.has(c * 9 + r)) {
          p1Indices.push(r * 9 + c);
        }
      }
    }

    const actualCount = Math.min(count, p1Indices.length);
    if (actualCount < 3) throw new Error('Bộ luật tuần chặn quá nhiều ô khởi đầu.');

    const piecePool: number[] = [];
    for (let i = 0; i < actualCount; i++) {
      piecePool.push((i % 3) + 1);
    }

    const shuffledIndices = seededShuffle(p1Indices, rng).slice(0, actualCount);
    const shuffledPieces = seededShuffle(piecePool, rng);

    for (let i = 0; i < actualCount; i++) {
      const p1Idx = shuffledIndices[i];
      const r = Math.floor(p1Idx / 9);
      const c = p1Idx % 9;
      const pType = shuffledPieces[i];
      board[p1Idx] = pType;
      board[c * 9 + r] = pType + 3;
    }

    const initialPosKey = computePositionKey(board, 1);

    return {
      seed,
      pieceCount: actualCount,
      board,
      turn: 1,
      stepCount: 0,
      winner: null,
      drawReason: null,
      noCapturePlies: 0,
      positionCounts: { [initialPosKey]: 1 },
      lastMove: null,
      rules: normalizedRules,
    };
  }

  static canCapture(attackerPiece: number, defenderPiece: number): boolean {
    if (!attackerPiece || !defenderPiece) return false;
    const aPlayer = attackerPiece <= 3 ? 1 : 2;
    const dPlayer = defenderPiece <= 3 ? 1 : 2;
    if (aPlayer === dPlayer) return false;
    const aType = attackerPiece <= 3 ? attackerPiece : attackerPiece - 3;
    const dType = defenderPiece <= 3 ? defenderPiece : defenderPiece - 3;
    if (aType === dType) return false;
    return (
      (aType === 1 && dType === 3) || // Rock beats Scissors
      (aType === 3 && dType === 2) || // Scissors beats Paper
      (aType === 2 && dType === 1)    // Paper beats Rock
    );
  }

  static getValidMoves(state: GameState, fromIndex: number): ValidMove[] {
    if (isGameOver(state)) return [];
    if (fromIndex < 0 || fromIndex >= TOTAL_CELLS) return [];
    const blocked = new Set(state.rules?.blockedCells || []);
    if (blocked.has(fromIndex)) return [];

    const piece = state.board[fromIndex];
    if (!piece) return [];
    const piecePlayer = piece <= 3 ? 1 : 2;
    if (piecePlayer !== state.turn) return [];

    const r = Math.floor(fromIndex / 9);
    const c = fromIndex % 9;
    const valid: ValidMove[] = [];

    for (const [dr, dc] of DIRECTIONS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= 9 || nc < 0 || nc >= 9) continue;
      const toIndex = nr * 9 + nc;
      if (blocked.has(toIndex)) continue;
      const target = state.board[toIndex];
      if (target === PIECE.EMPTY) {
        valid.push({ from: fromIndex, to: toIndex, isAttack: false });
      } else {
        const targetPlayer = target <= 3 ? 1 : 2;
        if (targetPlayer !== piecePlayer && this.canCapture(piece, target)) {
          valid.push({ from: fromIndex, to: toIndex, isAttack: true });
        }
      }
    }
    return valid;
  }

  static getAllValidMoves(state: GameState): ValidMove[] {
    if (isGameOver(state)) return [];
    const allMoves: ValidMove[] = [];
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const piece = state.board[i];
      if (piece) {
        const player = piece <= 3 ? 1 : 2;
        if (player === state.turn) {
          allMoves.push(...this.getValidMoves(state, i));
        }
      }
    }
    return allMoves;
  }

  static checkWinCondition(board: Int8Array, lastMove: LastMoveInfo | null, movingPlayer: 1 | 2): 1 | 2 | null {
    if (lastMove && (lastMove.to === SPECIAL_A1_INDEX || lastMove.to === SPECIAL_I9_INDEX)) {
      return movingPlayer;
    }
    const opponent = movingPlayer === 1 ? 2 : 1;
    let oppRock = 0;
    let oppPaper = 0;
    let oppScissors = 0;
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const p = board[i];
      if (!p) continue;
      const owner = p <= 3 ? 1 : 2;
      if (owner === opponent) {
        const type = p <= 3 ? p : p - 3;
        if (type === 1) oppRock++;
        else if (type === 2) oppPaper++;
        else if (type === 3) oppScissors++;
      }
    }
    if (oppRock === 0 || oppPaper === 0 || oppScissors === 0) {
      return movingPlayer;
    }
    return null;
  }

  static applyMove(state: GameState, move: { from: number; to: number }): GameState {
    if (isGameOver(state)) throw new Error('Ván đấu đã kết thúc.');
    if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to)) {
      throw new Error('Nước đi không hợp lệ.');
    }
    const piece = state.board[move.from];
    if (!piece) throw new Error(`Không có quân cờ tại ô ${move.from}`);
    const piecePlayer = piece <= 3 ? 1 : 2;
    if (piecePlayer !== state.turn) {
      throw new Error(`Chưa tới lượt của Player ${piecePlayer}`);
    }
    const legal = this.getValidMoves(state, move.from).some((m) => m.to === move.to);
    if (!legal) {
      throw new Error(`Nước đi từ ${this.toAlgebraic(move.from)} tới ${this.toAlgebraic(move.to)} không hợp lệ.`);
    }
    const captured = state.board[move.to];
    const isAttack = captured !== PIECE.EMPTY;
    if (isAttack && !this.canCapture(piece, captured)) {
      throw new Error('Không thể ăn quân cùng hệ hoặc khắc hệ.');
    }

    const nextBoard = new Int8Array(state.board);
    nextBoard[move.to] = piece;
    nextBoard[move.from] = PIECE.EMPTY;
    const nextStepCount = state.stepCount + 1;
    const lastMoveInfo: LastMoveInfo = {
      from: move.from,
      to: move.to,
      isAttack,
      piece,
      captured: captured || null,
    };
    let winner: 0 | 1 | 2 | null = this.checkWinCondition(nextBoard, lastMoveInfo, state.turn);
    let drawReason: DrawReason | null = null;
    const nextTurn: 1 | 2 = winner ? state.turn : state.turn === 1 ? 2 : 1;
    const nextNoCapturePlies = isAttack ? 0 : (state.noCapturePlies || 0) + 1;
    const nextPositionCounts: Record<string, number> = { ...(state.positionCounts || {}) };

    if (winner === null) {
      const posKey = computePositionKey(nextBoard, nextTurn);
      const seenCount = (nextPositionCounts[posKey] || 0) + 1;
      nextPositionCounts[posKey] = seenCount;

      const nextCandidate: GameState = {
        seed: state.seed,
        pieceCount: state.pieceCount,
        board: nextBoard,
        turn: nextTurn,
        stepCount: nextStepCount,
        winner: null,
        lastMove: lastMoveInfo,
        rules: state.rules || null,
      };

      if (this.getAllValidMoves(nextCandidate).length === 0) {
        winner = 0;
        drawReason = 'stalemate';
      } else if (seenCount >= 3) {
        winner = 0;
        drawReason = 'threefold-repetition';
      } else if (nextNoCapturePlies >= 100) {
        winner = 0;
        drawReason = 'fifty-move-rule';
      }
    }

    return {
      seed: state.seed,
      pieceCount: state.pieceCount,
      board: nextBoard,
      turn: nextTurn,
      stepCount: nextStepCount,
      winner,
      drawReason,
      noCapturePlies: nextNoCapturePlies,
      positionCounts: nextPositionCounts,
      lastMove: lastMoveInfo,
      rules: state.rules || null,
    };
  }

  static countPieces(board: Int8Array) {
    const counts = {
      1: { rock: 0, paper: 0, scissors: 0, total: 0 },
      2: { rock: 0, paper: 0, scissors: 0, total: 0 },
    };
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const p = board[i];
      if (!p) continue;
      const owner: 1 | 2 = p <= 3 ? 1 : 2;
      const typeName = PIECE_TYPE_NAMES[p];
      counts[owner][typeName]++;
      counts[owner].total++;
    }
    return counts;
  }

  static toAlgebraic(index: number): string {
    const col = COLS[index % 9];
    const row = 9 - Math.floor(index / 9);
    return `${col}${row}`;
  }

  static serialize(state: GameState) {
    return {
      seed: state.seed,
      pieceCount: state.pieceCount,
      board: Array.from(state.board),
      turn: state.turn,
      stepCount: state.stepCount,
      winner: state.winner === 0 ? 0 : state.winner || null,
      drawReason: state.drawReason || null,
      noCapturePlies: state.noCapturePlies || 0,
      positionCounts: state.positionCounts ? { ...state.positionCounts } : undefined,
      lastMove: state.lastMove,
      rules: state.rules || null,
      hash: computeFastHash(state),
    };
  }

  static deserialize(obj: any): GameState {
    const board = new Int8Array(obj.board);
    const turn: 1 | 2 = obj.turn === 2 ? 2 : 1;
    const initialPosKey = computePositionKey(board, turn);
    return {
      seed: obj.seed,
      pieceCount: obj.pieceCount,
      board,
      turn,
      stepCount: obj.stepCount || 0,
      winner: obj.winner === 0 ? 0 : obj.winner || null,
      drawReason: obj.drawReason || null,
      noCapturePlies: Number(obj.noCapturePlies) || 0,
      positionCounts: obj.positionCounts ? { ...obj.positionCounts } : { [initialPosKey]: 1 },
      lastMove: obj.lastMove || null,
      rules: obj.rules || null,
    };
  }

  static createBotGameState(state: GameState, myPlayerId?: 1 | 2) {
    const myId: 1 | 2 = myPlayerId || state.turn;
    const oppId: 1 | 2 = myId === 1 ? 2 : 1;
    const blockedArr = state.rules?.blockedCells || [];
    const blockedSet = new Set(blockedArr);

    const board2D = [];
    for (let r = 0; r < 9; r++) {
      const row = [];
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        const val = state.board[idx];
        const player = val ? (val <= 3 ? 1 : 2) : null;
        const type = val ? PIECE_TYPE_NAMES[val] : null;
        row.push({
          row: r,
          col: c,
          index: idx,
          isBlocked: blockedSet.has(idx),
          player,
          type,
          value: val,
          isMyPiece: player === myId,
          isOpponentPiece: player === oppId,
        });
      }
      board2D.push(row);
    }

    const myPieces = [];
    const opponentPieces = [];
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const val = state.board[i];
      if (!val) continue;
      const player = val <= 3 ? 1 : 2;
      const item = {
        row: Math.floor(i / 9),
        col: i % 9,
        index: i,
        algebraic: this.toAlgebraic(i),
        player,
        type: PIECE_TYPE_NAMES[val],
        raw: val,
      };
      if (player === myId) myPieces.push(item);
      else opponentPieces.push(item);
    }

    const rawMoves = this.getAllValidMoves(state);
    const validMoves = rawMoves.map((m) => {
      const pVal = state.board[m.from];
      const tVal = state.board[m.to];
      return {
        from: m.from,
        to: m.to,
        fromRow: Math.floor(m.from / 9),
        fromCol: m.from % 9,
        toRow: Math.floor(m.to / 9),
        toCol: m.to % 9,
        fromAlg: this.toAlgebraic(m.from),
        toAlg: this.toAlgebraic(m.to),
        isAttack: m.isAttack,
        isCapture: m.isAttack,
        pieceType: PIECE_TYPE_NAMES[pVal],
        targetType: tVal ? PIECE_TYPE_NAMES[tVal] : null,
      };
    });

    const counts = this.countPieces(state.board);

    return {
      board: board2D,
      flatBoard: Array.from(state.board),
      validMoves,
      myPieces,
      opponentPieces,
      turn: state.turn,
      stepCount: state.stepCount,
      boardRows: 9,
      boardCols: 9,
      myPlayerId: myId,
      opponentPlayerId: oppId,
      myPieceCounts: counts[myId],
      opponentPieceCounts: counts[oppId],
      specialCells: {
        a1: SPECIAL_A1_INDEX,
        i9: SPECIAL_I9_INDEX,
        myWinIndex: myId === 1 ? SPECIAL_A1_INDEX : SPECIAL_I9_INDEX,
        opponentWinIndex: oppId === 1 ? SPECIAL_A1_INDEX : SPECIAL_I9_INDEX,
      },
      rules: state.rules || null,
      blockedCells: blockedArr,
    };
  }
}
