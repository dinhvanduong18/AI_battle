import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Award,
  Calendar,
  Film,
  Loader2,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
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
  themeMode: 'halloween' | 'standard';
  tournaments: TournamentItem[];
  onRefreshTournaments: () => Promise<void>;
  onOpenAuth: (tab?: 'login' | 'register' | 'profile') => void;
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
  themeMode,
  tournaments,
  onRefreshTournaments,
  onOpenAuth,
  onWatchReplayById,
}) => {
  const { notify } = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | 'qualifying' | 'registration' | 'completed'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [queuingTournament, setQueuingTournament] = useState(false);

  // Create Tournament Form State (Admin / BTC)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newMaxPlayers, setNewMaxPlayers] = useState(64);
  const [regDays, setRegDays] = useState(3);
  const [durationDays, setDurationDays] = useState(28);
  const [sprintSchedule, setSprintSchedule] = useState<string[]>([
    'standard',
    'center_blockers',
    'clipped_corners',
    'corridor',
  ]);

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
    return () => {
      offSearching();
      offCancelled();
      offFound();
    };
  }, []);

  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingAction(true);
    try {
      const now = Date.now();
      const registrationClosesAt = new Date(now + regDays * 86400000).toISOString();
      const endsAt = new Date(now + (regDays + durationDays) * 86400000).toISOString();
      const created = await backendClient.createTournament({
        name: newName,
        format: 'ranked_weekly',
        description: newDesc,
        registrationClosesAt,
        endsAt,
        maxTeams: newMaxPlayers,
        sprintRules: sprintSchedule,
      });
      await onRefreshTournaments();
      setShowCreateForm(false);
      setNewName('');
      setNewDesc('');
      notify('Đã tạo giải đấu mới thành công!', 'success');
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
      notify('Đã đăng ký tham gia giải đấu! Bạn có thể tìm trận ngay.', 'success');
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
      notify('Đã mở Vòng Đua Hạng chính thức (Sprint 1)!', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể bắt đầu giải đấu.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleFindMatch = async (tournamentId: string) => {
    if (!user) {
      onOpenAuth('login');
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

  const handleSparringTournament = async (tournamentId: string) => {
    if (!user) {
      onOpenAuth('login');
      return;
    }
    try {
      await backendClient.findSparringMatch('bot', tournamentId);
    } catch (err: any) {
      notify(err.message || 'Không thể tạo trận đấu giải với Hắc Kỵ Sĩ AI.', 'error');
    }
  };

  // ── DETAIL VIEW FOR SELECTED TOURNAMENT ───────────────────────
  if (selectedId) {
    const t: TournamentItem | undefined = detail?.tournament;
    const myEntry = detail?.myEntry;
    const standings: any[] = detail?.standings || [];
    const participantNames: string[] = detail?.participants || [];
    const showPublicStandings = Array.isArray(detail?.standings);
    const myMatches: any[] = detail?.matches || [];
    const ranks: any[] = detail?.ranks || [];

    const previewRules =
      t?.status === 'qualifying' && t?.rules_json?.blockedCells
        ? t.rules_json
        : buildRulesFromPreset(t?.rules_schedule?.[0] || 'standard', 1);
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Danh sách Giải đấu
          </button>

          {user?.isAdmin && t?.status === 'registration' && (
            <button
              type="button"
              disabled={submittingAction}
              onClick={() => handleStartTournamentNow(t.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-[var(--border-accent)] bg-[var(--bg-panel)] text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] cursor-pointer whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4" />
              BTC: Mở Vòng Đua Hạng ngay
            </button>
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
                      ? `Đang thi đấu tính Sao · Sprint ${t.current_week || 1}`
                      : t.status === 'registration'
                      ? 'Đang mở đăng ký · Vòng Chạy Đà thử nghiệm'
                      : 'Giải đấu đã kết thúc'}
                    {' · '}
                    {detail.participantCount}/{t.max_teams} kỳ thủ cá nhân
                  </div>
                  <h2 className="text-2xl font-bold text-[var(--text-primary)]">{t.name}</h2>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    {t.description || 'Giải đấu xếp hạng cá nhân Bot Python 3 theo Sprint hàng tuần.'}
                  </p>
                </div>

                {/* 5-Tier Progression Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                  {ranks.map((rk: any) => {
                    const isCurrent = myEntry?.tier === rk.tier;
                    return (
                      <div
                        key={rk.tier}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border ${
                          isCurrent
                            ? 'border-[var(--border-accent)] bg-[var(--bg-panel)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)]'
                        }`}
                      >
                        <RankCrestSvg tier={rk.tier} />
                        <div className="min-w-0">
                          <div className={`text-xs font-bold truncate ${TIER_COLORS[rk.tier] || ''}`}>
                            {rk.label}
                          </div>
                          <div className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                            {rk.tier === 'Challenger' ? 'Điểm mùa' : `${rk.starsToPromote} Sao`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* My Entry Status + Action Controls */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-subtle)]">
                  {myEntry ? (
                    <div className="text-xs text-[var(--text-secondary)] tabular-nums">
                      Hạng của bạn:{' '}
                      <strong className={TIER_COLORS[myEntry.tier] || 'text-[var(--text-primary)]'}>
                        {TIER_VIET[myEntry.tier] || myEntry.tier}
                      </strong>{' '}
                      · {myEntry.rank_stars} Sao · Thắng {myEntry.wins} / Thua {myEntry.losses}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--text-muted)]">
                      Bạn chưa ghi danh vào giải đấu này.
                    </div>
                  )}

                  {t.status !== 'completed' && (
                    <div className="flex flex-wrap items-center gap-2.5">
                      {!myEntry ? (
                        <button
                          type="button"
                          disabled={submittingAction}
                          onClick={() => handleRegister(t.id)}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer whitespace-nowrap"
                        >
                          <Trophy className="w-4 h-4" />
                          Đăng ký tham gia giải
                        </button>
                      ) : queuingTournament ? (
                        <button
                          type="button"
                          onClick={() => {
                            backendClient.cancelMatch();
                            setQueuingTournament(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 cursor-pointer whitespace-nowrap"
                        >
                          <XCircle className="w-4 h-4" />
                          Đang tìm đối thủ giải… (Hủy)
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleFindMatch(t.id)}
                            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer whitespace-nowrap"
                          >
                            <Swords className="w-4 h-4" />
                            {t.status === 'qualifying' ? 'Tìm trận Đua Hạng' : 'Tìm trận Chạy Đà'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSparringTournament(t.id)}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] cursor-pointer whitespace-nowrap"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                            Đấu giải với Hắc Kỵ Sĩ AI
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Active Sprint Map Obstacle Preview */}
              <div className="lg:col-span-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-center space-y-2.5">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  Bản đồ hiện tại: {previewRules?.title || 'Bàn chuẩn 9×9'}
                </div>
                <Board9x9
                  state={previewBoardState}
                  size="mini"
                  themeMode={themeMode}
                  showCoordinates={false}
                />
                <div className="text-[11px] text-[var(--text-muted)]">
                  Lịch 4 Sprint:{' '}
                  {(t.rules_schedule || ['standard', 'center_blockers', 'clipped_corners', 'corridor'])
                    .map((key) => SPRINT_RULE_PRESETS[key]?.title || key)
                    .join(' → ')}
                </div>
              </div>
            </div>

            {/* Standings + My Tournament Matches */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Award className="w-4 h-4 text-[var(--accent-primary)]" />
                    {showPublicStandings
                      ? detail?.sprintStandings?.temporary
                        ? `Bảng Sprint ${detail?.sprintStandings?.sprint}`
                        : 'Bảng xếp hạng chung cuộc'
                      : 'Danh sách kỳ thủ đã đăng ký'}
                  </h3>
                  <span className="text-xs text-[var(--text-muted)] tabular-nums">
                    {showPublicStandings ? standings.length : participantNames.length} kỳ thủ
                  </span>
                </div>

                {!showPublicStandings ? (
                  participantNames.length > 0 ? (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {participantNames.map((name, index) => (
                        <li key={index} className="px-3 py-2 rounded-lg bg-[var(--bg-canvas)] text-[var(--text-primary)]">
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-8 text-center text-xs text-[var(--text-muted)]">
                      Chưa có kỳ thủ nào đăng ký giải đấu này.
                    </p>
                  )
                ) : standings.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[var(--text-muted)]">
                    Chưa có bảng xếp hạng được công bố.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                          <th className="py-2 pr-2 font-medium w-10">#</th>
                          <th className="py-2 px-2 font-medium">Kỳ thủ</th>
                          <th className="py-2 px-2 font-medium">Bậc hạng</th>
                          <th className="py-2 px-2 font-medium text-right">Sao / Điểm</th>
                          <th className="py-2 pl-2 font-medium text-right">Thắng - Thua</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                        {standings.map((row, idx) => {
                          const isMe = user?.id === row.player_id;
                          return (
                            <tr
                              key={row.player_id}
                              className={isMe ? 'bg-[var(--p1-bg)]' : 'hover:bg-[var(--bg-hover)]/40'}
                            >
                              <td className="py-2.5 pr-2 font-mono text-[var(--text-secondary)]">
                                {String(idx + 1).padStart(2, '0')}
                              </td>
                              <td className="py-2.5 px-2 font-medium text-[var(--text-primary)]">
                                {row.display_name}
                                {isMe && (
                                  <span className="text-[var(--accent-primary)] ml-1.5">· Bạn</span>
                                )}
                              </td>
                              <td className={`py-2.5 px-2 font-semibold ${TIER_COLORS[row.tier] || ''}`}>
                                {TIER_VIET[row.tier] || row.tier}
                              </td>
                              <td className="py-2.5 px-2 text-right font-mono text-[var(--text-primary)]">
                                <span className="inline-flex items-center justify-end gap-1">
                                  <Star className="w-3 h-3 text-amber-400" />
                                  {row.rank_stars}
                                  {row.season_points > 0 ? ` (+${row.season_points}đ)` : ''}
                                </span>
                              </td>
                              <td className="py-2.5 pl-2 text-right font-mono text-[var(--text-secondary)]">
                                {row.wins}W - {row.losses}L
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="lg:col-span-5 p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4">
                <h3 className="text-base font-bold text-[var(--text-primary)]">
                  Trận đấu của bạn trong giải
                </h3>
                {!user ? (
                  <p className="py-6 text-xs text-[var(--text-muted)]">
                    Đăng nhập để theo dõi các ván đấu thuộc giải này.
                  </p>
                ) : myMatches.length === 0 ? (
                  <p className="py-6 text-xs text-[var(--text-muted)]">
                    Chưa có ván đấu nào trong giải này.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)] text-xs tabular-nums">
                    {myMatches.map((m) => {
                      const won = m.winner_id === user.id;
                      const isDraw = m.status === 'completed' && m.winner_id === null;
                      return (
                        <div key={m.id} className="py-3 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-[var(--text-primary)]">
                              {m.player1} vs {m.player2}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                              {m.tournament_phase === 'ranked' ? 'Đua Hạng' : 'Chạy Đà'} ·{' '}
                              {m.status === 'completed' ? (
                                <span className={isDraw ? 'text-[var(--text-secondary)]' : won ? 'text-emerald-400' : 'text-red-400'}>
                                  {isDraw ? 'Hòa' : won ? 'Thắng (+1 Sao)' : 'Thua'}
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
          </>
        )}
      </div>
    );
  }

  // ── TOURNAMENT DIRECTORY LIST VIEW ────────────────────────────
  const filteredList = tournaments.filter((t) =>
    statusFilter === 'all' ? true : t.status === statusFilter
  );

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      {!showCreateForm && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            {(
              [
                { id: 'all', label: 'Tất cả giải' },
                { id: 'qualifying', label: 'Đang đua hạng' },
                { id: 'registration', label: 'Mở đăng ký' },
                { id: 'completed', label: 'Đã kết thúc' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-[var(--bg-panel)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {user?.isAdmin ? (
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Tạo giải đấu mới (BTC)
            </button>
          ) : (
            user && (
              <button
                type="button"
                onClick={() => onOpenAuth('profile')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                Cấp quyền BTC thử nghiệm
              </button>
            )
          )}
        </div>
      )}

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
                Số kỳ thủ tối đa
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
              placeholder="Mô tả ngắn gọn lịch thi đấu và giải thưởng…"
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                Mở đăng ký (ngày)
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
                Thời lượng giải (ngày)
              </label>
              <input
                type="number"
                min={7}
                max={90}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full px-3 py-1.5 font-mono rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              />
            </div>
            {[0, 1, 2, 3].map((sprintIdx) => (
              <div key={sprintIdx}>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Bản đồ Sprint {sprintIdx + 1}
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

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submittingAction}
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer"
            >
              {submittingAction ? 'Đang khởi tạo…' : 'Công bố Giải đấu'}
            </button>
          </div>
        </form>
      )}

      {/* Tournament Cards Grid */}
      {!showCreateForm && (
        filteredList.length === 0 ? (
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
                  className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col justify-between space-y-5 hover:border-[var(--border-accent)] transition-colors"
                >
                  <div className="space-y-2.5">
                    <div className="text-xs font-medium text-[var(--accent-primary)] tabular-nums">
                      {t.status === 'qualifying'
                        ? `Đang Đua Hạng · Sprint ${t.current_week || 1}`
                        : t.status === 'registration'
                        ? 'Mở Đăng Ký & Vòng Chạy Đà'
                        : 'Đã Kết Thúc'}
                      {' · '}
                      {t.participant_count || 0}/{t.max_teams} kỳ thủ
                    </div>

                    <h3 className="text-xl font-bold text-[var(--text-primary)]">{t.name}</h3>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                      {t.description}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] tabular-nums">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Kết thúc: {endDate}</span>
                      {t.rules_json?.title && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{t.rules_json.title}</span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Xem chi tiết & Thi đấu
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};
