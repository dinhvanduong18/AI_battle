import React, { useEffect, useState } from 'react';
import { KeyRound, LogOut, X } from 'lucide-react';
import {
  backendClient,
  getMatchEloLabel,
  getMatchFormatLabel,
  type BackendUser,
  type MatchSummary,
  type PlayerAvatarId,
} from '../core/backendClient';
import { useToast } from './ToastProvider';

export type ModalTab = 'login' | 'register' | 'profile';

export const PLAYER_AVATARS: { id: PlayerAvatarId; emoji: string; label: string }[] = [
  { id: 'pumpkin', emoji: '🎃', label: 'Bí Ngô' },
  { id: 'ghost', emoji: '👻', label: 'Bóng Ma' },
  { id: 'bat', emoji: '🦇', label: 'Dơi Đêm' },
  { id: 'knight', emoji: '🛡️', label: 'Kỵ Sĩ' },
  { id: 'fox', emoji: '🦊', label: 'Cáo Lửa' },
  { id: 'crown', emoji: '👑', label: 'Quân Vương' },
];

interface AuthSettingsModalProps {
  open: boolean;
  initialTab: ModalTab;
  user: BackendUser | null;
  matches: MatchSummary[];
  onClose: () => void;
  onUserUpdated: (user: BackendUser | null) => void;
}

export const AuthSettingsModal: React.FC<AuthSettingsModalProps> = ({
  open,
  initialTab,
  user,
  matches,
  onClose,
  onUserUpdated,
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

  useEffect(() => {
    if (open) {
      setTab(user ? 'profile' : initialTab === 'profile' ? 'login' : initialTab);
      setNewDisplayName(user?.displayName || '');
      setCurrentPassword('');
      setNewPassword('');
    }
  }, [open, initialTab, user]);

  if (!open) return null;

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

  const handleAvatarChange = async (avatarId: PlayerAvatarId) => {
    if (avatarId === (user?.avatarId || 'pumpkin')) return;
    setLoading(true);
    try {
      const updated = await backendClient.updateProfile({ avatarId });
      onUserUpdated(updated);
      notify('Đã cập nhật diện mạo kỳ thủ.', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể cập nhật diện mạo.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const completedMatches = user
    ? matches.filter(
        (match) =>
          match.status === 'completed' &&
          !match.is_sparring &&
          match.tournament_phase !== 'practice'
      )
    : [];
  const wins = completedMatches.filter((match) => match.winner_id === user?.id).length;
  const draws = completedMatches.filter((match) => !match.winner_id).length;
  const losses = completedMatches.length - wins - draws;
  const winRate = completedMatches.length
    ? Math.round((wins / completedMatches.length) * 100)
    : 0;
  const rank =
    (user?.elo ?? 0) >= 1600 ? 'Vàng' : (user?.elo ?? 0) >= 1350 ? 'Bạc' : 'Đồng';
  const recentCompletedMatches = completedMatches.slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[#161024] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
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

              <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
                Tài khoản mẫu sẵn có ở Local:{' '}
                <code className="text-[var(--text-primary)]">admin@ottv2.local</code> · Mật khẩu:{' '}
                <code className="text-[var(--text-primary)]">halloween2026</code>
              </div>

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
              <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-[var(--text-secondary)]">Hạng kỳ thủ</p>
                    <p className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                      {rank} <span className="text-sm font-medium text-[var(--text-muted)]">· {user.elo} Elo</span>
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-3 py-1 text-xs font-semibold text-[var(--accent-primary)]">
                    Tỷ lệ thắng {winRate}%
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ['Số trận', completedMatches.length],
                    ['Thắng', wins],
                    ['Thua', losses],
                    ['Hòa', draws],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-[var(--bg-panel)] px-3 py-2 text-center">
                      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
                      <p className="mt-0.5 text-sm font-bold tabular-nums text-[var(--text-primary)]">{value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Lịch sử thi đấu</h3>
                  <span className="text-[10px] text-[var(--text-muted)]">5 trận gần nhất</span>
                </div>
                {recentCompletedMatches.length ? (
                  <div className="space-y-2">
                    {recentCompletedMatches.map((match) => {
                      const isDraw = !match.winner_id;
                      const won = match.winner_id === user.id;
                      const eloLabel = getMatchEloLabel(match, user.id);
                      return (
                        <div
                          key={match.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-panel)] px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                              {match.player1} <span className="text-[var(--text-muted)]">vs</span> {match.player2}
                            </p>
                            <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                              {getMatchFormatLabel(match)} ·{' '}
                              {new Date(match.created_at).toLocaleDateString('vi-VN')}
                            </p>
                          </div>
                          <p
                            className={`text-xs font-semibold tabular-nums ${
                              isDraw
                                ? 'text-amber-300'
                                : won
                                ? 'text-emerald-400'
                                : 'text-red-400'
                            }`}
                          >
                            {isDraw ? 'Hòa' : won ? 'Thắng' : 'Thua'}
                            {eloLabel ? ` · ${eloLabel}` : ''}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="py-3 text-center text-xs text-[var(--text-muted)]">
                    Chưa có trận xếp hạng nào được ghi nhận.
                  </p>
                )}
              </section>

              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--p1-bg)] border border-[var(--p1-border)] flex items-center justify-center text-2xl">
                    {PLAYER_AVATARS.find((avatar) => avatar.id === (user.avatarId || 'pumpkin'))?.emoji || '🎃'}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-[var(--text-primary)]">
                      {user.displayName}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] tabular-nums">
                      {user.email} · Elo {user.elo} {user.isAdmin ? '· Quyền BTC' : ''}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    backendClient.clearSession();
                    onUserUpdated(null);
                    notify('Đã đăng xuất tài khoản.', 'info');
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-300 hover:bg-red-500/15 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Đăng xuất
                </button>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Chọn diện mạo kỳ thủ</label>
                  <div className="grid grid-cols-6 gap-2">
                    {PLAYER_AVATARS.map((avatar) => {
                      const selected = (user.avatarId || 'pumpkin') === avatar.id;
                      return (
                        <button
                          key={avatar.id}
                          type="button"
                          disabled={loading}
                          onClick={() => void handleAvatarChange(avatar.id)}
                          aria-label={`Chọn avatar ${avatar.label}`}
                          title={avatar.label}
                          className={`rounded-xl border p-2 text-xl transition-colors disabled:opacity-50 ${selected ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/15' : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--accent-primary)]'}`}
                        >
                          {avatar.emoji}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                <div className="flex justify-end pt-1">
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
