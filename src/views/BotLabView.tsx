import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  SkipForward,
  Terminal,
} from 'lucide-react';
import {
  OTTGameEngine,
  PIECE_VIET_NAMES,
  SPRINT_RULE_PRESETS,
  buildRulesFromPreset,
  type GameState,
  type ValidMove,
} from '../core/ottEngine';
import { BotRunner } from '../core/botRunner';
import { SAMPLE_BOT_LABELS, SAMPLE_BOTS, type SampleBotKey } from '../core/sampleBots';
import { soundFx } from '../core/soundFx';
import { Board9x9 } from '../components/Board9x9';
import { MascotCountsInline } from '../components/HalloweenPieces';
import { useToast } from '../components/ToastProvider';
import type { BackendUser } from '../core/backendClient';

type SandboxControllerType =
  | 'editor'
  | 'human'
  | 'phantom_hunter'
  | 'minimax'
  | 'greedy'
  | 'random';

interface BotLabViewProps {
  user: BackendUser | null;
  themeMode: 'halloween' | 'standard';
  editorCode: string;
  onEditorCodeChange: (code: string) => void;
  savedBotVersion: number;
  onSaveBotToServer: (code: string) => Promise<void>;
  onOpenAuth: (tab?: 'login' | 'register') => void;
}

interface LabLogItem {
  step: number;
  text: string;
  elapsedMs?: number;
  isError?: boolean;
}

export const BotLabView: React.FC<BotLabViewProps> = ({
  user,
  themeMode,
  editorCode,
  onEditorCodeChange,
  savedBotVersion,
  onSaveBotToServer,
  onOpenAuth,
}) => {
  const { notify } = useToast();

  // Match Sandbox Configuration
  const [p1Controller, setP1Controller] = useState<SandboxControllerType>('editor');
  const [p2Controller, setP2Controller] = useState<SandboxControllerType>('phantom_hunter');
  const [presetKey, setPresetKey] = useState<string>('standard');
  const [pieceCount, setPieceCount] = useState<number>(9);
  const [seed, setSeed] = useState<number>(20261031);
  const [delayMs, setDelayMs] = useState<number>(300);
  const [tleMs, setTleMs] = useState<number>(500);

  // Game State
  const [gameState, setGameState] = useState<GameState>(() =>
    OTTGameEngine.createGame(20261031, 9, null)
  );
  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;

  const [running, setRunning] = useState(false);
  const [loadingBots, setLoadingBots] = useState(false);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [validMoves, setValidMoves] = useState<ValidMove[]>([]);
  const [logs, setLogs] = useState<LabLogItem[]>([]);

  // Editor & Pyodide Actions
  const [checkingSyntax, setCheckingSyntax] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const [syntaxStatus, setSyntaxStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showApiGuide, setShowApiGuide] = useState(false);

  const runner1Ref = useRef<BotRunner | null>(null);
  const runner2Ref = useRef<BotRunner | null>(null);
  const steppingRef = useRef(false);

  const destroyRunners = useCallback(() => {
    runner1Ref.current?.destroy();
    runner2Ref.current?.destroy();
    runner1Ref.current = null;
    runner2Ref.current = null;
  }, []);

  useEffect(() => {
    return () => destroyRunners();
  }, [destroyRunners]);

  const resetSandbox = useCallback(
    (nextSeed = seed, nextCount = pieceCount, nextPreset = presetKey) => {
      setRunning(false);
      destroyRunners();
      const rules = buildRulesFromPreset(nextPreset, 1);
      const fresh = OTTGameEngine.createGame(nextSeed, nextCount, rules);
      stateRef.current = fresh;
      setGameState(fresh);
      setSelectedCell(null);
      setValidMoves([]);
      setLogs([]);
    },
    [destroyRunners, pieceCount, presetKey, seed]
  );

  const resolveControllerCode = useCallback(
    (ctrl: SandboxControllerType): string => {
      if (ctrl === 'editor') return editorCode;
      if (ctrl === 'human') return '';
      return SAMPLE_BOTS[ctrl as SampleBotKey] || SAMPLE_BOTS.minimax;
    },
    [editorCode]
  );

  const ensureRunnerReady = useCallback(
    async (seat: 1 | 2, ctrl: SandboxControllerType): Promise<BotRunner | null> => {
      if (ctrl === 'human') return null;
      const existing = seat === 1 ? runner1Ref.current : runner2Ref.current;
      if (existing?.ready) {
        existing.timeoutMs = tleMs;
        return existing;
      }
      const code = resolveControllerCode(ctrl);
      const runner = new BotRunner(`P${seat} (${ctrl})`, tleMs);
      await runner.loadBot(code, `P${seat} · ${ctrl}`);
      if (seat === 1) runner1Ref.current = runner;
      else runner2Ref.current = runner;
      return runner;
    },
    [resolveControllerCode, tleMs]
  );

  const executeSingleBotTurn = useCallback(async () => {
    const curr = stateRef.current;
    if (curr.winner !== null || steppingRef.current) return;
    const seat = curr.turn;
    const ctrl = seat === 1 ? p1Controller : p2Controller;
    if (ctrl === 'human') return;

    steppingRef.current = true;
    try {
      setLoadingBots(true);
      const runner = await ensureRunnerReady(seat, ctrl);
      setLoadingBots(false);
      if (!runner) return;

      const botView = OTTGameEngine.createBotGameState(curr, seat);
      const res = await runner.getMove(seat, botView);
      const next = OTTGameEngine.applyMove(curr, { from: res.from, to: res.to });
      stateRef.current = next;
      setGameState(next);

      if (next.lastMove?.isAttack) soundFx.playCapture();
      else soundFx.playMove();

      const pName = next.lastMove ? PIECE_VIET_NAMES[next.lastMove.piece] : 'Quân';
      setLogs((prev) => [
        ...prev,
        {
          step: next.stepCount,
          text: `P${seat} ${pName} ${OTTGameEngine.toAlgebraic(res.from)} → ${OTTGameEngine.toAlgebraic(
            res.to
          )}${next.lastMove?.isAttack ? ' · Ăn quân' : ''}`,
          elapsedMs: res.elapsedMs,
        },
      ]);

      if (next.winner !== null) {
        setRunning(false);
        if (next.winner === 0) {
          notify('Trận đấu kết thúc với kết quả Hòa cờ!', 'info');
        } else {
          soundFx.playVictory();
        }
      }
    } catch (err: any) {
      setLoadingBots(false);
      setRunning(false);
      // Quy chuẩn thi đấu: Bot gặp lỗi / TLE bị Xử Thua Kỹ Thuật (Forfeit), đối thủ Thắng
      const loserSeat = seat;
      const winnerSeat: 1 | 2 = loserSeat === 1 ? 2 : 1;
      const forfeitedState: GameState = {
        ...curr,
        winner: winnerSeat,
      };
      stateRef.current = forfeitedState;
      setGameState(forfeitedState);
      setLogs((prev) => [
        ...prev,
        {
          step: curr.stepCount + 1,
          text: `P${loserSeat} phạm quy (${err.message}) → P${winnerSeat} THẮNG KỸ THUẬT!`,
          isError: true,
        },
      ]);
      soundFx.playVictory();
      notify(`P${loserSeat} lỗi (${err.message}) → P${winnerSeat} Thắng Kỹ Thuật!`, 'error');
    } finally {
      steppingRef.current = false;
    }
  }, [ensureRunnerReady, notify, p1Controller, p2Controller]);

  // Continuous loop while `running === true`
  useEffect(() => {
    if (!running || gameState.winner !== null) return;
    const currentCtrl = gameState.turn === 1 ? p1Controller : p2Controller;
    if (currentCtrl === 'human') return;

    const timer = setTimeout(() => {
      executeSingleBotTurn();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [delayMs, executeSingleBotTurn, gameState, p1Controller, p2Controller, running]);

  const handleBoardClick = (idx: number) => {
    const curr = stateRef.current;
    if (curr.winner !== null) return;
    const activeCtrl = curr.turn === 1 ? p1Controller : p2Controller;
    if (activeCtrl !== 'human') return;

    if (selectedCell !== null) {
      const candidate = validMoves.find((m) => m.to === idx);
      if (candidate) {
        const next = OTTGameEngine.applyMove(curr, { from: candidate.from, to: candidate.to });
        stateRef.current = next;
        setGameState(next);
        setSelectedCell(null);
        setValidMoves([]);
        if (next.lastMove?.isAttack) soundFx.playCapture();
        else soundFx.playMove();

        const pName = next.lastMove ? PIECE_VIET_NAMES[next.lastMove.piece] : 'Quân';
        setLogs((prev) => [
          ...prev,
          {
            step: next.stepCount,
            text: `P${curr.turn} (Người) ${pName} ${OTTGameEngine.toAlgebraic(
              candidate.from
            )} → ${OTTGameEngine.toAlgebraic(candidate.to)}${
              next.lastMove?.isAttack ? ' · Ăn quân' : ''
            }`,
          },
        ]);
        if (next.winner !== null) {
          setRunning(false);
          if (next.winner === 0) {
            notify('Trận đấu kết thúc với kết quả Hòa cờ!', 'info');
          } else {
            soundFx.playVictory();
          }
        }
        return;
      }
    }

    const piece = curr.board[idx];
    const owner = piece ? (piece <= 3 ? 1 : 2) : null;
    if (owner === curr.turn) {
      soundFx.playSelect();
      setSelectedCell(idx);
      setValidMoves(OTTGameEngine.getValidMoves(curr, idx));
    } else {
      setSelectedCell(null);
      setValidMoves([]);
    }
  };

  const handleCheckSyntax = async () => {
    setCheckingSyntax(true);
    setSyntaxStatus(null);
    const res = await BotRunner.checkSyntax(editorCode);
    setCheckingSyntax(false);
    if (res.ok) {
      setSyntaxStatus({
        ok: true,
        msg: 'Cú pháp Python 3 hợp lệ và đã khai báo hàm get_next_move sẵn sàng thi đấu.',
      });
      notify('Kiểm tra cú pháp Python thành công!', 'success');
    } else {
      setSyntaxStatus({ ok: false, msg: res.error || 'Mã Python không hợp lệ.' });
      notify(res.error || 'Phát hiện lỗi trong mã Python.', 'error');
    }
  };

  const handleSaveServer = async () => {
    if (!user) {
      onOpenAuth('login');
      return;
    }
    setSavingServer(true);
    try {
      await onSaveBotToServer(editorCode);
      if (p1Controller === 'editor') {
        runner1Ref.current?.destroy();
        runner1Ref.current = null;
      }
      if (p2Controller === 'editor') {
        runner2Ref.current?.destroy();
        runner2Ref.current = null;
      }
    } finally {
      setSavingServer(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const updated = editorCode.substring(0, start) + '    ' + editorCode.substring(end);
      onEditorCodeChange(updated);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 4;
      });
    }
  };

  const counts = OTTGameEngine.countPieces(gameState.board);
  const isHumanTurnNow =
    gameState.winner === null &&
    ((gameState.turn === 1 && p1Controller === 'human') ||
      (gameState.turn === 2 && p2Controller === 'human'));

  return (
    <div className="space-y-6">
      {/* Split 50/50 Lab Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: 9x9 Sandbox Simulator */}
        <div className="xl:col-span-6 p-5 sm:p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                Bàn Thử Nghiệm Chiến Thuật 9×9
              </h2>
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                Seed {seed} · {pieceCount} quân mỗi bên · Lượt #{gameState.stepCount}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loadingBots || gameState.winner !== null}
                onClick={() => {
                  if (!running) {
                    if (p1Controller === 'editor') {
                      runner1Ref.current?.destroy();
                      runner1Ref.current = null;
                    }
                    if (p2Controller === 'editor') {
                      runner2Ref.current?.destroy();
                      runner2Ref.current = null;
                    }
                  }
                  setRunning((r) => !r);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {loadingBots ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Nạp Pyodide…
                  </>
                ) : running ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Tạm dừng
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Chạy thử
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={running || loadingBots || gameState.winner !== null || isHumanTurnNow}
                onClick={executeSingleBotTurn}
                title="Chạy từng bước 1 nước của Bot"
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <SkipForward className="w-3.5 h-3.5" />
                1 Bước
              </button>

              <button
                type="button"
                onClick={() => resetSandbox()}
                title="Đặt lại bàn cờ về lượt 0"
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Đặt lại
              </button>
            </div>
          </div>

          {/* Player 1 & Player 2 Controller Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                <span className="font-bold text-[var(--p1-main)]">Phe 1 (Cam)</span>
                <MascotCountsInline counts={counts[1]} team={1} compact />
              </div>
              <select
                value={p1Controller}
                onChange={(e) => {
                  const v = e.target.value as SandboxControllerType;
                  setP1Controller(v);
                  runner1Ref.current?.destroy();
                  runner1Ref.current = null;
                }}
                aria-label="Chọn điều khiển Phe 1"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              >
                <option value="editor">Code đang soạn trong Editor</option>
                <option value="human">Người tự cầm quân (Click chuột)</option>
                <option value="phantom_hunter">Bot mẫu · Phantom Hunter (Halloween)</option>
                <option value="minimax">Bot mẫu · Minimax Tactical</option>
                <option value="greedy">Bot mẫu · Greedy AI</option>
                <option value="random">Bot mẫu · Random Bot</option>
              </select>
            </div>

            <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                <span className="font-bold text-[var(--p2-main)]">Phe 2 (Tím)</span>
                <MascotCountsInline counts={counts[2]} team={2} compact />
              </div>
              <select
                value={p2Controller}
                onChange={(e) => {
                  const v = e.target.value as SandboxControllerType;
                  setP2Controller(v);
                  runner2Ref.current?.destroy();
                  runner2Ref.current = null;
                }}
                aria-label="Chọn điều khiển Phe 2"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              >
                <option value="phantom_hunter">Bot mẫu · Phantom Hunter (Halloween)</option>
                <option value="minimax">Bot mẫu · Minimax Tactical</option>
                <option value="greedy">Bot mẫu · Greedy AI</option>
                <option value="random">Bot mẫu · Random Bot</option>
                <option value="editor">Code đang soạn trong Editor</option>
                <option value="human">Người tự cầm quân (Click chuột)</option>
              </select>
            </div>
          </div>

          {/* Sandbox Parameters Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">Địa hình Sprint</label>
              <select
                value={presetKey}
                onChange={(e) => {
                  const nextPreset = e.target.value;
                  setPresetKey(nextPreset);
                  resetSandbox(seed, pieceCount, nextPreset);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              >
                {Object.values(SPRINT_RULE_PRESETS).map((p) => (\n                  <option key={p.id} value={p.id}>\n                    {p.title}\n                  </option>\n                ))}\n              </select>\n            </div>\n\n            <div>\n              <label className=\"block text-[11px] text-[var(--text-muted)] mb-1\">Số quân / phe (Bội số 3)</label>\n              <select\n                value={pieceCount}\n                onChange={(e) => {\n                  const nextCount = Number(e.target.value);\n                  setPieceCount(nextCount);\n                  resetSandbox(seed, nextCount, presetKey);\n                }}\n                className=\"w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono\"\n              >\n                {[6, 9, 12, 15, 18].map((n) => (\n                  <option key={n} value={n}>\n                    {n} quân ({n / 3} Đấm, {n / 3} Lá, {n / 3} Kéo)\n                  </option>\n                ))}\n              </select>\n            </div>\n\n            <div>\n              <label className=\"block text-[11px] text-[var(--text-muted)] mb-1\">Nhịp độ chạy</label>\n              <select\n                value={delayMs}\n                onChange={(e) => setDelayMs(Number(e.target.value))}\n                className=\"w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono\"\n              >\n                <option value={80}>Nhanh (80ms)</option>\n                <option value={300}>Vừa (300ms)</option>\n                <option value={650}>Chậm (650ms)</option>\n              </select>\n            </div>\n\n            <div>\n              <label className=\"block text-[11px] text-[var(--text-muted)] mb-1\">Giới hạn TLE</label>\n              <select\n                value={tleMs}\n                onChange={(e) => setTleMs(Number(e.target.value))}\n                className=\"w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono\"\n              >\n                <option value={200}>200 ms (Chuẩn giải)</option>\n                <option value={500}>500 ms</option>\n                <option value={1500}>1500 ms (Debug)</option>\n              </select>\n            </div>\n          </div>\n\n          {/* Status Strip + Random Seed */}\n          <div className=\"flex items-center justify-between px-3.5 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs\">\n            <span className=\"font-medium text-[var(--text-primary)]\">\n              {gameState.winner === 0\n                ? `Hòa cờ sau ${gameState.stepCount} nước (Stalemate / Chạm giới hạn ${180} bước)!`\n                : gameState.winner !== null\n                ? `Kết thúc: Phe ${gameState.winner} chiến thắng sau ${gameState.stepCount} nước!`\n                : isHumanTurnNow\n                ? `Lượt Phe ${gameState.turn} (Bạn) — Chọn quân cờ trên bàn để đi`\n                : running\n                ? `Đang mô phỏng lượt Phe ${gameState.turn}…`\n                : `Sẵn sàng tại lượt Phe ${gameState.turn}`}\n            </span>\n            <button\n              type=\"button\"\n              onClick={() => {\n                const randomSeed = Math.floor(100000 + Math.random() * 8999999);\n                setSeed(randomSeed);\n                resetSandbox(randomSeed, pieceCount, presetKey);\n              }}\n              className=\"inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline cursor-pointer whitespace-nowrap\"\n            >\n              <Shuffle className=\"w-3.5 h-3.5\" />\n              Đổi Seed mới\n            </button>\n          </div>\n\n          {/* 9x9 Board */}\n          <Board9x9\n            state={gameState}\n            selectedCell={selectedCell}\n            validMoves={validMoves}\n            onCellClick={handleBoardClick}\n            interactive={isHumanTurnNow}\n            size=\"normal\"\n            themeMode={themeMode}\n          />\n\n          {/* Compact Move & TLE Log */}\n          <div className=\"rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3\">\n            <div className=\"flex items-center justify-between text-xs text-[var(--text-secondary)] mb-2\">\n              <span className=\"font-semibold text-[var(--text-primary)]\">Nhật ký thực thi & thời gian phản hồi</span>\n              <span className=\"font-mono tabular-nums\">{logs.length} nước</span>\n            </div>\n            <div className=\"h-28 overflow-y-auto space-y-1 pr-1 font-mono text-xs tabular-nums\">\n              {logs.length === 0 ? (\n                <div className=\"text-[var(--text-muted)] py-6 text-center\">\n                  Bấm \"Chạy thử\" hoặc \"1 Bước\" để kiểm tra tốc độ phản hồi của thuật toán.\n                </div>\n              ) : (\n                logs.slice(-30).map((item, i) => (\n                  <div\n                    key={`${item.step}-${i}`}\n                    className={`flex items-center justify-between px-2 py-1 rounded ${\n                      item.isError ? 'bg-red-500/15 text-red-300' : 'text-[var(--text-secondary)]'\n                    }`}\n                  >\n                    <span>\n                      #{String(item.step).padStart(2, '0')} {item.text}\n                    </span>\n                    {item.elapsedMs !== undefined && (\n                      <span className=\"text-[var(--text-muted)]\">{item.elapsedMs}ms</span>\n                    )}\n                  </div>\n                ))\n              )}\n            </div>\n          </div>\n        </div>\n\n        {/* RIGHT COLUMN: Python 3 Code Editor & Bot API Docs */}\n        <div className=\"xl:col-span-6 p-5 sm:p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4\">\n          <div className=\"flex flex-wrap items-center justify-between gap-3\">\n            <div>\n              <h2 className=\"text-lg font-bold text-[var(--text-primary)] flex items-center gap-2\">\n                <Terminal className=\"w-5 h-5 text-[var(--accent-primary)]\" />\n                Trình Soạn Thảo Bot Python 3\n              </h2>\n              <p className=\"text-xs text-[var(--text-secondary)] mt-0.5 tabular-nums\">\n                Chạy cô lập trong Web Worker Pyodide ·{' '}\n                {savedBotVersion > 0\n                  ? `Đang lưu bản v${savedBotVersion} trên tài khoản`\n                  : 'Chưa lưu lên tài khoản'}\n              </p>\n            </div>\n\n            <div className=\"flex items-center gap-2\">\n              <select\n                defaultValue=\"\"\n                onChange={(e) => {\n                  const key = e.target.value as SampleBotKey;\n                  if (!key) return;\n                  onEditorCodeChange(SAMPLE_BOTS[key]);\n                  setSyntaxStatus(null);\n                  notify(`Đã nạp mẫu \"${SAMPLE_BOT_LABELS[key].name}\" vào trình soạn thảo.`, 'info');\n                  e.target.value = '';\n                }}\n                aria-label=\"Nạp mẫu thuật toán Python\"\n                className=\"px-3 py-2 text-xs rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]\"\n              >\n                <option value=\"\" disabled>\n                  Nạp Bot mẫu…\n                </option>\n                {(Object.keys(SAMPLE_BOT_LABELS) as SampleBotKey[]).map((k) => (\n                  <option key={k} value={k}>\n                    {SAMPLE_BOT_LABELS[k].name} ({SAMPLE_BOT_LABELS[k].difficulty})\n                  </option>\n                ))}\n              </select>\n            </div>\n          </div>\n\n          {/* Code Editor Textarea */}\n          <div className=\"relative rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[#09080f]\">\n            <div className=\"flex items-center justify-between px-3.5 py-2 border-b border-white/[0.06] text-[11px] font-mono text-[var(--text-muted)]\">\n              <span>bot.py · def get_next_move(my_player_id, game_state)</span>\n              <span>{editorCode.split('\\n').length} dòng</span>\n            </div>\n            <textarea\n              value={editorCode}\n              onChange={(e) => {\n                onEditorCodeChange(e.target.value);\n                if (syntaxStatus) setSyntaxStatus(null);\n              }}\n              onKeyDown={handleTextareaKeyDown}\n              spellCheck={false}\n              rows={20}\n              aria-label=\"Mã nguồn Python 3 của Bot\"\n              className=\"code-editor w-full p-4 bg-transparent text-xs sm:text-[13px] leading-relaxed text-emerald-100 focus:outline-none resize-y min-h-[380px]\"\n            />\n          </div>\n\n          {/* Syntax feedback */}\n          {syntaxStatus && (\n            <div\n              className={`p-3 rounded-xl border text-xs ${\n                syntaxStatus.ok\n                  ? 'border-emerald-500/35 bg-emerald-950/25 text-emerald-300'\n                  : 'border-red-500/35 bg-red-950/25 text-red-300'\n              }`}\n            >\n              {syntaxStatus.msg}\n            </div>\n          )}\n\n          {/* Action Buttons */}\n          <div className=\"flex flex-wrap items-center justify-between gap-3\">\n            <button\n              type=\"button\"\n              disabled={checkingSyntax}\n              onClick={handleCheckSyntax}\n              className=\"inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0\"\n            >\n              {checkingSyntax ? (\n                <Loader2 className=\"w-4 h-4 animate-spin\" />\n              ) : (\n                <CheckCircle2 className=\"w-4 h-4 text-emerald-400\" />\n              )}\n              Kiểm tra cú pháp Python\n            </button>\n\n            <button\n              type=\"button\"\n              disabled={savingServer}\n              onClick={handleSaveServer}\n              className=\"inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0\"\n            >\n              {savingServer ? (\n                <Loader2 className=\"w-4 h-4 animate-spin\" />\n              ) : (\n                <CloudUpload className=\"w-4 h-4\" />\n              )}\n              {user ? 'Lưu Bot lên Tài khoản' : 'Đăng nhập để Lưu Bot'}\n            </button>\n          </div>\n\n          {/* Collapsible Bot API Reference */}\n          <div className=\"rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] overflow-hidden\">\n            <button\n              type=\"button\"\n              onClick={() => setShowApiGuide((s) => !s)}\n              className=\"w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/40 transition-colors cursor-pointer\"\n            >\n              <span className=\"inline-flex items-center gap-2\">\n                <BookOpen className=\"w-4 h-4 text-[var(--accent-primary)]\" />\n                Tài liệu cấu trúc tham số game_state cho Python Bot\n              </span>\n              {showApiGuide ? <ChevronUp className=\"w-4 h-4\" /> : <ChevronDown className=\"w-4 h-4\" />}\n            </button>\n\n            {showApiGuide && (\n              <div className=\"px-4 pb-4 pt-1 border-t border-[var(--border-subtle)] space-y-2.5 text-xs text-[var(--text-secondary)]\">\n                <p>\n                  Hàm bắt buộc:{' '}\n                  <code className=\"text-[var(--text-primary)]\">\n                    def get_next_move(my_player_id, game_state):\n                  </code>\n                </p>\n                <ul className=\"space-y-1.5 list-disc pl-4\">\n                  <li>\n                    <code className=\"text-[var(--text-primary)]\">game_state['validMoves']</code>: Danh sách mọi nước đi hợp lệ trong lượt hiện tại. Mỗi phần tử gồm{' '}\n                    <code>fromRow, fromCol, toRow, toCol, from, to, isAttack, pieceType, targetType</code>.\n                  </li>\n                  <li>\n                    <code className=\"text-[var(--text-primary)]\">game_state['myPieces']</code> &{' '}\n                    <code className=\"text-[var(--text-primary)]\">game_state['opponentPieces']</code>: Danh sách tọa độ quân còn trên bàn (<code>row, col, index, type</code> với <code>type</code> là <code>'rock' | 'paper' | 'scissors'</code>).\n                  </li>\n                  <li>\n                    <code className=\"text-[var(--text-primary)]\">game_state['opponentPieceCounts']</code>: Số lượng từng hệ quân đối phương còn lại (<code>{'{ rock, paper, scissors, total }'}</code>). Đưa bất kỳ hệ nào về <code>0</code> sẽ thắng ngay!\n                  </li>\n                  <li>\n                    <code className=\"text-[var(--text-primary)]\">game_state['specialCells']</code>: Ô căn cứ <code>a1 (72)</code> và <code>i9 (8)</code>. Đối với Phe 1, chiếm cứ điểm <code>i9</code> để thắng ngay; đối với Phe 2, chiếm cứ điểm <code>a1</code> để thắng ngay.\n                  </li>\n                  <li>\n                    <code className=\"text-[var(--text-primary)]\">game_state['blockedCells']</code>: Mảng các chỉ số ô bị khóa trong giải đấu theo Sprint (ví dụ <code>[30, 31, 32, ...]</code>).\n                  </li>\n                  <li>\n                    Giá trị trả về hợp lệ: dictionary <code>{\"{'fromRow': r1, 'fromCol': c1, 'toRow': r2, 'toCol': c2}\"}</code> hoặc <code>{\"{'from': idx1, 'to': idx2}\"}</code>.\n                  </li>\n                </ul>\n              </div>\n            )}\n          </div>\n        </div>\n      </div>\n    </div>\n  );\n};\n