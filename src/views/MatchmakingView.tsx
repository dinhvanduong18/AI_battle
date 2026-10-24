import React, { useEffect, useState } from 'react';
import {
  Bot,
  Film,
  Loader2,
  LogIn,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { backendClient, type BackendUser, type MatchSummary } from '../core/backendClient';
import { useToast } from '../components/ToastProvider';

interface MatchmakingViewProps {
  user: BackendUser | null;
  savedBotVersion: number;
  matches: MatchSummary[];
  onRefreshMatches: () => void;
  onOpenAuth: (tab?: 'login' | 'register') => void;
  onWatchMatchReplay: (match: MatchSummary) => void;
}

export const MatchmakingView: React.FC<MatchmakingViewProps> = ({
  user,
  savedBotVersion,
  matches,
  onRefreshMatches,
  onOpenAuth,
  onWatchMatchReplay,
}) => {
  const { notify } = useToast();
  const [searchingMode, setSearchingMode] = useState<'bot' | 'human' | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [filterType, setFilterType] = useState<'all' | 'bot' | 'human'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const offSearching = backendClient.on('searching', (pkt) => {
      if (pkt.mode === 'bot' || pkt.mode === 'human') {
        setSearchingMode(pkt.mode);
        setElapsedSec(0);
      }
    });
    const offCancelled = backendClient.on('search-cancelled', () => {
      setSearchingMode(null);
      setElapsedSec(0);
    });
    const offFound = backendClient.on('match-found', () => {
      setSearchingMode(null);
      setElapsedSec(0);
    });
    const offErr = backendClient.on('error', (pkt) => {
      setSearchingMode(null);
      if (pkt?.message) notify(pkt.message, 'error');
    });

    return () => {
      offSearching();
      offCancelled();
      offFound();
      offErr();
    };
  }, [notify]);

  useEffect(() => {
    if (!searchingMode) return;
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [searchingMode]);

  const handleJoinQueue = async (mode: 'bot' | 'human') => {
    if (!user) {
      onOpenAuth('login');
      return;
    }
    try {
      setSearchingMode(mode);
      setElapsedSec(0);
      if (mode === 'bot') await backendClient.findBotMatch();
      else await backendClient.findHumanMatch();
    } catch (err: any) {
      setSearchingMode(null);
      notify(err.message || 'Không thể tham gia hàng đợi ghép trận.', 'error');
    }
  };

  const handleSparringMatch = async (mode: 'bot' | 'human') => {
    if (!user) {
      onOpenAuth('login');
      return;
    }
    try {
      await backendClient.findSparringMatch(mode);
    } catch (err: any) {
      notify(
        err.message ||
          'Máy chủ hiện tại không hỗ trợ chế độ Sparring tức thì (chỉ có trên máy chủ Local tích hợp).',
        'error'
      );
    }
  };

  const handleCancelQueue = () => {
    backendClient.cancelMatch();
    setSearchingMode(null);
    setElapsedSec(0);
  };

  const filteredMatches = matches.filter((m) => {
    if (filterType !== 'all' && m.match_type !== filterType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return m.player1.toLowerCase().includes(q) || m.player2.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-8">
      {/* Active Queue Status Banner */}
      {searchingMode && (
        <div className="p-5 rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-panel)] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <Loader2 className="w-6 h-6 text-[var(--accent-primary)] animate-spin shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Đang tìm đối thủ {searchingMode === 'bot' ? 'Bot vs Bot (Xếp hạng Elo)' : '1v1 Người vs Người'}…
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 tabular-nums">
                Thời gian chờ: {elapsedSec}s
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleSparringMatch(searchingMode)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
              Đấu ngay với Hắc Kỵ Sĩ AI
            </button>
            <button
              type="button"
              onClick={handleCancelQueue}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 transition-colors cursor-pointer whitespace-nowrap"
            >
              <XCircle className="w-4 h-4" />
              Hủy tìm trận
            </button>
          </div>
        </div>
      )}

      {/* Two Competitive Matchmaking Modes */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Ranked Bot vs Bot */}
        <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="text-xs font-medium text-[var(--accent-primary)]">
              Chế độ Xếp hạng Chính thức · Tính Elo FIDE (K = 20)
            </div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2.5">
              <Bot className="w-5 h-5 text-[var(--accent-primary)]" />
              Đấu Trường Bot vs Bot
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Hai Bot Python 3 thi đấu tự động hoàn toàn với hạt giống ngẫu nhiên đồng bộ. Mọi nước đi được ký cam kết chữ ký số ECDSA P-256 và xác minh lại toàn bộ biên bản trên máy chủ trước khi cộng điểm Elo.
            </p>
            <div className="pt-1 text-xs text-[var(--text-muted)] tabular-nums">
              <span>
                Trạng thái Bot:{' '}
                <strong className="text-[var(--text-primary)]">
                  {savedBotVersion > 0 ? `Đã lưu v${savedBotVersion}` : 'Có thể chọn 5 Bot mẫu khi vào bàn'}
                </strong>
              </span>
              <span aria-hidden="true"> · </span>
              <span>9 quân mỗi phe</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              disabled={searchingMode !== null}
              onClick={() => handleJoinQueue('bot')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Swords className="w-4 h-4" />
              Tìm trận Bot trực tuyến
            </button>

            <button
              type="button"
              disabled={searchingMode !== null}
              onClick={() => handleSparringMatch('bot')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
              Đấu xếp hạng với Hắc Kỵ Sĩ AI
            </button>
          </div>
        </div>

        {/* Human vs Human PvP */}
        <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="text-xs font-medium text-[var(--p2-main)]">
              Đối kháng Trực tiếp · Không ảnh hưởng Elo Bot
            </div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2.5">
              <UserCheck className="w-5 h-5 text-[var(--p2-main)]" />
              Cầm Quân Trực Tiếp 1v1 (PvP)
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Tự tay điều khiển từng quân Đấm, Lá, Kéo trên bàn cờ 9×9 đối đầu người chơi khác để rèn luyện cảm quan vị trí, thử nghiệm bẫy khắc hệ và lưu lại biên bản Replay chuẩn xác.
            </p>
            <div className="pt-1 text-xs text-[var(--text-muted)]">
              <span>Đồng thuận P2P chống gian lận</span>
              <span aria-hidden="true"> · </span>
              <span>Lưu lịch sử & Replay đầy đủ</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              disabled={searchingMode !== null}
              onClick={() => handleJoinQueue('human')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <UserCheck className="w-4 h-4" />
              Tìm đối thủ 1v1 trực tuyến
            </button>

            <button
              type="button"
              disabled={searchingMode !== null}
              onClick={() => handleSparringMatch('human')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-[var(--p2-main)]" />
              Cầm quân đấu Hắc Kỵ Sĩ AI
            </button>
          </div>
        </div>
      </section>

      {/* Match History & Replay Verification Table */}
      <section className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Biên bản Trận đấu & Kho Replay Cá nhân
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Dữ liệu được xác thực chữ ký P-256 của cả hai phía trước khi lưu trữ
            </p>
          </div>

          {user && (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm tên kỳ thủ…"
                  className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                {(
                  [
                    { id: 'all', label: 'Tất cả' },
                    { id: 'bot', label: 'Đấu Bot' },
                    { id: 'human', label: 'Đấu Người' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterType(tab.id)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      filterType === tab.id
                        ? 'bg-[var(--bg-panel)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={onRefreshMatches}
                className="px-3 py-1.5 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
              >
                Làm mới
              </button>
            </div>
          )}
        </div>

        {!user ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">
              Vui lòng đăng nhập để bắt đầu ghép trận trực tuyến và xem kho lưu trữ Replay.
            </p>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              Đăng nhập / Đăng ký
            </button>
          </div>
        ) : filteredMatches.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--text-muted)]">
            Không tìm thấy trận đấu nào khớp với bộ lọc hiện tại.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                  <th className="py-2.5 pr-3 font-medium">Thời gian</th>
                  <th className="py-2.5 px-3 font-medium">Cặp đấu</th>
                  <th className="py-2.5 px-3 font-medium">Thể thức</th>
                  <th className="py-2.5 px-3 font-medium">Seed</th>
                  <th className="py-2.5 px-3 font-medium">Kết quả</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Replay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                {filteredMatches.map((m) => {
                  const won = m.winner_id === user.id;
                  const completed = m.status === 'completed';
                  const isDraw = completed && m.winner_id === null;
                  const timeStr = new Date(m.created_at).toLocaleString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  return (
                    <tr key={m.id} className="hover:bg-[var(--bg-hover)]/40 transition-colors">
                      <td className="py-3 pr-3 font-mono text-[var(--text-secondary)]">{timeStr}</td>
                      <td className="py-3 px-3 font-medium text-[var(--text-primary)]">
                        {m.player1} <span className="text-[var(--text-muted)]">vs</span> {m.player2}
                      </td>
                      <td className="py-3 px-3 text-[var(--text-secondary)]">
                        {m.match_type === 'bot' ? 'Bot Elo' : '1v1 Người'}
                      </td>
                      <td className="py-3 px-3 font-mono text-[var(--text-muted)]">{m.seed}</td>
                      <td className="py-3 px-3">
                        {!completed ? (
                          <span className="text-[var(--text-muted)]">{m.status}</span>
                        ) : (
                          <span className={isDraw ? 'text-[var(--text-secondary)]' : won ? 'text-emerald-400 font-semibold' : 'text-red-400'}>
                            {isDraw ? 'Hòa' : won ? 'Thắng' : 'Thua'}
                            {m.elo_delta ? ` (${m.elo_delta > 0 ? '+' : ''}${m.elo_delta} Elo)` : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pl-3 text-right">
                        {m.replay_available ? (
                          <button
                            type="button"
                            onClick={() => onWatchMatchReplay(m)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-primary)] hover:underline cursor-pointer whitespace-nowrap"
                          >
                            <Film className="w-3.5 h-3.5" />
                            Mở Replay
                          </button>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
