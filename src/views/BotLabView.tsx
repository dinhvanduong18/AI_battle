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
    if (OTTGameEngine.isGameOver(curr) || steppingRef.current) return;
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

      if (OTTGameEngine.isGameOver(next)) {
        setRunning(false);
        if (next.winner) soundFx.playVictory();
      }
    } catch (err: any) {
      setLoadingBots(false);
      setRunning(false);
      setLogs((prev) => [
        ...prev,
        {
          step: curr.stepCount + 1,
          text: `P${seat} lỗi/TLE: ${err.message}`,
          isError: true,
        },
      ]);
      notify(err.message || 'Bot gặp lỗi khi tính nước đi.', 'error');
    } finally {
      steppingRef.current = false;
    }
  }, [ensureRunnerReady, notify, p1Controller, p2Controller]);

  // Continuous loop while `running === true`
  useEffect(() => {
    if (!running || OTTGameEngine.isGameOver(gameState)) return;
    const currentCtrl = gameState.turn === 1 ? p1Controller : p2Controller;
    if (currentCtrl === 'human') return;

    const timer = setTimeout(() => {
      executeSingleBotTurn();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [delayMs, executeSingleBotTurn, gameState, p1Controller, p2Controller, running]);

  const handleBoardClick = (idx: number) => {
    const curr = stateRef.current;
    if (OTTGameEngine.isGameOver(curr)) return;
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
        if (OTTGameEngine.isGameOver(next)) {
          setRunning(false);
          if (next.winner) soundFx.playVictory();
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
      // Force reload editor bot runner on next match run
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
  const gameFinished = OTTGameEngine.isGameOver(gameState);
  const isHumanTurnNow =
    !gameFinished &&
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
                disabled={loadingBots || gameFinished}
                onClick={() => {
                  // Reset runners if code was edited before starting
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
                disabled={running || loadingBots || gameFinished || isHumanTurnNow}
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
                {Object.values(SPRINT_RULE_PRESETS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">Số quân / phe</label>
              <select
                value={pieceCount}
                onChange={(e) => {
                  const nextCount = Number(e.target.value);
                  setPieceCount(nextCount);
                  resetSandbox(seed, nextCount, presetKey);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono"
              >
                {[6, 9, 12, 15, 18].map((n) => (
                  <option key={n} value={n}>
                    {n} quân
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">Nhịp độ chạy</label>
              <select
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono"
              >
                <option value={80}>Nhanh (80ms)</option>
                <option value={300}>Vừa (300ms)</option>
                <option value={650}>Chậm (650ms)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">Giới hạn TLE</label>
              <select
                value={tleMs}
                onChange={(e) => setTleMs(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono"
              >
                <option value={200}>200 ms (Chuẩn giải)</option>
                <option value={500}>500 ms</option>
                <option value={1500}>1500 ms (Debug)</option>
              </select>
            </div>
          </div>

          {/* Status Strip + Random Seed */}
          <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs">
            <span className="font-medium text-[var(--text-primary)]">
              {gameFinished
                ? gameState.winner === 0
                  ? `Kết thúc: Hòa cờ sau ${gameState.stepCount} nước!`
                  : `Kết thúc: Phe ${gameState.winner} chiến thắng sau ${gameState.stepCount} nước!`
                : isHumanTurnNow
                ? `Lượt Phe ${gameState.turn} (Bạn) — Chọn quân cờ trên bàn để đi`
                : running
                ? `Đang mô phỏng lượt Phe ${gameState.turn}…`
                : `Sẵn sàng tại lượt Phe ${gameState.turn}`}
            </span>
            <button
              type="button"
              onClick={() => {
                const randomSeed = Math.floor(100000 + Math.random() * 8999999);
                setSeed(randomSeed);
                resetSandbox(randomSeed, pieceCount, presetKey);
              }}
              className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline cursor-pointer whitespace-nowrap"
            >
              <Shuffle className="w-3.5 h-3.5" />
              Đổi Seed mới
            </button>
          </div>

          {/* 9x9 Board */}
          <Board9x9
            state={gameState}
            selectedCell={selectedCell}
            validMoves={validMoves}
            onCellClick={handleBoardClick}
            interactive={isHumanTurnNow}
            size="normal"
            themeMode={themeMode}
          />

          {/* Compact Move & TLE Log */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-2">
              <span className="font-semibold text-[var(--text-primary)]">Nhật ký thực thi & thời gian phản hồi</span>
              <span className="font-mono tabular-nums">{logs.length} nước</span>
            </div>
            <div className="h-28 overflow-y-auto space-y-1 pr-1 font-mono text-xs tabular-nums">
              {logs.length === 0 ? (
                <div className="text-[var(--text-muted)] py-6 text-center">
                  Bấm "Chạy thử" hoặc "1 Bước" để kiểm tra tốc độ phản hồi của thuật toán.
                </div>
              ) : (
                logs.slice(-30).map((item, i) => (
                  <div
                    key={`${item.step}-${i}`}
                    className={`flex items-center justify-between px-2 py-1 rounded ${
                      item.isError ? 'bg-red-500/15 text-red-300' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    <span>
                      #{String(item.step).padStart(2, '0')} {item.text}
                    </span>
                    {item.elapsedMs !== undefined && (
                      <span className="text-[var(--text-muted)]">{item.elapsedMs}ms</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Python 3 Code Editor & Bot API Docs */}
        <div className="xl:col-span-6 p-5 sm:p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Terminal className="w-5 h-5 text-[var(--accent-primary)]" />
                Trình Soạn Thảo Bot Python 3
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 tabular-nums">
                Chạy cô lập trong Web Worker Pyodide ·{' '}
                {savedBotVersion > 0
                  ? `Đang lưu bản v${savedBotVersion} trên tài khoản`
                  : 'Chưa lưu lên tài khoản'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                defaultValue=""
                onChange={(e) => {
                  const key = e.target.value as SampleBotKey;
                  if (!key) return;
                  onEditorCodeChange(SAMPLE_BOTS[key]);
                  setSyntaxStatus(null);
                  notify(`Đã nạp mẫu "${SAMPLE_BOT_LABELS[key].name}" vào trình soạn thảo.`, 'info');
                  e.target.value = '';
                }}
                aria-label="Nạp mẫu thuật toán Python"
                className="px-3 py-2 text-xs rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              >
                <option value="" disabled>
                  Nạp Bot mẫu…
                </option>
                {(Object.keys(SAMPLE_BOT_LABELS) as SampleBotKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SAMPLE_BOT_LABELS[k].name} ({SAMPLE_BOT_LABELS[k].difficulty})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Code Editor Textarea */}
          <div className="relative rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[#09080f]">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/[0.06] text-[11px] font-mono text-[var(--text-muted)]">
              <span>bot.py · def get_next_move(my_player_id, game_state)</span>
              <span>{editorCode.split('\n').length} dòng</span>
            </div>
            <textarea
              value={editorCode}
              onChange={(e) => {
                onEditorCodeChange(e.target.value);
                if (syntaxStatus) setSyntaxStatus(null);
              }}
              onKeyDown={handleTextareaKeyDown}
              spellCheck={false}
              rows={20}
              aria-label="Mã nguồn Python 3 của Bot"
              className="code-editor w-full p-4 bg-transparent text-xs sm:text-[13px] leading-relaxed text-emerald-100 focus:outline-none resize-y min-h-[380px]"
            />
          </div>

          {/* Syntax feedback */}
          {syntaxStatus && (
            <div
              className={`p-3 rounded-xl border text-xs ${
                syntaxStatus.ok
                  ? 'border-emerald-500/35 bg-emerald-950/25 text-emerald-300'
                  : 'border-red-500/35 bg-red-950/25 text-red-300'
              }`}
            >
              {syntaxStatus.msg}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={checkingSyntax}
              onClick={handleCheckSyntax}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {checkingSyntax ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
              Kiểm tra cú pháp Python
            </button>

            <button
              type="button"
              disabled={savingServer}
              onClick={handleSaveServer}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {savingServer ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CloudUpload className="w-4 h-4" />
              )}
              {user ? 'Lưu Bot lên Tài khoản' : 'Đăng nhập để Lưu Bot'}
            </button>
          </div>

          {/* Collapsible Bot API Reference */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowApiGuide((s) => !s)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/40 transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[var(--accent-primary)]" />
                Tài liệu cấu trúc tham số game_state cho Python Bot
              </span>
              {showApiGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showApiGuide && (
              <div className="px-4 pb-4 pt-3 border-t border-[var(--border-subtle)] space-y-4 text-xs leading-relaxed text-[var(--text-secondary)]">
                <p>Hàm được gọi mỗi lượt và nhận mã người chơi của bạn cùng trạng thái bàn cờ hiện tại. Hãy trả về một nước đi hợp lệ.</p>
                <pre className="overflow-x-auto rounded-lg bg-[var(--bg-hover)]/50 p-3 text-[var(--text-primary)]"><code>{`def get_next_move(my_player_id, game_state):
    moves = game_state.get('validMoves', [])
    return moves[0] if moves else None`}</code></pre>
                <p><code className="text-[var(--text-primary)]">game_state</code> là dictionary Python. Lấy dữ liệu bằng tên khóa, ví dụ <code>game_state['validMoves']</code>. Dùng <code>game_state.get('validMoves', [])</code> để có danh sách rỗng nếu khóa không tồn tại.</p>
                <div>
                  <h4 className="mb-1 font-semibold text-[var(--text-primary)]">Bàn cờ và lượt chơi</h4>
                  <ul className="list-disc space-y-1 pl-4">
                    <li><code>board</code>: bàn cờ 9 × 9; ô hàng <code>r</code>, cột <code>c</code> được đọc bằng <code>board[r][c]</code>. Hàng và cột đánh số từ 0 đến 8.</li>
                    <li><code>flatBoard</code>: cùng bàn cờ trải thành danh sách 81 ô. Chỉ số ô bằng <code>row * 9 + col</code>; hàng 2, cột 3 là chỉ số 21.</li>
                    <li><code>boardRows</code>, <code>boardCols</code>: số hàng và cột (đều là 9). <code>turn</code>: mã người chơi đang đi. <code>myPlayerId</code> và <code>opponentPlayerId</code>: mã của bạn và đối thủ; <code>my_player_id</code> cũng là mã của bạn.</li>
                    <li><code>stepCount</code>: số lượt đã đi; <code>noCapturePlies</code>: số lượt liên tiếp chưa có quân bị ăn.</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-1 font-semibold text-[var(--text-primary)]">Danh sách nước đi: <code>validMoves</code></h4>
                  <p>Mỗi phần tử là một dictionary mô tả một nước hợp lệ trong lượt này.</p>
                  <ul className="list-disc space-y-1 pl-4">
                    <li><code>fromRow</code>, <code>fromCol</code>: hàng/cột xuất phát; <code>toRow</code>, <code>toCol</code>: hàng/cột đích. Các giá trị nằm trong khoảng 0–8.</li>
                    <li><code>from</code>, <code>to</code>: chỉ số ô xuất phát/đích từ 0 đến 80, tính bằng <code>row * 9 + col</code>.</li>
                    <li><code>fromAlg</code>, <code>toAlg</code>: tọa độ dạng chữ dễ đọc, ví dụ <code>a1</code>.</li>
                    <li><code>isAttack</code> và <code>isCapture</code>: <code>True</code> nếu tấn công/ăn quân, ngược lại <code>False</code>.</li>
                    <li><code>pieceType</code>: hệ quân đang đi; <code>targetType</code>: hệ quân ở ô đích hoặc <code>None</code> nếu ô trống. Tên hệ: <code>'rock'</code>, <code>'paper'</code>, <code>'scissors'</code>.</li>
                  </ul>
                  <p className="mt-1">Ví dụ <code>fromRow=2, fromCol=3, toRow=2, toCol=4</code> nghĩa là quân đi từ ô hàng 2 cột 3 sang hàng 2 cột 4. Chọn một phần tử sẵn có trong <code>validMoves</code> là cách đơn giản để bảo đảm nước đi hợp lệ.</p>
                </div>
                <div>
                  <h4 className="mb-1 font-semibold text-[var(--text-primary)]">Quân trên bàn và số lượng</h4>
                  <ul className="list-disc space-y-1 pl-4">
                    <li><code>myPieces</code>, <code>opponentPieces</code>: danh sách quân còn trên bàn của hai bên. Mỗi quân có <code>row</code>, <code>col</code>, <code>index</code>, <code>algebraic</code>, <code>player</code>, <code>type</code>, <code>raw</code>. <code>type</code> là tên hệ; <code>index</code> là chỉ số ô 0–80.</li>
                    <li><code>myPieceCounts</code>, <code>opponentPieceCounts</code>: số quân từng hệ còn lại, gồm <code>rock</code>, <code>paper</code>, <code>scissors</code>, <code>total</code>. Nếu một hệ của đối thủ còn 0 quân, bạn đạt điều kiện thắng theo luật.</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-1 font-semibold text-[var(--text-primary)]">Ô đặc biệt và luật</h4>
                  <ul className="list-disc space-y-1 pl-4">
                    <li><code>specialCells</code>: chỉ số các ô <code>a1</code>, <code>i9</code> và các khóa <code>myWinIndex</code>/<code>opponentWinIndex</code> cho biết ô thắng của mỗi bên.</li>
                    <li><code>blockedCells</code>: danh sách chỉ số ô bị khóa theo luật giải đấu, ví dụ <code>[30, 31, 32]</code>; có thể rỗng.</li>
                    <li><code>rules</code>: thông tin bộ luật đang áp dụng; có thể là <code>None</code>.</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-1 font-semibold text-[var(--text-primary)]">Giá trị trả về và ví dụ</h4>
                  <p>Có thể trả dictionary bằng tọa độ hàng/cột:</p>
                  <pre className="my-1 overflow-x-auto rounded-lg bg-[var(--bg-hover)]/50 p-3 text-[var(--text-primary)]"><code>{`return {'fromRow': 2, 'fromCol': 3, 'toRow': 2, 'toCol': 4}`}</code></pre>
                  <p>Hoặc bằng chỉ số ô:</p>
                  <pre className="my-1 overflow-x-auto rounded-lg bg-[var(--bg-hover)]/50 p-3 text-[var(--text-primary)]"><code>{`return {'from': 21, 'to': 22}`}</code></pre>
                  <p>Ví dụ ưu tiên nước ăn quân, nếu không có thì đi nước hợp lệ đầu tiên:</p>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-[var(--bg-hover)]/50 p-3 text-[var(--text-primary)]"><code>{`def get_next_move(my_player_id, game_state):
    moves = game_state.get('validMoves', [])
    if not moves:
        return None
    attacks = [move for move in moves if move['isAttack']]
    return attacks[0] if attacks else moves[0]`}</code></pre>
                  <p>Luôn chọn từ <code>validMoves</code> để tránh trả về nước không hợp lệ.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


