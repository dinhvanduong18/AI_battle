import React, { useState } from 'react';
import { ArrowLeft, Grid3X3, Scale, Settings2, X } from 'lucide-react';

export interface TournamentCreatePayload {
  name: string;
  description: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  tournamentStartsAt: string;
  blockedCells: number[];
  moveLimitRule: 'standard' | 'remaining-pieces' | 'goal-distance' | 'captured-points';
  capturedPieceValues: { rock: number; paper: number; scissors: number };
}

interface TournamentCreationModalProps {
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: TournamentCreatePayload) => Promise<void>;
}

function localDateTimeValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export const TournamentCreationModal: React.FC<TournamentCreationModalProps> = ({
  submitting,
  onClose,
  onSubmit,
}) => {
  const now = new Date();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [registrationOpensAt, setRegistrationOpensAt] = useState(localDateTimeValue(now));
  const [registrationClosesAt, setRegistrationClosesAt] = useState(
    localDateTimeValue(new Date(now.getTime() + 3 * 86400000))
  );
  const [tournamentStartsAt, setTournamentStartsAt] = useState(
    localDateTimeValue(new Date(now.getTime() + 4 * 86400000))
  );
  const [blockedCells, setBlockedCells] = useState<number[]>([]);
  const [moveLimitRule, setMoveLimitRule] = useState<
    'standard' | 'remaining-pieces' | 'goal-distance' | 'captured-points'
  >(
    'standard'
  );
  const [capturedPieceValues, setCapturedPieceValues] = useState({
    rock: 1,
    paper: 2,
    scissors: 3,
  });
  const [customizationLayer, setCustomizationLayer] = useState<
    'menu' | 'board' | 'rules' | null
  >(null);
  const [boardDraft, setBoardDraft] = useState<number[]>([]);
  const [rulesDraft, setRulesDraft] = useState<
    'standard' | 'remaining-pieces' | 'goal-distance' | 'captured-points'
  >('standard');
  const [capturedPieceValuesDraft, setCapturedPieceValuesDraft] = useState(capturedPieceValues);
  const [formError, setFormError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const opens = new Date(registrationOpensAt);
    const closes = new Date(registrationClosesAt);
    const starts = new Date(tournamentStartsAt);
    if (opens >= closes || closes >= starts) {
      setFormError('Thời gian cần theo thứ tự: mở đăng ký, đóng đăng ký, bắt đầu giải.');
      return;
    }
    setFormError('');
    await onSubmit({
      name,
      description,
      registrationOpensAt: opens.toISOString(),
      registrationClosesAt: closes.toISOString(),
      tournamentStartsAt: starts.toISOString(),
      blockedCells,
      moveLimitRule,
      capturedPieceValues,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm sm:items-center"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-tournament-heading"
        className="my-auto w-full max-w-4xl rounded-2xl border border-[var(--border-accent)] bg-[#150e23] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] p-5 sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-primary)]">
              Ban Tổ Chức
            </p>
            <h2 id="create-tournament-heading" className="mt-1 text-xl font-bold">
              Tạo giải vòng bảng + knock-out
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Mỗi tài khoản đăng ký một đấu thủ; sau khi đóng đăng ký, BTC chia 8, 16 hoặc 32 bảng.
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-white disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs text-[var(--text-secondary)]">Tên giải đấu</span>
              <input
                autoFocus
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-sm text-white focus:border-[var(--accent-primary)] focus:outline-none"
                placeholder="Ví dụ: OTTv2 Open Cup"
              />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs text-[var(--text-secondary)]">Mô tả</span>
              <textarea
                rows={2}
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-sm text-white focus:border-[var(--accent-primary)] focus:outline-none"
                placeholder="Thông tin giải đấu dành cho người chơi"
              />
            </label>
            {[
              ['registration-opens', 'Thời gian mở đăng ký', registrationOpensAt, setRegistrationOpensAt],
              ['registration-closes', 'Thời gian đóng đăng ký', registrationClosesAt, setRegistrationClosesAt],
              ['tournament-starts', 'Thời gian bắt đầu giải', tournamentStartsAt, setTournamentStartsAt],
            ].map(([id, label, value, setter]) => (
              <label key={id as string}>
                <span className="mb-1 block text-xs text-[var(--text-secondary)]">{label as string}</span>
                <input
                  type="datetime-local"
                  required
                  value={value as string}
                  onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2.5 text-sm text-white [color-scheme:dark]"
                />
              </label>
            ))}
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tùy chỉnh giải</h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Bàn cờ: {blockedCells.length} ô chướng ngại · Luật thi đấu:{' '}
                  {moveLimitRule === 'standard'
                    ? 'luật cơ bản'
                    : moveLimitRule === 'remaining-pieces'
                    ? 'đếm quân còn lại'
                    : moveLimitRule === 'goal-distance'
                    ? 'tính điểm theo vị trí'
                    : 'tính điểm quân đã ăn'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomizationLayer('menu')}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-panel)] px-4 py-2 text-xs font-semibold text-[var(--accent-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Settings2 className="h-4 w-4" />
                Tùy chỉnh giải
              </button>
            </div>
          </div>

          {formError && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[var(--accent-primary)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
            >
              {submitting ? 'Đang tạo giải…' : 'Tạo giải đấu'}
            </button>
          </div>
        </form>

        {customizationLayer && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="tournament-customization-heading"
              className="w-full max-w-2xl rounded-2xl border border-[var(--border-accent)] bg-[#150e23] p-5 shadow-2xl sm:p-6"
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {customizationLayer !== 'menu' && (
                    <button
                      type="button"
                      onClick={() => setCustomizationLayer('menu')}
                      aria-label="Quay lại tùy chỉnh giải"
                      className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-white"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  )}
                  <h3 id="tournament-customization-heading" className="text-lg font-bold">
                    {customizationLayer === 'menu'
                      ? 'Tùy chỉnh giải'
                      : customizationLayer === 'board'
                      ? 'Tùy chỉnh bàn đấu'
                      : 'Tùy chỉnh luật chơi'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomizationLayer(null)}
                  aria-label="Đóng tùy chỉnh"
                  className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {customizationLayer === 'menu' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBoardDraft([...blockedCells]);
                      setCustomizationLayer('board');
                    }}
                    className="flex min-h-32 flex-col items-start justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 text-left hover:border-[var(--border-accent)]"
                  >
                    <Grid3X3 className="h-6 w-6 text-[var(--accent-primary)]" />
                    <span>
                      <strong className="block text-sm text-[var(--text-primary)]">Tùy chỉnh bàn đấu</strong>
                      <span className="mt-1 block text-xs text-[var(--text-muted)]">
                        Thêm/bỏ chướng ngại đối xứng trên bàn 9×9.
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRulesDraft(moveLimitRule);
                      setCapturedPieceValuesDraft({ ...capturedPieceValues });
                      setCustomizationLayer('rules');
                    }}
                    className="flex min-h-32 flex-col items-start justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 text-left hover:border-[var(--border-accent)]"
                  >
                    <Scale className="h-6 w-6 text-[var(--accent-primary)]" />
                    <span>
                      <strong className="block text-sm text-[var(--text-primary)]">Tùy chỉnh luật chơi</strong>
                      <span className="mt-1 block text-xs text-[var(--text-muted)]">
                        Chọn cách tính kết quả sau 25 nước.
                      </span>
                    </span>
                  </button>
                </div>
              ) : customizationLayer === 'board' ? (
                <div>
                  <p className="mb-3 text-xs text-[var(--text-secondary)]">
                    Chọn một ô để đổi đồng thời ô đối diện qua đường chéo chính. Hai ô đích không thể bị chặn.
                  </p>
                  <div className="mx-auto grid w-fit grid-cols-9 overflow-hidden rounded-xl border border-[var(--border-subtle)]">
                    {Array.from({ length: 81 }, (_, index) => {
                      const isTarget = index === 8 || index === 72;
                      const isBlocked = boardDraft.includes(index);
                      const row = Math.floor(index / 9);
                      const col = index % 9;
                      const oppositeIndex = col * 9 + row;
                      return (
                        <button
                          key={index}
                          type="button"
                          disabled={isTarget}
                          aria-label={`${String.fromCharCode(97 + col)}${9 - row}${isBlocked ? ', chướng ngại' : ''}`}
                          aria-pressed={isBlocked}
                          title={isTarget ? 'Ô đích không thể bị chặn' : `Đổi cả ô ${String.fromCharCode(97 + col)}${9 - row} và ô đối xứng`}
                          onClick={() =>
                            setBoardDraft((current) => {
                              const pair = new Set([index, oppositeIndex]);
                              return isBlocked
                                ? current.filter((cell) => !pair.has(cell))
                                : [...current.filter((cell) => !pair.has(cell)), ...pair];
                            })
                          }
                          className={`h-8 w-8 border-r border-b border-black/30 text-[10px] transition-colors sm:h-9 sm:w-9 ${
                            isTarget
                              ? 'cursor-not-allowed bg-orange-700/70 text-white'
                              : isBlocked
                              ? 'bg-slate-500 text-white'
                              : (row + col) % 2
                              ? 'bg-[#21172f] text-transparent hover:bg-orange-500/60'
                              : 'bg-[#30213f] text-transparent hover:bg-orange-500/60'
                          }`}
                        >
                          {isTarget ? '◆' : isBlocked ? '■' : '·'}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Đang chọn {boardDraft.length} chướng ngại · cần giữ ít nhất 3 cặp ô khởi đầu.
                    </p>
                    <button
                      type="button"
                      onClick={() => setBoardDraft([])}
                      disabled={!boardDraft.length}
                      className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                    >
                      Xóa hết chướng ngại vật
                    </button>
                  </div>
                  <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
                    <button
                      type="button"
                      onClick={() => setCustomizationLayer('menu')}
                      className="rounded-xl px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    >
                      Quay lại, không lưu
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBlockedCells([...boardDraft]);
                        setCustomizationLayer('menu');
                      }}
                      className="rounded-xl bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-primary-hover)]"
                    >
                      Xác nhận bàn đấu
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {([
                    ['standard', 'Cơ bản', 'Chơi theo luật gốc đến khi có bên thắng, không tự kết thúc ở nước 25.'],
                    ['remaining-pieces', 'Đếm số quân còn lại', 'Bên còn nhiều quân hơn sau 25 nước thắng.'],
                    ['goal-distance', 'Tính điểm theo vị trí', 'Quân càng gần ô đích thì tổng điểm vị trí càng cao.'],
                    ['captured-points', 'Tính điểm quân đã ăn', 'Cộng điểm theo giá trị các quân đã ăn được.'],
                  ] as const).map(([rule, title, description]) => (
                    <label
                      key={rule}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-xs"
                    >
                      <input
                        type="radio"
                        name="move-limit-rule"
                        value={rule}
                        checked={rulesDraft === rule}
                        onChange={() => setRulesDraft(rule)}
                        className="mt-0.5 accent-orange-500"
                      />
                      <span>
                        <strong className="block text-[var(--text-primary)]">{title}</strong>
                        <span className="mt-0.5 block text-[var(--text-muted)]">{description}</span>
                      </span>
                    </label>
                  ))}
                  {rulesDraft === 'captured-points' && (
                    <div className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 sm:grid-cols-3">
                      {([
                        ['rock', 'Bí Ngô (Đấm)'],
                        ['paper', 'Bé Ma (Lá)'],
                        ['scissors', 'Dơi (Kéo)'],
                      ] as const).map(([piece, label]) => (
                        <label key={piece} className="text-xs text-[var(--text-secondary)]">
                          <span className="mb-1 block">{label} · điểm khi bị ăn</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={capturedPieceValuesDraft[piece]}
                            onChange={(event) =>
                              setCapturedPieceValuesDraft((current) => ({
                                ...current,
                                [piece]: Number(event.target.value),
                              }))
                            }
                            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[#150e23] px-3 py-2 text-sm text-white"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Các luật tính điểm được áp dụng sau 25 nước đi hoàn chỉnh.
                  </p>
                  <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
                    <button
                      type="button"
                      onClick={() => setCustomizationLayer('menu')}
                      className="rounded-xl px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    >
                      Quay lại, không lưu
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoveLimitRule(rulesDraft);
                        setCapturedPieceValues({ ...capturedPieceValuesDraft });
                        setCustomizationLayer('menu');
                      }}
                      className="rounded-xl bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-primary-hover)]"
                    >
                      Xác nhận luật chơi
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
};
