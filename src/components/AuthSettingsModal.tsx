import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Check,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  LogOut,
  Shield,
  Swords,
  User,
  X,
} from 'lucide-react';
import { backendClient, type BackendUser, type MatchSummary } from '../core/backendClient';
import { useToast } from './ToastProvider';

export type ModalTab = 'login' | 'register' | 'profile';

interface AuthSettingsModalProps {
  open: boolean;
  initialTab: ModalTab;
  user: BackendUser | null;
  matches: MatchSummary[];
  onClose: () => void;
  onUserUpdated: (user: BackendUser | null) => void;
  onWatchMatchReplay: (match: MatchSummary) => void;
}

export const PLAYER_AVATARS = [
  { id: 'pumpkin', emoji: '🎃', label: 'Bí Ngô', color: 'from-orange-500/30 to-amber-900/30' },
  { id: 'ghost', emoji: '👻', label: 'Bóng Ma', color: 'from-violet-500/30 to-indigo-900/30' },
  { id: 'bat', emoji: '🦇', label: 'Dơi Đêm', color: 'from-slate-400/20 to-slate-900/50' },
  { id: 'knight', emoji: '🛡️', label: 'Kỵ Sĩ', color: 'from-cyan-500/25 to-blue-900/40' },
  { id: 'fox', emoji: '🦊', label: 'Cáo Lửa', color: 'from-rose-500/25 to-orange-900/40' },
  { id: 'crown', emoji: '👑', label: 'Quân Vương', color: 'from-yellow-400/25 to-amber-900/40' },
] as const;

export const AuthSettingsModal: React.FC<AuthSettingsModalProps> = ({
  open,
  initialTab,
  user,
  matches,
  onClose,
  onUserUpdated,
  onWatchMatchReplay,
}) => {
  const { notify } = useToast();
  const [tab, setTab] = useState<ModalTab>(initialTab);
  const [loading, setLoading] = useState(false);

  // Auth states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Profile states
  const [newDisplayName, setNewDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [emailVisible, setEmailVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(user ? 'profile' : initialTab === 'profile' ? 'login' : initialTab);
      setNewDisplayName(user?.displayName || '');
      setCurrentPassword('');
      setNewPassword('');
      setEmailVisible(false);
    }
  }, [open, initialTab, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const logged = await backendClient.login(email, password);
      onUserUpdated(logged);
      notify(`Chào mừng trở lại, ${logged.displayName}!`, 'success');
      onClose();
    } catch (err: any) {
      notify(err.message || 'Đăng nhập thất bại.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const created = await backendClient.register(email, password, displayName);
      onUserUpdated(created);
      notify(`Đã tạo tài khoản ${created.displayName} (1200 Elo).`, 'success');
      onClose();
    } catch (err: any) {
      notify(err.message || 'Đăng ký thất bại.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: { displayName?: string; currentPassword?: string; newPassword?: string } = {};
      if (newDisplayName.trim() && newDisplayName.trim() !== user?.displayName) {
        payload.displayName = newDisplayName.trim();
      }
      if (newPassword || currentPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      if (!Object.keys(payload).length) {
        notify('Chưa có thay đổi nào để lưu.', 'info');
        setLoading(false);
        return;
      }
      const updated = await backendClient.updateProfile(payload);
      onUserUpdated(updated);
      setCurrentPassword('');
      setNewPassword('');
      notify('Đã cập nhật thông tin tài khoản.', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể cập nhật hồ sơ.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarChange = async (avatarId: BackendUser['avatarId']) => {
    if (!avatarId || avatarId === (user?.avatarId || 'pumpkin')) return;
    setLoading(true);
    try {
      const updated = await backendClient.updateProfile({ avatarId });
      onUserUpdated(updated);
      notify('Đã cập nhật avatar kỳ thủ.', 'success');
    } catch (err: any) {
      const message = String(err?.message || '');
      if (/nhập tên mới/i.test(message)) {
        notify(
          'Máy chủ chưa được cập nhật tính năng đổi avatar. Hãy triển khai lại backend từ phiên bản mới nhất rồi thử lại.',
          'error'
        );
      } else {
        notify(message || 'Không thể cập nhật avatar.', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const profileStats = useMemo(() => {
    const completed = matches.filter((match) => match.status === 'completed');
    const wins = completed.filter((match) => match.winner_id === user?.id).length;
    const draws = completed.filter((match) => match.winner_id === null).length;
    const losses = completed.length - wins - draws;
    const totalPlayed = user?.stats?.matchesPlayed ?? completed.length;
    const totalWins = user?.stats?.wins ?? wins;
    const totalDraws = user?.stats?.draws ?? draws;
    const totalLosses = user?.stats?.losses ?? losses;
    const winRate = totalPlayed ? Math.round((totalWins / totalPlayed) * 100) : 0;
    let streak = 0;
    for (const match of completed) {
      if (match.winner_id !== user?.id) break;
      streak++;
    }
    const rank = (user?.elo || 0) >= 1600 ? 'Vàng' : (user?.elo || 0) >= 1350 ? 'Bạc' : 'Đồng';
    const nextRankElo = rank === 'Đồng' ? 1350 : rank === 'Bạc' ? 1600 : null;
    const progress = nextRankElo
      ? Math.min(100, Math.max(0, (((user?.elo ?? 0) - (rank === 'Đồng' ? 1000 : 1350)) / (nextRankElo - (rank === 'Đồng' ? 1000 : 1350))) * 100))
      : 100;
    return {
      completed,
      wins: totalWins,
      draws: totalDraws,
      losses: totalLosses,
      totalPlayed,
      winRate,
      streak,
      rank,
      nextRankElo,
      progress
    };
  }, [matches, user?.elo, user?.id, user?.stats]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      role="presentation"
    >
      <div
        className={`w-full ${user ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[#161024] p-5 sm:p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-settings-modal-title"
      >
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)]">
          <h2 id="auth-settings-modal-title" className="text-lg font-bold text-[var(--text-primary)]">
            {user ? 'Hồ sơ Kỳ thủ OTTv2' : 'Đăng nhập Đấu Trường OTTv2'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Control Tabs (only when logged out) */}
        {!user && (
          <div className="flex items-center gap-1 p-1 mt-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setTab('login')}
              className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                tab === 'login'
                  ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => setTab('register')}
              className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                tab === 'register'
                  ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Tạo tài khoản
            </button>
          </div>
        )}

        <div className="mt-5">
          {tab === 'login' && !user && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Email đăng nhập
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Mật khẩu
                </label>
                <input
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ít nhất 10 ký tự"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>

              {import.meta.env.DEV && (
                <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
                  Tài khoản mẫu sẵn có ở Local:{' '}
                  <code className="text-[var(--text-primary)]">admin@ottv2.local</code> · Mật khẩu:{' '}
                  <code className="text-[var(--text-primary)]">halloween2026</code>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? 'Đang xác thực…' : 'Đăng nhập'}
              </button>
            </form>
          )}

          {tab === 'register' && !user && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Tên hiển thị trên bảng xếp hạng
                </label>
                <input
                  type="text"
                  required
                  maxLength={40}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ví dụ: ReaperBot VN"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Địa chỉ Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Mật khẩu bảo mật (tối thiểu 10 ký tự)
                </label>
                <input
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập ít nhất 10 ký tự"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? 'Đang khởi tạo…' : 'Tạo tài khoản mới (1200 Elo)'}
              </button>
            </form>
          )}

          {user && (
            <div className="space-y-5">
              <section className="relative overflow-hidden rounded-2xl border border-violet-300/15 bg-gradient-to-br from-[#281b3b] via-[#191327] to-[#11101a] p-5 sm:p-6">
                <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-orange-500/10 blur-3xl" />
                <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br ${PLAYER_AVATARS.find((avatar) => avatar.id === (user.avatarId || 'pumpkin'))?.color || 'from-orange-500/30 to-amber-900/30'} text-4xl shadow-lg`}>
                      {PLAYER_AVATARS.find((avatar) => avatar.id === (user.avatarId || 'pumpkin'))?.emoji || '🎃'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-xl font-black text-white">{user.displayName}</h3>
                        {user.isAdmin && <span className="rounded-full border border-orange-300/20 bg-orange-400/10 px-2 py-0.5 text-[10px] font-bold text-orange-200">BTC</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-violet-200/70">
                        <span>{emailVisible ? user.email : '••••••••••••••••'}</span>
                        <button
                          type="button"
                          onClick={() => setEmailVisible((visible) => !visible)}
                          aria-label={emailVisible ? 'Ẩn email đăng nhập' : 'Hiện email đăng nhập'}
                          title={emailVisible ? 'Ẩn email' : 'Hiện email'}
                          className="rounded p-1 hover:bg-white/10 hover:text-white"
                        >
                          {emailVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-white/40">MÃ KỲ THỦ · {user.id.slice(0, 8).toUpperCase()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="rounded-xl border border-amber-200/15 bg-amber-300/10 px-3 py-2 text-right">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-200/60">Hạng Elo</div>
                      <div className="text-sm font-black text-amber-100">{profileStats.rank}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        backendClient.clearSession();
                        onUserUpdated(null);
                        notify('Đã đăng xuất tài khoản.', 'info');
                        onClose();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/15"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Đăng xuất
                    </button>
                  </div>
                </div>

                <div className="relative mt-5 border-t border-white/10 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white/70">Chọn diện mạo kỳ thủ</span>
                    <span className="text-[10px] text-white/40">Avatar được lưu vào tài khoản</span>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {PLAYER_AVATARS.map((avatar) => {
                      const selected = (user.avatarId || 'pumpkin') === avatar.id;
                      return (
                        <button
                          key={avatar.id}
                          type="button"
                          disabled={loading}
                          onClick={() => handleAvatarChange(avatar.id)}
                          aria-label={`Chọn avatar ${avatar.label}`}
                          title={avatar.label}
                          className={`relative flex flex-col items-center gap-1 rounded-xl border p-2 transition-all disabled:opacity-50 ${selected ? 'border-orange-300/70 bg-orange-400/15 ring-1 ring-orange-300/20' : 'border-white/10 bg-black/15 hover:border-white/30 hover:bg-white/5'}`}
                        >
                          <span className="text-2xl">{avatar.emoji}</span>
                          <span className="text-[9px] text-white/60">{avatar.label}</span>
                          {selected && <Check className="absolute right-1 top-1 h-3 w-3 text-orange-200" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Elo hiện tại', value: user.elo.toLocaleString('vi-VN'), icon: Award, tone: 'text-amber-300' },
                  { label: 'Tỷ lệ thắng', value: `${profileStats.winRate}%`, icon: Shield, tone: 'text-emerald-300' },
                  { label: 'Trận đã đấu', value: profileStats.totalPlayed, icon: Swords, tone: 'text-sky-300' },
                  { label: 'Chuỗi thắng', value: profileStats.streak, icon: Award, tone: 'text-orange-300' },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.035] p-3.5">
                    <stat.icon className={`mb-2 h-4 w-4 ${stat.tone}`} />
                    <div className="text-xl font-black text-white">{stat.value}</div>
                    <div className="mt-0.5 text-[10px] text-white/50">{stat.label}</div>
                  </div>
                ))}
              </section>

              {profileStats.nextRankElo && (
                <div className="rounded-xl border border-white/10 bg-black/15 px-4 py-3">
                  <div className="mb-2 flex justify-between text-[11px]">
                    <span className="text-white/65">Tiến độ lên hạng {profileStats.rank === 'Đồng' ? 'Bạc' : 'Vàng'}</span>
                    <span className="font-semibold text-amber-200">{user.elo} / {profileStats.nextRankElo} Elo</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-200 transition-all" style={{ width: `${profileStats.progress}%` }} />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/15 bg-violet-300/5 px-3 py-1.5 text-[10px] font-semibold text-violet-100/80">
                  <Award className="h-3.5 w-3.5 text-violet-300" /> {profileStats.completed.length >= 20 ? 'Cựu binh đấu trường' : profileStats.completed.length >= 5 ? 'Chiến binh kỳ cựu' : 'Kỳ thủ mới'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-300/5 px-3 py-1.5 text-[10px] font-semibold text-emerald-100/80">
                  <Swords className="h-3.5 w-3.5 text-emerald-300" /> {profileStats.wins} thắng · {profileStats.draws} hòa · {profileStats.losses} thua
                </span>
              </div>

              <section className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">Lịch sử thi đấu</h3>
                    <p className="text-[10px] text-[var(--text-muted)]">5 trận gần nhất · Tỷ lệ thắng tính trên các trận đã hoàn tất</p>
                  </div>
                  <span className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-[var(--text-secondary)]">{profileStats.totalPlayed} trận</span>
                </div>
                {profileStats.completed.length ? (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {profileStats.completed.slice(0, 5).map((match) => {
                      const result = match.winner_id === null ? 'Hòa' : match.winner_id === user.id ? 'Thắng' : 'Thua';
                      const resultClass = result === 'Thắng' ? 'text-emerald-300' : result === 'Thua' ? 'text-rose-300' : 'text-amber-200';
                      return (
                        <div key={match.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-[var(--text-primary)]">
                              {match.match_type === 'bot' ? '1v1 Bot' : '1v1 Người'} <span className="text-[var(--text-muted)]">·</span> {new Date(match.created_at).toLocaleDateString('vi-VN')}
                            </div>
                            <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                              {match.elo_delta !== undefined && match.elo_delta !== 0 ? `Elo ${match.elo_delta > 0 ? '+' : ''}${match.elo_delta}` : 'Trận đã xác minh'}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className={`text-xs font-bold ${resultClass}`}>{result}</span>
                            {match.replay_available && (
                              <button
                                type="button"
                                onClick={() => onWatchMatchReplay(match)}
                                aria-label="Mở replay trận đấu"
                                className="rounded-md p-1 text-[var(--accent-primary)] hover:bg-white/10"
                              >
                                <Film className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">Chưa có trận đã hoàn tất. Vào đấu trường để ghi dấu trận đầu tiên!</div>
                )}
              </section>

              <form onSubmit={handleUpdateProfile} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Đổi tên hiển thị
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Mật khẩu hiện tại
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Nhập nếu đổi mật khẩu"
                      className="w-full px-3.5 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Mật khẩu mới
                    </label>
                    <input
                      type="password"
                      minLength={10}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Ít nhất 10 ký tự"
                      className="w-full px-3.5 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-colors cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Lưu thay đổi
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
