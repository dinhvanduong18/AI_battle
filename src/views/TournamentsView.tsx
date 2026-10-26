import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Code2,
  FastForward,
  Film,
  Loader2,
  Plus,
  ShieldCheck,
  Swords,
  Trophy,
  XCircle,
} from 'lucide-react';
import {
  OTTGameEngine,
  SPRINT_RULE_PRESETS,
  buildRulesFromPreset,
} from '../core/ottEngine';
import {
  backendClient,
  type BackendUser,
  type TournamentItem,
} from '../core/backendClient';
import { Board9x9 } from '../components/Board9x9';
import { useToast } from '../components/ToastProvider';

interface TournamentsViewProps {
  user: BackendUser | null;
  savedBotVersion: number;
  themeMode: 'halloween' | 'standard';
  tournaments: TournamentItem[];
  initialSelectedId?: string | null;
  onClearInitialSelectedId?: () => void;
  onRefreshTournaments: () => Promise<void>;
  onOpenAuth: (tab?: 'login' | 'register' | 'profile') => void;
  onOpenBotLab: () => void;
  onWatchReplayById: (matchId: string, p1: string, p2: string) => void;
}

const TIER_VIET: Record<string, string> = {
  Bronze: 'Đồng',
  Silver: 'Bạc',
  Gold: 'Vàng',
  Master: 'Cao Thủ',
  Challenger: 'Thách Đấu',
};

const TIER_COLORS: Record<string, string> = {
  Bronze: 'text-amber-500',
  Silver: 'text-slate-300',
  Gold: 'text-yellow-400',
  Master: 'text-purple-400',
  Challenger: 'text-orange-400',
};

const DEFAULT_SPRINT_SCHEDULE = ['standard', 'center_blockers', 'clipped_corners', 'corridor'];

function RankCrestSvg({ tier }: { tier: string }) {
  const color =
    tier === 'Challenger'
      ? '#f97316'
      : tier === 'Master'
      ? '#c084fc'
      : tier === 'Gold'
      ? '#facc15'
      : tier === 'Silver'
      ? '#cbd5e1'
      : '#d97706';

  return (
    <svg viewBox="0 0 32 32" className="w-7 h-7 shrink-0" aria-hidden="true">
      <polygon
        points="16,2 28,8 25,23 16,30 7,23 4,8"
        fill={color}
        fillOpacity="0.16"
        stroke={color}
        strokeWidth="1.8"
      />
      <polygon points="16,8 20,14 16,22 12,14" fill={color} fillOpacity="0.85" />
    </svg>
  );
}

export const TournamentsView: React.FC<TournamentsViewProps> = ({
  user,
  savedBotVersion,
  themeMode,
  tournaments,
  initialSelectedId = null,
  onClearInitialSelectedId,
  onRefreshTournaments,
  onOpenAuth,
  onOpenBotLab,
  onWatchReplayById,
}) => {
  const { notify } = useToast();
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'qualifying' | 'registration' | 'completed'
  >('all');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [detail, setDetail] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [queuingTournament, setQueuingTournament] = useState(false);
  const [showTournamentRules, setShowTournamentRules] = useState(false);
  const [showRankDetails, setShowRankDetails] = useState(false);

  // Create Tournament Form State (Admin / BTC)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newMaxPlayers, setNewMaxPlayers] = useState(64);
  const [regDays, setRegDays] = useState(3);
  const [sprintCount, setSprintCount] = useState(4);
  const [sprintSchedule, setSprintSchedule] = useState<string[]>(DEFAULT_SPRINT_SCHEDULE);

  useEffect(() => {
    if (initialSelectedId) {
      setSelectedId(initialSelectedId);
      onClearInitialSelectedId?.();
    }
  }, [initialSelectedId, onClearInitialSelectedId]);

  const loadTournamentDetail = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      try {
        const res = await backendClient.getTournamentDetail(id);
        setDetail(res);
      } catch (err: any) {
        notify(err.message || 'Không thể tải thông tin giải đấu.', 'error');
      } finally {
        setLoadingDetail(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    if (selectedId) {
      loadTournamentDetail(selectedId);
    }
  }, [loadTournamentDetail, selectedId, user?.id]);

  useEffect(() => {
    const offSearching = backendClient.on('searching', (pkt) => {
      if (pkt.mode === 'tournament') setQueuingTournament(true);
    });
    const offCancelled = backendClient.on('search-cancelled', () => setQueuingTournament(false));
    const offFound = backendClient.on('match-found', () => setQueuingTournament(false));
    const offErr = backendClient.on('error', (pkt) => {
      setQueuingTournament(false);
      if (pkt?.message) notify(pkt.message, 'error');
    });
    return () => {
      offSearching();
      offCancelled();
      offFound();
      offErr();
    };
  }, [notify]);

  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingAction(true);
    try {
      const created = await backendClient.createTournament({
        name: newName,
        format: 'ranked_weekly',
        description: newDesc,
        registrationDays: regDays,
        sprintCount,
        maxTeams: newMaxPlayers,
        sprintRules: sprintSchedule.slice(0, sprintCount),
      });
      await onRefreshTournaments();
      setShowCreateForm(false);
      setNewName('');
      setNewDesc('');
      notify('Đã tạo giải đấu cá nhân mới thành công!', 'success');
      if (created?.tournament?.id) {
        setSelectedId(created.tournament.id);
      }
    } catch (err: any) {
      notify(err.message || 'Tạo giải đấu thất bại.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleRegister = async (tournamentId: string) => {
    if (!user) {
      onOpenAuth('login');
      return;
    }
    setSubmittingAction(true);
    try {
      await backendClient.registerTournament(tournamentId);
      await onRefreshTournaments();
      await loadTournamentDetail(tournamentId);
      notify(
        savedBotVersion > 0
          ? 'Đã ghi danh giải đấu thành công! Bot đã lưu sẽ tự động được nạp khi vào trận.'
          : 'Đã ghi danh giải đấu thành công! Khi muốn thi đấu, hãy lưu Bot trong Phòng Lab trước khi tìm trận.',
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Không thể đăng ký giải đấu.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleStartTournamentNow = async (tournamentId: string) => {
    setSubmittingAction(true);
    try {
      await backendClient.startTournament(tournamentId);
      await onRefreshTournaments();
      await loadTournamentDetail(tournamentId);
      notify(
        'Đã chuyển sang Giai đoạn Thực chiến (Sprint 1) và phân hạng khởi đầu theo Elo!',
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Không thể bắt đầu vòng Thực chiến.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleAdvanceSprint = async (tournamentId: string) => {
    setSubmittingAction(true);
    try {
      const res = await backendClient.advanceTournamentSprint(tournamentId);
      await onRefreshTournaments();
      await loadTournamentDetail(tournamentId);
      const nextW = res?.tournament?.current_week || '';
      notify(
        `Đã chuyển sang Sprint ${nextW}, đổi bản đồ mới và xét lại hạng theo tỷ lệ ×2/3!`,
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Không thể chuyển sang Sprint tiếp theo.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleCompleteTournament = async (tournamentId: string) => {
    setSubmittingAction(true);
    try {
      await backendClient.completeTournament(tournamentId);
      await onRefreshTournaments();
      await loadTournamentDetail(tournamentId);
      notify('Đã kết thúc giải đấu và công bố Bảng Xếp Hạng Thách Đấu chung cuộc!', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể kết thúc giải đấu.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleFindMatch = async (tournamentId: string) => {
    if (!user) {
      onOpenAuth('login');
      return;
    }
    if (savedBotVersion <= 0) {
      notify('Hãy lưu Bot Python trong Phòng Lab trước khi vào hàng đợi giải đấu.', 'error');
      return;
    }
    try {
      setQueuingTournament(true);
      await backendClient.findTournamentMatch(tournamentId);
    } catch (err: any) {
      setQueuingTournament(false);
      notify(err.message || 'Không thể vào hàng đợi giải đấu.', 'error');
    }
  };

  // ── DETAIL VIEW FOR SELECTED TOURNAMENT ───────────────────────
  if (selectedId) {
    const t: TournamentItem | undefined = detail?.tournament;
    const myEntry = detail?.myEntry;
    const finalStandings: any[] = detail?.finalStandings || detail?.standings || [];
    const leaderboardHidden = Boolean(detail?.leaderboardHidden ?? t?.status !== 'completed');
    const motivationBanner = detail?.motivationBanner || null;
    const myMatches: any[] = detail?.matches || [];
    const ranks: any[] = detail?.ranks || [];

    const previewRules =
      t?.status !== 'registration' && t?.rules_json?.blockedCells
        ? t.rules_json
        : buildRulesFromPreset('standard', 1);
    const previewBoardState = OTTGameEngine.createGame(20261031, 9, previewRules);

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              backendClient.cancelMatch();
              setQueuingTournament(false);
              setSelectedId(null);
              setDetail(null);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Danh sách Giải đấu
          </button>

          {user?.isAdmin && t && (
            <div className="flex flex-wrap items-center gap-2">
              {t.status === 'registration' && (
                <button
                  type="button"
                  disabled={submittingAction}
                  onClick={() => handleStartTournamentNow(t.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-[var(--border-accent)] bg-[var(--bg-panel)] text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ShieldCheck className="w-4 h-4" />
                  BTC: Mở Vòng Thực Chiến (Sprint 1)
                </button>
              )}

              {t.status === 'qualifying' && (
                <>
                  {t.current_week < t.total_sprints && (
                    <button
                      type="button"
                      disabled={submittingAction}
                      onClick={() => handleAdvanceSprint(t.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <FastForward className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                      BTC: Sang Sprint tiếp theo (×2/3)
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={submittingAction}
                    onClick={() => handleCompleteTournament(t.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-[var(--border-accent)] bg-[var(--bg-panel)] text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    BTC: Kết thúc giải & Công bố BXH
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {loadingDetail || !t ? (
          <div className="p-12 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-[var(--accent-primary)] animate-spin" />
          </div>
        ) : (
          <>
            {/* Tournament Hero & Map Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] items-center">
              <div className="lg:col-span-8 space-y-4">
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-[var(--accent-primary)] tabular-nums">
                    {t.status === 'qualifying'
                      ? `Giai đoạn B · Thực chiến Sprint ${t.current_week || 1}/${t.total_sprints}`
                      : t.status === 'registration'
                      ? 'Giai đoạn A · Mở đăng ký & Chạy đà luyện tập'
                      : 'Giải đấu đã khép lại · Đã mở BXH Thách Đấu'}
                    {' · '}
                    {detail.participantCount}/{t.max_teams} kỳ thủ cá nhân
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-2xl font-bold text-[var(--text-primary)] text-balance">
                      {t.name}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowTournamentRules(true)}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border border-[var(--border-accent)] bg-[var(--bg-panel)] text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer shrink-0"
                    >
                      <BookOpen className="w-4 h-4" aria-hidden="true" />
                      Xem thể lệ giải đấu
                    </button>
                  </div>
                </div>

                {/* 5-Tier Progression Strip (10 - 20 - 30 - 40 - Challenger) */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                  {ranks.map((rk: any) => {
                    const isCurrent = t.status !== 'registration' && myEntry?.tier === rk.tier;
                    const cardClass = `flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors ${
                          isCurrent
                            ? 'border-[var(--border-accent)] bg-[var(--bg-panel)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)]'
                        }${isCurrent && myEntry ? ' cursor-pointer hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]' : ''}`;
                      const cardContent = (
                        <>
                          <RankCrestSvg tier={rk.tier} />
                          <div className="min-w-0">
                            <div className={`text-xs font-bold truncate ${TIER_COLORS[rk.tier] || ''}`}>
                              {rk.label}
                            </div>
                            <div className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                              {rk.tier === 'Challenger'
                                ? 'Hạng bí ẩn'
                                : `${rk.starsToPromote} Sao`}
                            </div>
                          </div>
                        </>
                      );
                    return isCurrent && myEntry ? (
                        <button
                          key={rk.tier}
                          type="button"
                          onClick={() => setShowRankDetails(true)}
                          aria-label={`Xem chi tiết hạng ${rk.label}`}
                          className={cardClass}
                        >
                          {cardContent}
                        </button>
                      ) : (
                        <div key={rk.tier} className={cardClass}>
                          {cardContent}
                        </div>
                      );
                  })}
                </div>

                {/* Stage Rules Summary */}
                <div className="text-xs text-[var(--text-secondary)] pt-1 leading-relaxed">
                  {t.status === 'registration' ? (
                    <span>
                      Chế độ Chạy Đà hiện tại: Ghép cặp ngẫu nhiên mọi kỳ thủ đã ghi danh trên bàn chuẩn 9×9 để kiểm nghiệm Bot · Không cộng/trừ Sao, kết quả vẫn cập nhật Elo. Khi đóng đăng ký, bậc hạng khởi điểm được xét theo Elo cá nhân (Đồng &lt; 1350 · Bạc 1350–1599 · Vàng ≥ 1600).
                    </span>
                  ) : (
                    <span>
                      Quy tắc Thực Chiến: Ghép cùng bậc hạng trong Sprint hiện tại · Thắng +1 Sao, Hòa 0 Sao, Thua -1 Sao · Đầu mỗi Sprint tuần mới xét lại hạng.
                    </span>
                  )}
                </div>

                {/* My Entry Status + Action Controls */}
                <div className="pt-3 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-subtle)]">
                  {myEntry && t.status === 'registration' ? (
                    <div className="text-xs text-[var(--text-secondary)]">
                      Đã ghi danh · Bậc hạng khởi điểm sẽ được xác định khi đóng đăng ký.
                    </div>
                  ) : myEntry ? (
                    <div className="text-xs text-[var(--text-secondary)] tabular-nums">
                      Hạng hiện tại:{' '}
                      <strong className={TIER_COLORS[myEntry.tier] || 'text-[var(--text-primary)]'}>
                        {TIER_VIET[myEntry.tier] || myEntry.tier}
                      </strong>{' '}
                      {myEntry.tier !== 'Challenger' && <>· {myEntry.rank_stars} Sao{' '}</>}
                      · {myEntry.wins} Thắng / {myEntry.draws || 0} Hòa / {myEntry.losses} Thua
                    </div>
                  ) : user ? (
                    <div className="text-xs text-[var(--text-muted)]">
                      {t.status === 'registration'
                        ? 'Bạn chưa ghi danh. Có thể tham gia ngay; hãy lưu Bot sau nếu muốn thi đấu.'
                        : 'Cổng đăng ký đã đóng cho giai đoạn Thực chiến.'}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--text-muted)]">
                      {t.status === 'registration'
                        ? 'Đăng nhập để ghi danh. Bạn có thể lưu Bot sau, trước khi tìm trận.'
                        : 'Cổng đăng ký đã đóng cho giai đoạn Thực chiến.'}
                    </div>
                  )}

                  {t.status !== 'completed' && (
                    <div className="flex flex-wrap items-center gap-2.5">
                      {!myEntry ? (
                        t.status === 'registration' && (
                          <button
                            type="button"
                            disabled={submittingAction}
                            onClick={() => handleRegister(t.id)}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Trophy className="w-4 h-4" />
                            Đăng ký tham gia giải
                          </button>
                        )
                      ) : savedBotVersion <= 0 ? (
                        <button
                          type="button"
                          onClick={onOpenBotLab}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Code2 className="w-4 h-4" />
                          Lưu Bot để bắt đầu thi đấu
                        </button>
                      ) : queuingTournament ? (
                        <button
                          type="button"
                          onClick={() => {
                            backendClient.cancelMatch();
                            setQueuingTournament(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <XCircle className="w-4 h-4" />
                          Đang tìm đối thủ cùng hạng… (Hủy)
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleFindMatch(t.id)}
                          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Swords className="w-4 h-4" />
                          {t.status === 'qualifying' ? 'Tìm đối thủ Thực Chiến' : 'Tìm trận Chạy Đà'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Active Sprint Map Obstacle Preview */}
              <div className="lg:col-span-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-center space-y-2.5">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  Bản đồ áp dụng:{' '}
                  {t.status === 'registration'
                    ? 'Bàn chuẩn 9×9 (Chạy đà)'
                    : previewRules?.title || 'Bàn chuẩn 9×9'}
                </div>
                <Board9x9
                  state={previewBoardState}
                  size="mini"
                  themeMode={themeMode}
                  showCoordinates={false}
                />
                <div className="text-[11px] text-[var(--text-muted)]">
                  {t.status === 'registration'
                    ? `Chạy đà trên bàn chuẩn · ${t.total_sprints} Sprint Thực chiến`
                    : `Sprint ${t.current_week}/${t.total_sprints} · ${previewRules?.title || 'Bàn chuẩn'}`}
                </div>
                {user?.isAdmin && t.rules_schedule?.length ? (
                  <div className="pt-2 border-t border-[var(--border-subtle)] text-left text-[11px] text-[var(--text-muted)]">
                    Lịch thể lệ BTC đã chọn:{' '}
                    {t.rules_schedule
                      .map((key, index) => `Sprint ${index + 1}: ${SPRINT_RULE_PRESETS[key]?.title || key}`)
                      .join(' · ')}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Official Challenger Leaderboard (When Completed) + My Matches */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {!leaderboardHidden && (
                <div className="lg:col-span-7 p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Award className="w-4 h-4 text-[var(--accent-primary)]" />
                        Bảng Xếp Hạng Thách Đấu Chung Cuộc
                      </h3>
                      <span className="text-xs text-[var(--text-muted)] tabular-nums">
                        {finalStandings.length} kỳ thủ Thách Đấu
                      </span>
                    </div>

                    {finalStandings.length === 0 ? (
                      <p className="py-8 text-center text-xs text-[var(--text-muted)]">
                        Giải đấu khép lại mà chưa có kỳ thủ nào chạm mốc bậc Thách Đấu (100 Sao tích lũy).
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                              <th className="py-2 pr-2 font-medium w-10">#</th>
                              <th className="py-2 px-2 font-medium">Kỳ thủ</th>
                              <th className="py-2 px-2 font-medium text-right">Điểm Thách Đấu</th>
                              <th className="py-2 px-2 font-medium text-right">Elo</th>
                              <th className="py-2 pl-2 font-medium text-right">Thắng - Hòa - Thua</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                            {finalStandings.map((row, idx) => {
                              const isMe = user?.id === row.player_id;
                              return (
                                <tr
                                  key={row.player_id}
                                  className={
                                    isMe ? 'bg-[var(--p1-bg)]' : 'hover:bg-[var(--bg-hover)]/40'
                                  }
                                >
                                  <td className="py-2.5 pr-2 font-mono text-[var(--text-secondary)]">
                                    {String(idx + 1).padStart(2, '0')}
                                  </td>
                                  <td className="py-2.5 px-2 font-medium text-[var(--text-primary)]">
                                    {row.display_name}
                                    {isMe && (
                                      <span className="text-[var(--accent-primary)] ml-1.5">
                                        · Bạn
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-2 text-right font-mono font-bold text-orange-400">
                                    {row.season_points} điểm
                                  </td>
                                  <td className="py-2.5 px-2 text-right font-mono text-[var(--text-primary)]">
                                    {row.elo}
                                  </td>
                                  <td className="py-2.5 pl-2 text-right font-mono text-[var(--text-secondary)]">
                                    {row.wins}W - {row.draws || 0}D - {row.losses}L
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>
              )}

              <div className={`${leaderboardHidden ? 'lg:col-span-12' : 'lg:col-span-5'} p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4`}>
                <h3 className="text-base font-bold text-[var(--text-primary)]">
                  Nhật ký ván đấu của bạn trong giải
                </h3>
                {!user ? (
                  <p className="py-6 text-xs text-[var(--text-muted)]">
                    Đăng nhập để theo dõi các ván đấu thuộc giải này.
                  </p>
                ) : myMatches.length === 0 ? (
                  <p className="py-6 text-xs text-[var(--text-muted)]">
                    Chưa có ván đấu nào của bạn trong giải này.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)] text-xs tabular-nums">
                    {myMatches.map((m) => {
                      const isDraw = m.status === 'completed' && !m.winner_id;
                      const won = m.status === 'completed' && m.winner_id === user.id;
                      const phaseLabel = m.is_sparring
                        ? 'Tập dượt AI'
                        : m.tournament_phase === 'ranked'
                        ? 'Thực Chiến'
                        : 'Chạy Đà';
                      const outcomeLabel =
                        m.is_sparring || m.tournament_phase !== 'ranked'
                          ? isDraw
                            ? 'Hòa (0 Sao)'
                            : won
                            ? 'Thắng (0 Sao)'
                            : 'Thua (0 Sao)'
                          : isDraw
                          ? 'Hòa (0 Sao)'
                          : won
                          ? 'Thắng (+1 Sao)'
                          : 'Thua (-1 Sao)';

                      return (
                        <div key={m.id} className="py-3 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-[var(--text-primary)]">
                              {m.player1} vs {m.player2}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                              {phaseLabel} ·{' '}
                              {m.status === 'completed' ? (
                                <span
                                  className={
                                    isDraw
                                      ? 'text-amber-300'
                                      : won
                                      ? 'text-emerald-400'
                                      : 'text-red-400'
                                  }
                                >
                                  {outcomeLabel}
                                </span>
                              ) : (
                                m.status
                              )}
                            </div>
                          </div>
                          {m.replay_available && (
                            <button
                              type="button"
                              onClick={() => onWatchReplayById(m.id, m.player1, m.player2)}
                              className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline cursor-pointer whitespace-nowrap"
                            >
                              <Film className="w-3.5 h-3.5" />
                              Replay
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {showRankDetails && myEntry && t.status !== 'registration' && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                onClick={(event) => {
                  if (event.target === event.currentTarget) setShowRankDetails(false);
                }}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="current-rank-heading"
                  className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7 shadow-2xl"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <RankCrestSvg tier={myEntry.tier} />
                      <div>
                        <div className="text-xs text-[var(--text-muted)]">Hạng hiện tại</div>
                        <h3 id="current-rank-heading" className={`text-lg font-bold ${TIER_COLORS[myEntry.tier] || 'text-[var(--text-primary)]'}`}>
                          {TIER_VIET[myEntry.tier] || myEntry.tier}
                        </h3>
                      </div>
                    </div>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setShowRankDetails(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>

                  {myEntry.tier !== 'Challenger' && <div className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                    <div className="flex items-end justify-between gap-3">
                      <span className="text-sm text-[var(--text-secondary)]">
                        Sao hiện có
                      </span>
                      <strong className="text-xl font-mono text-[var(--accent-primary)] tabular-nums">
                        {myEntry.rank_stars} / {ranks.find((rk: any) => rk.tier === myEntry.tier)?.starsToPromote ?? '—'} Sao
                      </strong>
                    </div>
                    {myEntry.tier !== 'Challenger' && (() => {
                      const threshold = Number(ranks.find((rk: any) => rk.tier === myEntry.tier)?.starsToPromote || 0);
                      const progress = threshold > 0 ? Math.min(100, Math.max(0, (Number(myEntry.rank_stars) / threshold) * 100)) : 0;
                      return (
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-hover)]" aria-label={`Tiến độ ${Math.round(progress)}%`}>
                          <div className="h-full rounded-full bg-[var(--accent-primary)] transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      );
                    })()}
                  </div>}

                  <div className="mt-5 space-y-2">
                    {myEntry.tier !== 'Challenger' && <div className="text-xs font-semibold text-[var(--accent-primary)]">
                      {motivationBanner?.groupLabel || 'Hành trình leo hạng'}
                    </div>}
                    <h4 className="text-base font-bold text-[var(--text-primary)]">
                      {myEntry.tier === 'Challenger'
                        ? 'Đấu Trường Thách Đấu — Cuộc Đua Bí Mật Tới Ngôi Vương'
                        : 'Hành Trình Chinh Phục Đỉnh Cao Thách Đấu'}
                    </h4>
                    <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                      {motivationBanner?.quote || 'Mỗi trận đấu là một cơ hội để thử chiến thuật, tìm điểm cần cải thiện và đưa Bot tiến gần hơn tới bậc hạng tiếp theo.'}
                    </p>
                  </div>
                </section>
              </div>
            )}

            {showTournamentRules && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                onClick={(event) => {
                  if (event.target === event.currentTarget) setShowTournamentRules(false);
                }}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="tournament-rules-heading"
                  className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7 shadow-2xl"
                >
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-3">
                      <BookOpen className="w-5 h-5 text-[var(--accent-primary)] shrink-0" aria-hidden="true" />
                      <h3 id="tournament-rules-heading" className="text-lg font-bold text-[var(--text-primary)]">
                        Thể lệ giải đấu
                      </h3>
                    </div>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setShowTournamentRules(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>

                  <div className="pt-5 space-y-5 text-sm text-[var(--text-secondary)] leading-7">
                    <div className="space-y-2">
                      <h4 className="text-base font-bold text-[var(--accent-primary)]">ĐẤU TRƯỜNG RANK</h4>
                      <p>Một Bot, một hành trình leo hạng. Từ những trận chạy đà đầu tiên đến các cuộc đối đầu quyết liệt qua từng Sprint, mỗi ván đấu là dịp để thử chiến thuật, tìm điểm yếu và chứng minh Bot của bạn có thể tiến xa đến đâu.</p>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-bold text-[var(--text-primary)]">A. Chạy đà — Thử lửa chiến thuật</h4>
                      <p>Khi giải còn mở đăng ký, bạn có thể ghi danh trước rồi chuẩn bị Bot sau. Đến lúc muốn ra sân, hãy lưu Bot Python trong Phòng Lab; hệ thống sẽ tự động sử dụng Bot đã lưu khi tìm trận.</p>
                      <p>Các Bot đã ghi danh được ghép cặp ngẫu nhiên trên bàn cờ 9×9. Đây là cơ hội để thử nhiều chiến thuật, phát hiện điểm yếu và tinh chỉnh Bot trước khi bước vào cuộc đua chính thức. Trận chạy đà không chỉ giúp bạn cải tiến Bot; Elo tích lũy trong giai đoạn này sẽ quyết định bậc rank khởi điểm của bạn.</p>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-bold text-[var(--text-primary)]">B. Thực chiến — Chinh phục từng Sprint</h4>
                      <p>Khi đăng ký khép lại, cuộc đua xếp hạng bắt đầu. Bậc khởi điểm được xác định theo Elo cá nhân:</p>
                      <ul className="list-disc pl-5 space-y-1 marker:text-[var(--accent-primary)]">
                        <li><strong className="text-[var(--text-primary)]">Đồng:</strong> dưới 1350 Elo</li>
                        <li><strong className="text-[var(--text-primary)]">Bạc:</strong> từ 1350 đến 1599 Elo</li>
                        <li><strong className="text-[var(--text-primary)]">Vàng:</strong> từ 1600 Elo trở lên</li>
                      </ul>
                      <p>Trong mỗi Sprint, Bot tìm đối thủ cùng bậc hạng và thi đấu trên bản đồ tuần đó. Mỗi tuần là một thử thách mới. Sau mỗi sprint sẽ có 1 điều bí ẩn xuất hiện làm thay đổi luật chơi bạn sẽ phải thay đổi để phù hợp với yêu cầu đó.</p>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-bold text-[var(--text-primary)]">Mỗi kết quả đều làm thay đổi hành trình</h4>
                      <ul className="list-disc pl-5 space-y-1 marker:text-[var(--accent-primary)]">
                        <li><strong className="text-[var(--text-primary)]">Thắng:</strong> cộng 1 Sao; ở bậc Thách Đấu, cộng 1 Điểm Thách Đấu.</li>
                        <li><strong className="text-[var(--text-primary)]">Hòa:</strong> không đổi Sao.</li>
                        <li><strong className="text-[var(--text-primary)]">Thua:</strong> trừ 1 Sao. Nếu đang ở 0 Sao tại Đồng thì giữ nguyên, không xuống dưới 0.</li>
                      </ul>
                      <p>Đạt mốc Sao để thăng bậc: <strong className="text-[var(--text-primary)]">Đồng 10 Sao · Bạc 20 Sao · Vàng 30 Sao · Cao Thủ 40 Sao</strong>. Kết quả Thực chiến cũng cập nhật Elo giải.</p>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-bold text-[var(--text-primary)]">Sang Sprint mới, cuộc đua được làm mới</h4>
                      <p>Đầu mỗi Sprint tuần mới, <strong className="text-[var(--text-primary)]">ranking sẽ được xét lại</strong>. Vì vậy, giữ phong độ qua từng tuần quan trọng không kém một chuỗi thắng ấn tượng: bản đồ đổi, thứ hạng thay đổi, và mọi Bot lại có cơ hội bứt phá.</p>
                    </div>

                    <p className="border-t border-[var(--border-subtle)] pt-4">Không có trận thua nào loại bạn khỏi cuộc đua. Hãy học từ từng ván đấu, thích nghi với luật mới và tiếp tục nâng cấp Bot — Sprint tiếp theo có thể là lúc bạn tạo nên cú bứt tốc của mùa giải.</p>
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── TOURNAMENT DIRECTORY LIST VIEW (1-Click Event Frame) ──────
  const filteredList = tournaments.filter((t) =>
    statusFilter === 'all' ? true : t.status === statusFilter
  );

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
          {(
            [
              { id: 'all', label: 'Tất cả giải' },
              { id: 'qualifying', label: 'Đang thực chiến' },
              { id: 'registration', label: 'Mở đăng ký · Chạy đà' },
              { id: 'completed', label: 'Đã kết thúc' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                statusFilter === tab.id
                  ? 'bg-[var(--bg-panel)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {user?.isAdmin && (
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            {showCreateForm ? 'Đóng biểu mẫu' : 'Tạo giải đấu mới (BTC)'}
          </button>
        )}
      </div>

      {/* Collapsible Admin Create Tournament Panel */}
      {showCreateForm && user?.isAdmin && (
        <form
          onSubmit={handleCreateTournament}
          className="p-6 rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-elevated)] space-y-4"
        >
          <h3 className="text-base font-bold text-[var(--text-primary)]">
            Khởi tạo Giải đấu Cá nhân theo Sprint Tuần
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Tên giải đấu</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ví dụ: Đấu Trường Trăng Máu Mùa 2"
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Số kỳ thủ cá nhân tối đa
              </label>
              <input
                type="number"
                min={2}
                max={256}
                value={newMaxPlayers}
                onChange={(e) => setNewMaxPlayers(Number(e.target.value))}
                className="w-full px-3.5 py-2 text-sm font-mono rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Thể lệ & mô tả giải đấu
            </label>
            <textarea
              rows={2}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Mô tả ngắn gọn lịch thi đấu Chạy đà & Thực chiến…"
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                Số ngày đăng ký
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={regDays}
                onChange={(e) => setRegDays(Number(e.target.value))}
                className="w-full px-3 py-1.5 font-mono rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                Số Sprint Thực chiến
              </label>
              <input
                type="number"
                min={1}
                max={52}
                value={sprintCount}
                onChange={(e) => {
                  const nextCount = Math.min(52, Math.max(1, Math.floor(Number(e.target.value) || 1)));
                  setSprintCount(nextCount);
                  setSprintSchedule((current) =>
                    Array.from(
                      { length: nextCount },
                      (_, index) => current[index] || DEFAULT_SPRINT_SCHEDULE[index % DEFAULT_SPRINT_SCHEDULE.length]
                    )
                  );
                }}
                className="w-full px-3 py-1.5 font-mono rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">
              Chọn thể lệ riêng cho từng Sprint (7 ngày/Sprint)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: sprintCount }, (_, sprintIdx) => (
              <div key={sprintIdx}>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Thể lệ Sprint {sprintIdx + 1}
                </label>
                <select
                  value={sprintSchedule[sprintIdx]}
                  onChange={(e) => {
                    const copy = [...sprintSchedule];
                    copy[sprintIdx] = e.target.value;
                    setSprintSchedule(copy);
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
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submittingAction}
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer whitespace-nowrap"
            >
              {submittingAction ? 'Đang khởi tạo…' : 'Công bố Giải đấu'}
            </button>
          </div>
        </form>
      )}

      {/* Tournament cards open details; registration happens inside the detail view. */}
      {filteredList.length === 0 ? (
        <div className="p-12 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-center text-sm text-[var(--text-muted)]">
          Chưa có giải đấu nào trong mục này.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {filteredList.map((t) => {
            const endDate = new Date(t.ends_at).toLocaleDateString('vi-VN');
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(t.id);
                  }
                }}
                aria-label={`Mở sự kiện ${t.name}`}
                className="group p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col justify-between space-y-5 hover:border-[var(--border-accent)] hover:bg-[var(--bg-panel)]/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] transition-colors cursor-pointer text-left"
              >
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-[var(--accent-primary)] tabular-nums">
                    {t.status === 'qualifying'
                      ? `Thực Chiến · Sprint ${t.current_week || 1}/${t.total_sprints}`
                      : t.status === 'registration'
                      ? 'Mở Đăng Ký · Vòng Chạy Đà'
                      : 'Đã Kết Thúc · Đã Công Bố BXH'}
                    {' · '}
                    {t.participant_count || 0}/{t.max_teams} kỳ thủ cá nhân
                  </div>

                  <h3 className="text-xl font-bold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
                    {t.name}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                    {t.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)] tabular-nums">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Kết thúc: {endDate}</span>
                    {t.rules_json?.title && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{t.rules_json.title}</span>
                      </>
                    )}
                  </div>
                  <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                    Nhấn vào khung sự kiện để xem chi tiết
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
