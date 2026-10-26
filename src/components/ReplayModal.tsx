import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Download,
  Pause,
  Play,
  ShieldCheck,
  X,
} from 'lucide-react';
import { OTTGameEngine, PIECE_VIET_NAMES, type GameState } from '../core/ottEngine';
import { hashState } from '../core/consensusCrypto';
import { Board9x9 } from './Board9x9';
import { MascotCountsInline } from './HalloweenPieces';

interface ReplayModalProps {
  open: boolean;
  replayData: any | null;
  player1Name?: string;
  player2Name?: string;
  themeMode: 'halloween' | 'standard';
  onClose: () => void;
}

export const ReplayModal: React.FC<ReplayModalProps> = ({
  open,
  replayData,
  player1Name = 'Player 1',
  player2Name = 'Player 2',
  themeMode,
  onClose,
}) => {
  const [states, setStates] = useState<GameState[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(600);
  const [verifiedHash, setVerifiedHash] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open || !replayData) return;
    let cancelled = false;
    setPlaying(false);
    setStepIdx(0);
    setErrorMsg('');
    setVerifiedHash(false);

    (async () => {
      try {
        if (replayData.format !== 'ottv2-replay-v1' || !replayData.initialState) {
          throw new Error('Định dạng dữ liệu Replay không hợp lệ.');
        }
        let curr = OTTGameEngine.deserialize(replayData.initialState);
        const timeline: GameState[] = [curr];
        let allHashesMatch = true;

        for (let i = 0; i < (replayData.moves || []).length; i++) {
          const entry = replayData.moves[i];
          curr = OTTGameEngine.applyMove(curr, {
            from: entry.move.from,
            to: entry.move.to,
          });
          if (entry.stateHash) {
            const computed = await hashState(curr);
            if (computed !== entry.stateHash) allHashesMatch = false;
          }
          timeline.push(curr);
        }
        if (!cancelled) {
          setStates(timeline);
          setVerifiedHash(allHashesMatch);
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err.message || 'Không thể đọc bản ghi Replay.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, replayData]);

  useEffect(() => {
    if (!playing || !states.length) return;
    const timer = setInterval(() => {
      setStepIdx((prev) => {
        if (prev >= states.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, speedMs);
    return () => clearInterval(timer);
  }, [playing, speedMs, states.length]);

  const currentState = states[stepIdx] || null;
  const counts = useMemo(
    () => (currentState ? OTTGameEngine.countPieces(currentState.board) : null),
    [currentState]
  );

  if (!open) return null;

  const handleDownloadJson = () => {
    if (!replayData) return;
    const blob = new Blob([JSON.stringify(replayData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ottv2-replay-${replayData.matchId || 'match'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-[var(--border-subtle)] bg-[#161024] p-5 sm:p-6 shadow-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              Phòng Chiếu Replay · {player1Name} vs {player2Name}
            </h2>
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] mt-0.5 tabular-nums">
              <span>Seed {replayData?.seed}</span>
              <span aria-hidden="true">·</span>
              <span>{Math.max(0, states.length - 1)} nước đi</span>
              {verifiedHash && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Đã xác minh chuỗi SHA-256
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Tải JSON
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng Replay"
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {errorMsg ? (
          <div className="py-12 text-center text-sm text-red-400">{errorMsg}</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-5 items-start">
            {/* Board & Scrubber */}
            <div className="lg:col-span-7 space-y-4">
              {counts && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs tabular-nums">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--p1-main)]">{player1Name}</span>
                    <MascotCountsInline counts={counts[1]} team={1} compact />
                  </div>
                  <div className="text-[var(--text-muted)] font-mono">
                    Lượt {stepIdx}/{Math.max(0, states.length - 1)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--p2-main)]">{player2Name}</span>
                    <MascotCountsInline counts={counts[2]} team={2} compact />
                  </div>
                </div>
              )}

              <Board9x9 state={currentState} themeMode={themeMode} size="normal" />

              <div className="space-y-3 p-3.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, states.length - 1)}
                  value={stepIdx}
                  onChange={(e) => {
                    setPlaying(false);
                    setStepIdx(Number(e.target.value));
                  }}
                  aria-label="Thanh tua lượt đi"
                  className="w-full accent-[var(--accent-primary)] cursor-pointer"
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setStepIdx(0);
                      }}
                      aria-label="Về đầu trận"
                      className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <ChevronFirst className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setStepIdx((s) => Math.max(0, s - 1));
                      }}
                      aria-label="Lùi 1 nước"
                      className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (stepIdx >= states.length - 1) setStepIdx(0);
                        setPlaying((p) => !p);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer"
                    >
                      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {playing ? 'Tạm dừng' : 'Phát tự động'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setStepIdx((s) => Math.min(states.length - 1, s + 1));
                      }}
                      aria-label="Tiến 1 nước"
                      className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setStepIdx(Math.max(0, states.length - 1));
                      }}
                      aria-label="Tới cuối trận"
                      className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <ChevronLast className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--text-secondary)]">Tốc độ:</span>
                    {[
                      { label: '1×', ms: 900 },
                      { label: '2×', ms: 450 },
                      { label: '4×', ms: 200 },
                    ].map((opt) => (
                      <button
                        key={opt.ms}
                        type="button"
                        onClick={() => setSpeedMs(opt.ms)}
                        className={`px-2.5 py-1 rounded-md font-mono transition-colors cursor-pointer ${
                          speedMs === opt.ms
                            ? 'bg-[var(--accent-primary)] text-white'
                            : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Algebraic Move Timeline */}
            <div className="lg:col-span-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 flex flex-col h-[480px]">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Biên bản nước đi
                </h3>
                {currentState && OTTGameEngine.isGameOver(currentState) && (
                  <span
                    className={`text-xs font-semibold ${
                      currentState.winner === 0 ? 'text-amber-300' : 'text-emerald-400'
                    }`}
                  >
                    {currentState.winner === 0
                      ? 'Kết quả Hòa'
                      : `${currentState.winner === 1 ? player1Name : player2Name} thắng`}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto mt-2 space-y-1 pr-1">
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setStepIdx(0);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                    stepIdx === 0
                      ? 'bg-[var(--bg-panel)] text-[var(--accent-primary)] border border-[var(--border-accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]'
                  }`}
                >
                  00. Khởi tạo bàn cờ (Seed {replayData?.seed})
                </button>

                {states.slice(1).map((st, idx) => {
                  const actualStep = idx + 1;
                  const lm = st.lastMove;
                  const pOwner = lm && lm.piece <= 3 ? 1 : 2;
                  const pName = lm ? PIECE_VIET_NAMES[lm.piece] : 'Quân';
                  const fromAlg = lm ? OTTGameEngine.toAlgebraic(lm.from) : '';
                  const toAlg = lm ? OTTGameEngine.toAlgebraic(lm.to) : '';
                  const capName = lm?.captured ? PIECE_VIET_NAMES[lm.captured] : null;

                  return (
                    <button
                      key={actualStep}
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setStepIdx(actualStep);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                        stepIdx === actualStep
                          ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] border border-[var(--border-accent)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]'
                      }`}
                    >
                      <span>
                        {String(actualStep).padStart(2, '0')}. P{pOwner} {pName} {fromAlg} → {toAlg}
                      </span>
                      {capName && <span className="text-red-400">Ăn {capName}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
