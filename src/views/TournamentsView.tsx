import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  FastForward,
  Film,
  Loader2,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
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

function getKnockoutRoundName(round: number, totalRounds: number): string {
  const remaining = totalRounds - round + 1;
  if (remaining === 1) return 'Trận Chung Kết';
  if (remaining === 2) return 'Vòng Bán Kết';
  if (remaining === 3) return 'Vòng Tứ Kết';
  if (remaining === 4) return 'Vòng 1/8 (Vòng 16)';
  return `Vòng ${round}`;
}

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
  const [joinCode, setJoinCode] = useState('');
  const [knockoutRules, setKnockoutRules] = useState<string[]>([
    'standard',
    'center_blockers',
    'clipped_corners',
    'corridor',
  ]);

  // Create Tournament Form State (Admin / BTC)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFormat, setNewFormat] = useState<'ranked_weekly' | 'knockout'>('knockout');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newMaxPlayers, setNewMaxPlayers] = useState(64);
  const [regDays, setRegDays] = useState(3);
  const [sprintCount, setSprintCount] = useState(4);
  const [sprintSchedule, setSprintSchedule] = useState<string[]>(DEFAULT_SPRINT_SCHEDULE);
  const [knockoutSize, setKnockoutSize] = useState<number>(8);

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
      const numRounds =
        newFormat === 'knockout' ? Math.max(1, Math.ceil(Math.log2(knockoutSize))) : sprintCount;
      const rules =
        newFormat === 'knockout'
          ? knockoutRules.slice(0, numRounds)
          : sprintSchedule.slice(0, sprintCount);

      const created = await backendClient.createTournament({
        name: newName,
        format: newFormat,
        description: newDesc,
        registrationDays: regDays,
        sprintCount: numRounds,
        maxTeams: newFormat === 'knockout' ? knockoutSize : newMaxPlayers,
        sprintRules: rules,
      });
      await onRefreshTournaments();
      setShowCreateForm(false);
      setNewName('');
      setNewDesc('');
      notify(
        newFormat === 'knockout'
          ? 'Đã tạo giải đấu Cúp Loại Trực Tiếp (Knockout BO5) thành công!'
          : 'Đã tạo giải đấu cá nhân mới thành công!',
        'success'
      );
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

  const handleJoinTournamentByCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) {
      onOpenAuth('login');
      return;
    }
    const code = joinCode.trim().toUpperCase().replace(/^OTT-/, '');
    if (!code) {
      notify('Nh\u1eadp m\u00e3 gi\u1ea3i Knockout \u0111\u1ec3 tham gia.', 'error');
      return;
    }
    setSubmittingAction(true);
    try {
      const result = await backendClient.joinTournamentByCode(code);
      await onRefreshTournaments();
      setJoinCode('');
      setSelectedId(result.tournamentId);
      await loadTournamentDetail(result.tournamentId);
      notify(result.alreadyRegistered ? 'B\u1ea1n \u0111\u00e3 tham gia gi\u1ea3i Knockout n\u00e0y.' : '?? tham gia gi?i Knockout th?nh c?ng!', 'success');
    } catch (err: any) {
      notify(err.message || 'Kh\u00f4ng th\u1ec3 tham gia gi\u1ea3i b\u1eb1ng m\u00e3 n\u00e0y.', 'error');
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

  const handleSkipKnockoutBreak = async (tournamentId: string, matchupId?: string) => {
    setSubmittingAction(true);
    try {
      await backendClient.skipKnockoutBreak(tournamentId, matchupId);
      await loadTournamentDetail(tournamentId);
      notify('Đã bỏ qua thời gian nghỉ thành công!', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể bỏ qua thời gian nghỉ.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleLaunchKnockoutMatch = async (tournamentId: string, matchupId: string) => {
    setSubmittingAction(true);
    try {
      await backendClient.launchKnockoutMatch(tournamentId, matchupId);
      await loadTournamentDetail(tournamentId);
      notify('Đã khởi động ván đấu Knockout!', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể khởi động ván đấu.', 'error');
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
      const currentTournament = detail?.tournament;
      if (currentTournament?.id === tournamentId && currentTournament.format === 'knockout') {
        const bracket = currentTournament.knockout_data;
        const matchup = bracket?.matchups?.find((item: any) => item.round === bracket.current_round &&
          (item.player1_id === user.id || item.player2_id === user.id) &&
          ['ready', 'waiting_break'].includes(item.status));
        if (!matchup) {
          notify('Hiện chưa có cặp đấu sẵn sàng cho bạn. Hãy chờ BTC bắt đầu giải hoặc vòng tiếp theo.', 'error');
          return;
        }
        await backendClient.launchKnockoutMatch(tournamentId, matchup.id);
        await loadTournamentDetail(tournamentId);
        notify('Đã bắt đầu ván Knockout của cặp đấu bạn.', 'success');
        return;
      }
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
                  {t.format === 'knockout'
                    ? 'BTC: Bốc thăm & Bắt đầu Knockout'
                    : 'BTC: Mở Vòng Thực Chiến (Sprint 1)'}
                </button>
              )}

              {t.status === 'qualifying' && (
                <>
                  {t.format === 'knockout' && t.knockout_data?.round_break_until && (
                    <button
                      type="button"
                      disabled={submittingAction}
                      onClick={() => handleSkipKnockoutBreak(t.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <FastForward className="w-3.5 h-3.5" />
                      BTC: Bỏ qua nghỉ 30p giữa vòng
                    </button>
                  )}
                  {t.format === 'ranked_weekly' && t.current_week < t.total_sprints && (
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
                    BTC: Kết thúc giải
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
            {t.format === 'knockout' ? (
              <div className="space-y-6">
                {/* Knockout Hero Banner & Map Preview */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 rounded-2xl border border-amber-500/30 bg-[var(--bg-elevated)] items-center">
                  <div className="lg:col-span-8 space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          🏆 Cúp Loại Trực Tiếp (Knockout BO5)
                        </span>
                        <span className="text-[var(--text-secondary)]">
                          {t.status === 'qualifying'
                            ? `Vòng ${t.knockout_data?.current_round || 1}/${t.knockout_data?.total_rounds || 3} · ${getKnockoutRoundName(t.knockout_data?.current_round || 1, t.knockout_data?.total_rounds || 3)}`
                            : t.status === 'registration'
                            ? 'Giai đoạn Mở Đăng Ký'
                            : 'Giải đấu đã hoàn tất'}
                          {' · '}
                          {detail.participantCount}/{t.max_teams} kỳ thủ
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-2xl font-bold text-[var(--text-primary)] text-balance">
                          {t.name}
                        </h2>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        {t.description ||
                          'Giải đấu cúp loại trực tiếp 5 ván (Best of 5), người thắng 3 ván trước sẽ đi tiếp vào vòng trong.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowTournamentRules(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
                      >
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                        {'Xem th\u1ec3 l\u1ec7 gi\u1ea3i \u0111\u1ea5u'}
                      </button>
                    </div>

                    {/* Quick tournament specs badge */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-[var(--text-secondary)]">
                      <div className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex items-center gap-2">
                        <Swords className="w-4 h-4 text-amber-400 shrink-0" />
                        <span><strong>Best of 5:</strong> Đấu tối đa 5 ván, chạm 3 thắng là đi tiếp</span>
                      </div>
                      <div className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                        <span><strong>Nghỉ 10p / ván:</strong> Kỳ thủ tinh chỉnh bot</span>
                      </div>
                      <div className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex items-center gap-2">
                        <FastForward className="w-4 h-4 text-amber-400 shrink-0" />
                        <span><strong>Nghỉ 30p / vòng:</strong> Ban hành luật sprint mới</span>
                      </div>
                    </div>

                    {/* Registration / Player Action Status */}
                    <div className="pt-3 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-subtle)]">
                      {myEntry ? (
                        <div className="text-xs text-amber-400 font-semibold flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          Bạn đã ghi danh tham gia giải đấu này với Bot phiên bản v{myEntry.bot_version || 1}
                        </div>
                      ) : t.status === 'registration' ? (
                        <div className="text-xs text-[var(--text-muted)]">
                          Cổng đăng ký đang mở. Bạn có thể đăng ký ngay để giữ suất thi đấu.
                        </div>
                      ) : (
                        <div className="text-xs text-[var(--text-muted)]">
                          Cổng đăng ký đã đóng. Giải đấu đang diễn ra.
                        </div>
                      )}

                      {t.status === 'registration' && !myEntry && (
                        <form onSubmit={handleJoinTournamentByCode} className="flex flex-wrap items-center gap-2">
                          <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="A7K9P2" maxLength={10} aria-label="Knockout code" className="w-32 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 font-mono text-xs tracking-widest text-[var(--text-primary)] outline-none focus:border-amber-400" />
                          <button type="submit" disabled={submittingAction} className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300 disabled:opacity-50">{'Nh\u1eadp m\u00e3 v\u00e0 tham gia'}</button>
                        </form>
                      )}

                      {myEntry && savedBotVersion <= 0 && (
                        <button
                          type="button"
                          onClick={onOpenBotLab}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Code2 className="w-4 h-4" />
                          Lưu Bot trong Phòng Lab
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Current Round Rules Preview */}
                  <div className="lg:col-span-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-center space-y-2.5">
                    {t.join_code && (user?.isAdmin || detail?.isCreator) && (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                        <div className="text-left">
                          <div className="text-[10px] font-semibold text-[var(--text-muted)]">{'M\u00e3 tham gia gi\u1ea3i'}</div>
                          <div className="font-mono text-lg font-bold tracking-[0.2em] text-amber-300">{t.join_code}</div>
                        </div>
                        <button type="button" onClick={() => { navigator.clipboard.writeText(t.join_code!); notify('\u0110\u00e3 sao ch\u00e9p m\u00e3 gi\u1ea3i.', 'success'); }} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-black hover:bg-amber-300">
                          <Copy className="h-3.5 w-3.5" /> {'Sao ch\u00e9p'}
                        </button>
                      </div>
                    )}
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      {t.status === 'qualifying'
                        ? `Luật Vòng ${t.knockout_data?.current_round || 1}: ${previewRules?.title || 'Bàn chuẩn 9×9'}`
                        : 'Bàn chuẩn 9×9'}
                    </div>
                    <Board9x9
                      state={previewBoardState}
                      size="mini"
                      themeMode={themeMode}
                      showCoordinates={false}
                    />
                    {t.rules_schedule?.length ? (
                      <div className="space-y-1 pt-2 text-left">
                        <div className="text-[10px] font-semibold text-[var(--text-secondary)]">Luật theo vòng</div>
                        {t.rules_schedule.map((ruleId, index) => (
                          <div key={`${ruleId}-${index}`} className="flex justify-between gap-3 text-[10px]">
                            <span className={index + 1 === t.knockout_data?.current_round ? 'font-bold text-amber-400' : 'text-[var(--text-muted)]'}>
                              Vòng {index + 1} ({getKnockoutRoundName(index + 1, t.rules_schedule!.length)})
                            </span>
                            <span className={index + 1 === t.knockout_data?.current_round ? 'font-semibold text-amber-300' : 'text-[var(--text-muted)]'}>
                              {SPRINT_RULE_PRESETS[ruleId]?.title || ruleId}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Champion Banner */}
                {t.knockout_data?.champion_id && (
                  <div className="p-6 rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-amber-500/20 shadow-lg text-center space-y-3">
                    <div className="inline-flex p-3 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300">
                      <Trophy className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-extrabold text-amber-300">
                      CHÚC MỪNG NHÀ VÔ ĐỊCH GIẢI ĐẤU KNOCKOUT!
                    </h3>
                    <p className="text-sm text-[var(--text-primary)]">
                      Kỳ thủ xuất sắc nhất đã vượt qua tất cả các cặp đấu BO5 để giành chiếc Cúp vô địch danh giá.
                    </p>
                  </div>
                )}

                {/* 30-Minute Round Break Banner */}
                {t.knockout_data?.round_break_until && !t.knockout_data?.champion_id && (
                  <div className="p-4 rounded-xl border border-amber-500/50 bg-amber-500/10 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-amber-400 animate-pulse shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-amber-300">
                          Vòng đấu vừa hoàn thành! Đang nghỉ 30 phút giữa các vòng
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          Vòng tiếp theo: <strong>{getKnockoutRoundName(t.knockout_data.current_round, t.knockout_data.total_rounds)}</strong>. Các kỳ thủ có thể tinh chỉnh bot trong Phòng Lab!
                        </div>
                      </div>
                    </div>
                    {user?.isAdmin && (
                      <button
                        type="button"
                        disabled={submittingAction}
                        onClick={() => handleSkipKnockoutBreak(t.id)}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                      >
                        Bỏ qua nghỉ 30 phút (Admin)
                      </button>
                    )}
                  </div>
                )}

                {/* Visual Knockout Bracket Tree */}
                {t.knockout_data?.matchups && t.knockout_data.matchups.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-amber-400" />
                        Cây Phân Nhánh Thi Đấu Loại Trực Tiếp (Bracket)
                      </h3>
                      <span className="text-xs text-[var(--text-muted)]">
                        Thể thức BO5 · Chạm 3 ván thắng đi tiếp
                      </span>
                    </div>

                    <div className="overflow-x-auto pb-4">
                      <div className="flex min-w-max gap-3">
                        {Array.from({ length: t.knockout_data!.total_rounds }, (_, roundIndex) => {
                          const round = roundIndex + 1;
                          const roundMatches = t.knockout_data!.matchups.filter((item: any) => item.round === round);
                          return (
                            <section key={round} className="w-64 space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
                              <h4 className="text-xs font-bold text-amber-300">{getKnockoutRoundName(round, t.knockout_data!.total_rounds)}</h4>
                              {roundMatches.map((matchup: any) => {
                                const canLaunch = round === t.knockout_data!.current_round && matchup.player1_id && matchup.player2_id &&
                                  ['ready', 'waiting_break'].includes(matchup.status) &&
                                  (user?.isAdmin || user?.id === matchup.player1_id || user?.id === matchup.player2_id);
                                return (
                                  <div key={matchup.id} className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-2.5 text-[11px]">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="truncate">{matchup.player1_name || 'Chờ xác định'}</span>
                                      <strong className="shrink-0 text-amber-300">{matchup.score1} : {matchup.score2}</strong>
                                      <span className="truncate text-right">{matchup.player2_name || 'Chờ xác định'}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[var(--text-muted)]">
                                      <span>{matchup.status === 'completed' ? (matchup.winner_id ? 'Đã hoàn tất' : 'Chờ xử lý') : matchup.status === 'in_progress' ? 'Đang thi đấu' : matchup.status === 'waiting_break' ? 'Đang nghỉ' : matchup.status === 'ready' ? 'Sẵn sàng' : 'Chờ cặp trước'}</span>
                                      {canLaunch && (
                                        <button type="button" disabled={submittingAction} onClick={() => handleLaunchKnockoutMatch(t.id, matchup.id)} className="rounded-md bg-amber-400 px-2 py-1 font-semibold text-black disabled:opacity-50">
                                          Bắt đầu ván {matchup.current_game || 1}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* If registration status: show registered participants */}
                {t.status === 'registration' && (
                  <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Users className="w-4 h-4 text-amber-400" />
                        Danh sách kỳ thủ đã đăng ký ({detail.participantCount}/{t.max_teams})
                      </h3>
                      {user?.isAdmin && (
                        <button
                          type="button"
                          disabled={submittingAction}
                          onClick={() => handleStartTournamentNow(t.id)}
                          className="px-4 py-1.5 rounded-xl text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 shadow-sm transition-colors"
                        >
                          Bốc thăm & Khởi tranh Knockout ngay (Admin)
                        </button>
                      )}
                    </div>

                    {detail.participantCount === 0 ? (
                      <p className="text-xs text-[var(--text-muted)] py-4 text-center">
                        Chưa có kỳ thủ nào đăng ký. Hãy là người đầu tiên ghi danh!
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {Array.from({ length: t.max_teams }, (_, idx) => {
                          const entry = myEntry && idx === 0 ? myEntry : null;
                          const isOccupied = idx < detail.participantCount;
                          return (
                            <div
                              key={idx}
                              className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                                isOccupied
                                  ? 'border-amber-500/30 bg-amber-500/5 text-[var(--text-primary)]'
                                  : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] opacity-40 text-[var(--text-muted)]'
                              }`}
                            >
                              <div className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-[11px] shrink-0">
                                {idx + 1}
                              </div>
                              <div className="truncate">
                                <div className="font-semibold truncate">
                                  {isOccupied ? (entry ? user?.displayName : `Kỳ thủ #${idx + 1}`) : 'Chỗ trống'}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)]">
                                  {isOccupied ? 'Đã sẵn sàng' : 'Chờ đăng ký'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Match History & Replays */}
                {myMatches.length > 0 && (
                  <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4">
                    <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                      <Film className="w-4 h-4 text-amber-400" />
                      Lịch sử các ván đấu của bạn trong giải
                    </h3>
                    <div className="space-y-2">
                      {myMatches.map((m: any) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-[var(--text-primary)]">
                              {m.player1} vs {m.player2}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                m.winner_id === user?.id
                                  ? 'bg-green-500/20 text-green-300'
                                  : m.winner_id
                                  ? 'bg-red-500/20 text-red-300'
                                  : 'bg-zinc-500/20 text-zinc-300'
                              }`}
                            >
                              {m.winner_id === user?.id ? 'Thắng' : m.winner_id ? 'Thua' : 'Hòa'}
                            </span>
                          </div>
                          {m.replay_available && (
                            <button
                              type="button"
                              onClick={() => onWatchReplayById(m.id, m.player1, m.player2)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 transition-colors cursor-pointer"
                            >
                              <Film className="w-3.5 h-3.5" />
                              Xem Replay
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showTournamentRules && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
                    onClick={(event) => {
                      if (event.target === event.currentTarget) setShowTournamentRules(false);
                    }}
                  >
                    <section role="dialog" aria-modal="true" aria-labelledby="knockout-rules-heading" className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-amber-500/30 bg-[var(--bg-elevated)] p-5 shadow-2xl sm:p-7">
                      <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
                        <div className="flex items-center gap-3">
                          <BookOpen className="h-5 w-5 text-amber-400" aria-hidden="true" />
                          <h3 id="knockout-rules-heading" className="text-lg font-bold text-[var(--text-primary)]">{'Th\u1ec3 l\u1ec7 gi\u1ea3i Knockout'}</h3>
                        </div>
                        <button type="button" autoFocus onClick={() => setShowTournamentRules(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">{'\u0110\u00f3ng'}</button>
                      </div>
                      <div className="space-y-5 pt-5 text-sm leading-7 text-[var(--text-secondary)]">
                        <section className="space-y-2">
                          <h4 className="font-bold text-amber-300">{'Th\u1ec3 th\u1ee9c gi\u1ea3i \u0111\u1ea5u'}</h4>
                          <p>{'\u0110\u00e2y l\u00e0 gi\u1ea3i lo\u1ea1i tr\u1ef1c ti\u1ebfp d\u00e0nh cho 4, 8 ho\u1eb7c 16 k\u1ef3 th\u1ee7. Khi BTC b\u1eaft \u0111\u1ea7u, h\u1ec7 th\u1ed1ng b\u1ed1c th\u0103m ng\u1eabu nhi\u00ean v\u00e0 chia nh\u00e1nh thi \u0111\u1ea5u.'}</p>
                          <p>{'K\u1ef3 th\u1ee7 th\u1eafng c\u1eb7p \u0111\u1ea5u s\u1ebd v\u00e0o v\u00f2ng ti\u1ebfp theo; ng\u01b0\u1eddi thua b\u1ecb lo\u1ea1i. Ng\u01b0\u1eddi th\u1eafng tr\u1eadn chung k\u1ebft l\u00e0 nh\u00e0 v\u00f4 \u0111\u1ecbch.'}</p>
                          <p>{'M\u1ed7i c\u1eb7p \u0111\u1ea5u g\u1ed3m t\u1ed1i \u0111a 5 v\u00e1n. Ai th\u1eafng 3 v\u00e1n tr\u01b0\u1edbc s\u1ebd th\u1eafng c\u1eb7p v\u00e0 \u0111i ti\u1ebfp.'}</p>
                        </section>
                        <section className="space-y-2">
                          <h4 className="font-bold text-[var(--text-primary)]">{'M\u00e3 tham gia v\u00e0 bot'}</h4>
                          <p>{'M\u1ed7i gi\u1ea3i c\u00f3 m\u00e3 ri\u00eang. Nh\u1eadp m\u00e3 trong trang gi\u1ea3i \u0111\u1ec3 ghi danh. B\u1ea1n c\u00f3 th\u1ec3 l\u01b0u bot sau khi tham gia, nh\u01b0ng c\u1ea7n c\u00f3 bot \u0111\u00e3 l\u01b0u \u0111\u1ec3 t\u00ecm tr\u1eadn.'}</p>
                        </section>
                        <section className="space-y-2">
                          <h4 className="font-bold text-[var(--text-primary)]">{'Th\u1eddi gian gi\u1eefa c\u00e1c v\u00e1n v\u00e0 v\u00f2ng'}</h4>
                          <p>{'C\u00e1c v\u00e1n trong c\u00f9ng m\u1ed9t c\u1eb7p c\u00e1ch nhau 10 ph\u00fat \u0111\u1ec3 k\u1ef3 th\u1ee7 tinh ch\u1ec9nh bot. Sau khi ho\u00e0n t\u1ea5t m\u1ed9t v\u00f2ng, gi\u1ea3i ngh\u1ec9 30 ph\u00fat tr\u01b0\u1edbc khi b\u1eaft \u0111\u1ea7u v\u00f2ng ti\u1ebfp theo; BTC c\u00f3 th\u1ec3 b\u1ecf qua th\u1eddi gian ngh\u1ec9.'}</p>
                        </section>
                      </div>
                    </section>
                  </div>
                )}
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
                    {t.format === 'knockout' ? (
                      <div className="space-y-5">
                        <section className="space-y-2">
                          <h4 className="text-base font-bold text-amber-300">{'Th\u1ec3 th\u1ee9c Knockout BO5'}</h4>
                          <p>{'Gi\u1ea3i \u0111\u1ea5u lo\u1ea1i tr\u1ef1c ti\u1ebfp. H\u1ec7 th\u1ed1ng b\u1ed1c th\u0103m ng\u1eabu nhi\u00ean c\u00e1c c\u1eb7p \u0111\u1ea5u khi BTC b\u1eaft \u0111\u1ea7u gi\u1ea3i.'}</p>
                          <p>{'M\u1ed7i c\u1eb7p \u0111\u1ea5u t\u1ed1i \u0111a 5 v\u00e1n. K\u1ef3 th\u1ee7 th\u1eafng 3 v\u00e1n tr\u01b0\u1edbc s\u1ebd gi\u00e0nh chi\u1ebfn th\u1eafng c\u1eb7p v\u00e0 \u0111i ti\u1ebfp.'}</p>
                        </section>
                        <section className="space-y-2">
                          <h4 className="font-bold text-[var(--text-primary)]">{'Tham gia gi\u1ea3i'}</h4>
                          <p>{'Nh\u1eadp m\u00e3 ri\u00eang c\u1ee7a gi\u1ea3i trong trang chi ti\u1ebft \u0111\u1ec3 ghi danh. Kh\u00f4ng c\u1ea7n l\u01b0u bot khi tham gia; b\u1ea1n c\u1ea7n l\u01b0u bot tr\u01b0\u1edbc khi t\u00ecm tr\u1eadn.'}</p>
                        </section>
                        <section className="space-y-2">
                          <h4 className="font-bold text-[var(--text-primary)]">{'Lu\u1eadt thi \u0111\u1ea5u'}</h4>
                          <ul className="list-disc space-y-1 pl-5 marker:text-amber-400">
                            <li>{'M\u1ed7i v\u00f2ng c\u00f3 th\u1ec3 d\u00f9ng lu\u1eadt b\u00e0n ri\u00eang; l\u1ecbch lu\u1eadt hi\u1ec3n trong chi ti\u1ebft gi\u1ea3i.'}</li>
                            <li>{'Ngh\u1ec9 10 ph\u00fat gi\u1eefa c\u00e1c v\u00e1n trong c\u00f9ng c\u1eb7p \u0111\u1ea5u.'}</li>
                            <li>{'Ngh\u1ec9 30 ph\u00fat gi\u1eefa c\u00e1c v\u00f2ng; BTC c\u00f3 th\u1ec3 b\u1ecf qua th\u1eddi gian ngh\u1ec9.'}</li>
                          </ul>
                        </section>
                      </div>
                    ) : (
                      <div className="space-y-5">
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
                    )}
                  </div>
                </section>
              </div>
            )}
              </>
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

        {user?.isAdmin && !showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Tạo giải đấu mới (BTC)
          </button>
        )}
      </div>



      {/* Collapsible Admin Create Tournament Panel */}
      {showCreateForm && user?.isAdmin && (
        <form
          onSubmit={handleCreateTournament}
          className="p-6 rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-elevated)] space-y-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Plus className="w-5 h-5 text-[var(--accent-primary)]" />
              Khởi tạo Giải đấu Mới (Dành cho Ban Tổ Chức)
            </h3>
            <span className="text-xs text-[var(--text-muted)]">
              Quyền quản trị viên BTC
            </span>
          </div>

          {/* Chọn Loại Thể Thức Giải Đấu */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">
              Lựa chọn thể thức thi đấu
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setNewFormat('knockout')}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  newFormat === 'knockout'
                    ? 'border-amber-500 bg-amber-500/10 shadow-md ring-1 ring-amber-500/30'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-accent)]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    Đấu Cúp Loại Trực Tiếp (Knockout Cup)
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">
                    Khuyên dùng
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Bốc thăm chia nhánh ngẫu nhiên (4, 8 hoặc 16 người) · Đấu chuỗi 5 ván (BO5) phân thắng bại · Nghỉ 10p giữa các ván để sửa bot · Nghỉ 30p giữa các vòng để nghỉ và tinh chỉnh bot.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setNewFormat('ranked_weekly')}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  newFormat === 'ranked_weekly'
                    ? 'border-[var(--accent-primary)] bg-[var(--bg-panel)] shadow-md ring-1 ring-[var(--accent-primary)]/30'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-accent)]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Award className="w-4 h-4 text-[var(--accent-primary)]" />
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    Đấu Trường Thăng Hạng Rank (Ranked Sprint)
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Đấu xếp hạng phân tầng (Đồng → Bạc → Vàng → Cao Thủ → Thách Đấu) · Reset hạng theo chu kỳ 4 Sprint tuần.
                </p>
              </button>
            </div>
          </div>

          {/* Tên & Mô tả giải đấu */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Tên giải đấu</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={
                  newFormat === 'knockout'
                    ? 'Ví dụ: Cúp Vô Địch AI Đột Phá Mùa 1'
                    : 'Ví dụ: Đấu Trường Trăng Máu Mùa 2'
                }
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">
                Thời gian mở đăng ký (ngày)
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={regDays}
                onChange={(e) => setRegDays(Number(e.target.value))}
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
              placeholder="Mô tả ngắn gọn điều kiện tham dự, phần thưởng và lưu ý…"
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>

          {/* Phần Cấu hình Riêng theo Thể Thức */}
          {newFormat === 'knockout' ? (
            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-0.5">
                    Quy mô số kỳ thủ tham gia (Loại trực tiếp)
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Hệ thống sẽ tự động bốc thăm ngẫu nhiên các cặp đấu khi BTC bấm bắt đầu
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {([8, 16, 4] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setKnockoutSize(sz)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                        knockoutSize === sz
                          ? 'bg-amber-500 text-black border-amber-400 font-bold'
                          : 'bg-[var(--bg-canvas)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {sz} Kỳ thủ ({Math.log2(sz)} vòng)
                    </button>
                  ))}
                </div>
              </div>

              {/* Thông số quy chuẩn Knockout */}
              <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  Chọn luật cho từng vòng đấu
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: Math.log2(knockoutSize) }, (_, roundIndex) => (
                    <label key={roundIndex} className="space-y-1 text-[11px]">
                      <span className="block font-semibold text-amber-400">
                        Vòng {roundIndex + 1}: {getKnockoutRoundName(roundIndex + 1, Math.log2(knockoutSize))}
                      </span>
                      <select
                        value={knockoutRules[roundIndex] || 'standard'}
                        onChange={(event) => {
                          const next = [...knockoutRules];
                          next[roundIndex] = event.target.value;
                          setKnockoutRules(next);
                        }}
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[var(--text-primary)]"
                      >
                        {Object.values(SPRINT_RULE_PRESETS).map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.title}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-[11px] text-[var(--text-secondary)]">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                  <Swords className="w-4 h-4 text-amber-400 shrink-0" />
                  <span><strong>Best of 5:</strong> Đấu tối đa 5 ván, chạm 3 ván thắng là thắng cặp</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span><strong>Nghỉ 10 phút/ván:</strong> Kỳ thủ cải tiến bot sau mỗi ván đấu</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                  <FastForward className="w-4 h-4 text-amber-400 shrink-0" />
                  <span><strong>Nghỉ 30 phút/vòng:</strong> Thời gian nghỉ giữa các vòng</span>
                </div>
              </div>
            </div>
          ) : (
            /* Ranked Weekly Settings */
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                    Số kỳ thủ tối đa
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={256}
                    value={newMaxPlayers}
                    onChange={(e) => setNewMaxPlayers(Number(e.target.value))}
                    className="w-full px-3 py-1.5 font-mono rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                    Số Sprint Thực chiến (7 ngày/Sprint)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={sprintCount}
                    onChange={(e) => {
                      const nextCount = Math.min(
                        52,
                        Math.max(1, Math.floor(Number(e.target.value) || 1))
                      );
                      setSprintCount(nextCount);
                      setSprintSchedule((current) =>
                        Array.from(
                          { length: nextCount },
                          (_, index) =>
                            current[index] ||
                            DEFAULT_SPRINT_SCHEDULE[index % DEFAULT_SPRINT_SCHEDULE.length]
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
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-2 border-t border-[var(--border-subtle)]">
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
              {submittingAction
                ? 'Đang khởi tạo…'
                : newFormat === 'knockout'
                ? 'Công bố Giải Đấu Cúp Knockout'
                : 'Công bố Giải đấu Rank'}
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        t.format === 'knockout'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      }`}
                    >
                      {t.format === 'knockout' ? '🏆 Cúp Knockout BO5' : 'Đấu Trường Rank'}
                    </span>
                    <span className="text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                      {t.status === 'qualifying'
                        ? t.format === 'knockout'
                          ? `Vòng ${t.knockout_data?.current_round || 1}/${t.knockout_data?.total_rounds || 3}`
                          : `Thực Chiến · Sprint ${t.current_week || 1}/${t.total_sprints}`
                        : t.status === 'registration'
                        ? 'Mở Đăng Ký'
                        : 'Đã Kết Thúc'}
                      {' · '}
                      {t.participant_count || 0}/{t.max_teams} kỳ thủ
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
                    {t.name}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                    {t.description}
                  </p>
                  {user?.isAdmin && t.format === 'knockout' && t.join_code && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <div>
                        <div className="text-[10px] font-semibold text-[var(--text-muted)]">Mã tham gia giải này</div>
                        <div className="font-mono text-base font-bold tracking-[0.2em] text-amber-300">{t.join_code}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigator.clipboard.writeText(t.join_code!);
                          notify('Đã sao chép mã giải.', 'success');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-black hover:bg-amber-300"
                      >
                        <Copy className="h-3.5 w-3.5" /> Sao chép
                      </button>
                    </div>
                  )}
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
