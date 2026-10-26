import React, { useEffect, useState } from 'react';
import {
  Bot,
  Camera,
  ChevronDown,
  History,
  KeyRound,
  LockKeyhole,
  LogOut,
  Swords,
  Trophy,
  Upload,
  X,
} from 'lucide-react';
import profileBackdrop from '../assets/images/halloween_castle_pumpkins_bg_1792817506446.jpg';
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
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [passwordFormOpen, setPasswordFormOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const avatarFileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTab(user ? 'profile' : initialTab === 'profile' ? 'login' : initialTab);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setAvatarPickerOpen(false);
      setPasswordFormOpen(false);
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

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      notify('Hãy nhập đủ mật khẩu hiện tại và hai lần mật khẩu mới.', 'error');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      notify('Mật khẩu mới nhập lại không khớp.', 'error');
      return;
    }
    if (newPassword.length < 10) {
      notify('Mật khẩu mới cần ít nhất 10 ký tự.', 'error');
      return;
    }
    if (!window.confirm('Bạn có chắc chắn muốn đổi mật khẩu mới không?')) return;

    setLoading(true);
    try {
      const updated = await backendClient.updateProfile({
        currentPassword,
        newPassword,
        confirmNewPassword,
      });
      onUserUpdated(updated);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordFormOpen(false);
      notify('Đã đổi mật khẩu thành công.', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể đổi mật khẩu.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarChange = async (avatarId: PlayerAvatarId) => {
    if (avatarId === (user?.avatarId || 'pumpkin') && !user?.avatarUrl) return;
    setLoading(true);
    try {
      const updated = await backendClient.updateProfile({ avatarId });
      onUserUpdated(updated);
      setAvatarPickerOpen(false);
      notify('Đã cập nhật diện mạo kỳ thủ.', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể cập nhật diện mạo.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Ảnh đại diện chỉ hỗ trợ PNG, JPEG hoặc WebP.', 'error');
      return;
    }
    if (file.size > 1024 * 1024) {
      notify('Ảnh đại diện cần có dung lượng tối đa 1 MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => notify('Không thể đọc file ảnh đã chọn.', 'error');
    reader.onload = async () => {
      if (typeof reader.result !== 'string') {
        notify('File ảnh không có dữ liệu hợp lệ.', 'error');
        return;
      }
      setLoading(true);
      try {
        const updated = await backendClient.updateProfile({ avatarDataUrl: reader.result });
        onUserUpdated(updated);
        setAvatarPickerOpen(false);
        notify('Đã tải ảnh đại diện lên thành công.', 'success');
      } catch (err: any) {
        notify(err.message || 'Không thể lưu ảnh đại diện.', 'error');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const completedMatches = user
    ? matches.filter(
        (match) =>
          match.status === 'completed' &&
          !match.is_sparring &&
          match.tournament_phase !== 'practice'
      )
    : [];
  const getModeStats = (matchType: 'human' | 'bot') => {
    const modeMatches = completedMatches.filter((match) => match.match_type === matchType);
    const wins = modeMatches.filter((match) => match.winner_id === user?.id).length;
    const draws = modeMatches.filter((match) => !match.winner_id).length;
    const losses = modeMatches.length - wins - draws;
    return {
      total: modeMatches.length,
      wins,
      losses,
      draws,
      winRate: modeMatches.length ? Math.round((wins / modeMatches.length) * 100) : 0,
    };
  };
  const humanStats = getModeStats('human');
  const botStats = getModeStats('bot');
  const rank =
    (user?.elo ?? 0) >= 1600 ? 'Vàng' : (user?.elo ?? 0) >= 1350 ? 'Bạc' : 'Đồng';
  const highestElo = Math.max(user?.highestElo ?? user?.elo ?? 0, user?.elo ?? 0);
  const highestRank = highestElo >= 1600 ? 'Vàng' : highestElo >= 1350 ? 'Bạc' : 'Đồng';
  const recentCompletedMatches = completedMatches.slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[#110d1b] p-5 shadow-2xl sm:p-6"
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
              <section className="relative isolate min-h-56 overflow-hidden rounded-2xl border border-white/10 bg-[#171326]">
                <img
                  src={profileBackdrop}
                  alt=""
                  className="absolute inset-0 -z-20 h-full w-full object-cover object-center opacity-65"
                />
                <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#100b1b] via-[#100b1b]/85 to-[#100b1b]/30" />
                <div className="flex h-full min-h-56 flex-col justify-between gap-6 p-5 sm:flex-row sm:items-end sm:p-6">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setAvatarPickerOpen((isOpen) => !isOpen)}
                      aria-label="Mở lựa chọn ảnh đại diện"
                      title="Đổi ảnh đại diện"
                      className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-amber-200/40 bg-black/35 text-5xl shadow-lg backdrop-blur-sm"
                    >
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="Ảnh đại diện" className="h-full w-full object-cover" />
                      ) : (
                        PLAYER_AVATARS.find((avatar) => avatar.id === (user.avatarId || 'pumpkin'))?.emoji || '🎃'
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <Camera className="h-6 w-6" />
                      </span>
                    </button>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/80">
                        Kỳ thủ OTTv2
                      </p>
                      <h3 className="mt-1 break-words text-2xl font-extrabold text-white drop-shadow sm:text-3xl">
                        {user.displayName}
                      </h3>
                      <p className="mt-1 text-xs text-white/70">Tên đăng nhập: *****</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/40 bg-amber-300/15 px-2.5 py-1 text-xs font-bold text-amber-100">
                          <Trophy className="h-3.5 w-3.5" />
                          Hạng {rank}
                        </span>
                        {user.isAdmin && (
                          <span className="rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-[10px] font-semibold text-white/80">
                            Ban tổ chức
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-end justify-between gap-6 sm:flex-col sm:items-end sm:gap-3">
                    <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-left sm:text-right">
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.12em] text-white/65">Elo hiện tại</p>
                        <p className="mt-0.5 text-xl font-black tabular-nums text-white">
                          {user.elo}<span className="ml-1 text-[10px] font-semibold text-amber-200">Elo</span>
                        </p>
                        <p className="text-[10px] text-amber-100">Hạng {rank}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.12em] text-white/65">Elo cao nhất</p>
                        <p className="mt-0.5 text-xl font-black tabular-nums text-white">
                          {highestElo}<span className="ml-1 text-[10px] font-semibold text-amber-200">Elo</span>
                        </p>
                        <p className="text-[10px] text-amber-100">Hạng {highestRank}</p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[10px] text-white/65">Trận đã ghi nhận</p>
                      <p className="text-lg font-bold tabular-nums text-white">{completedMatches.length}</p>
                    </div>
                  </div>
                </div>
              </section>

              {avatarPickerOpen && (
                <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Chọn ảnh đại diện</h3>
                    <button
                      type="button"
                      onClick={() => setAvatarPickerOpen(false)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      Đóng
                    </button>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {PLAYER_AVATARS.map((avatar) => {
                      const selected = !user.avatarUrl && (user.avatarId || 'pumpkin') === avatar.id;
                      return (
                        <button
                          key={avatar.id}
                          type="button"
                          disabled={loading}
                          onClick={() => void handleAvatarChange(avatar.id)}
                          aria-label={`Chọn avatar ${avatar.label}`}
                          title={avatar.label}
                          className={`rounded-xl border p-2 text-2xl transition-colors disabled:opacity-50 ${selected ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/15' : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:border-[var(--accent-primary)]'}`}
                        >
                          {avatar.emoji}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => avatarFileInputRef.current?.click()}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4 text-[var(--accent-primary)]" />
                    Tải ảnh từ máy lên
                  </button>
                  <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                    Chỉ nhận PNG, JPEG hoặc WebP, tối đa 1 MB.
                  </p>
                </section>
              )}

              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  { label: 'Người VS Người', icon: Swords, stats: humanStats, accent: 'text-sky-300', border: 'border-sky-300/25', fill: 'bg-sky-300/10' },
                  { label: 'Bot VS Bot', icon: Bot, stats: botStats, accent: 'text-violet-300', border: 'border-violet-300/25', fill: 'bg-violet-300/10' },
                ] as const).map(({ label, icon: ModeIcon, stats, accent, border, fill }) => (
                  <div key={label} className={`rounded-xl border ${border} ${fill} p-4`}>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                        <ModeIcon className={`h-4 w-4 ${accent}`} />
                        {label}
                      </h3>
                      <span className="text-[10px] text-[var(--text-muted)]">{stats.total} trận</span>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-4">
                      <div>
                        <p className={`text-3xl font-black tabular-nums ${accent}`}>{stats.winRate}%</p>
                        <p className="text-[10px] text-[var(--text-muted)]">Tỷ lệ thắng</p>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-right">
                        <div>
                          <p className="text-sm font-bold tabular-nums text-emerald-400">{stats.wins}</p>
                          <p className="text-[9px] text-[var(--text-muted)]">Thắng</p>
                        </div>
                        <div>
                          <p className="text-sm font-bold tabular-nums text-red-400">{stats.losses}</p>
                          <p className="text-[9px] text-[var(--text-muted)]">Thua</p>
                        </div>
                        <div>
                          <p className="text-sm font-bold tabular-nums text-amber-300">{stats.draws}</p>
                          <p className="text-[9px] text-[var(--text-muted)]">Hòa</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </section>
              <p className="-mt-3 text-right text-[10px] text-[var(--text-muted)]">
                Thống kê tính trên tối đa 50 trận gần nhất, tách riêng từng thể thức.
              </p>

              <details className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    <History className="h-4 w-4 text-[var(--accent-primary)]" />
                    Lịch sử thi đấu
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                    {recentCompletedMatches.length} trận gần nhất
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="mt-3">
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
                </div>
              </details>

              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Tài khoản đăng nhập</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">*****</p>
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

              <section className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                <button
                  type="button"
                  onClick={() => {
                    if (passwordFormOpen) {
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                    }
                    setPasswordFormOpen(!passwordFormOpen);
                  }}
                  aria-expanded={passwordFormOpen}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    <LockKeyhole className="h-4 w-4 text-[var(--accent-primary)]" />
                    Đổi mật khẩu
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${passwordFormOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {passwordFormOpen && (
                  <form onSubmit={handlePasswordChange} className="space-y-3 border-t border-[var(--border-subtle)] p-4">
                    <div>
                      <label htmlFor="profile-current-password" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                        Mật khẩu hiện tại
                      </label>
                      <input
                        id="profile-current-password"
                        type="password"
                        required
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="profile-new-password" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                          Mật khẩu mới (ít nhất 10 ký tự)
                        </label>
                        <input
                          id="profile-new-password"
                          type="password"
                          required
                          minLength={10}
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="profile-confirm-new-password" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                          Nhập lại mật khẩu mới
                        </label>
                        <input
                          id="profile-confirm-new-password"
                          type="password"
                          required
                          minLength={10}
                          autoComplete="new-password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        {loading ? 'Đang đổi mật khẩu…' : 'Xác nhận đổi mật khẩu'}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
