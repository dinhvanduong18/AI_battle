import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Code2,
  Eye,
  Flame,
  LayoutDashboard,
  Menu,
  Radio,
  Swords,
  Trophy,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  backendClient,
  type BackendUser,
  type MatchSummary,
  type TournamentItem,
} from './core/backendClient';
import { SAMPLE_BOTS } from './core/sampleBots';
import { soundFx } from './core/soundFx';
import { ToastProvider, useToast } from './components/ToastProvider';
import { HalloweenBackdrop } from './components/HalloweenBackdrop';
import { AuthSettingsModal, type ModalTab } from './components/AuthSettingsModal';
import { ReplayModal } from './components/ReplayModal';
import { ActiveMatchArena, type ActiveMatchSession } from './components/ActiveMatchArena';
import { OverviewView } from './views/OverviewView';
import { BotLabView } from './views/BotLabView';
import { MatchmakingView } from './views/MatchmakingView';
import { TournamentsView } from './views/TournamentsView';
import { PrivateRoomView } from './views/PrivateRoomView';
import { MultiWatchView } from './views/MultiWatchView';

type NavView =
  | 'overview'
  | 'bot-lab'
  | 'matchmaking'
  | 'tournaments'
  | 'private-room'
  | 'multi-watch';

const NAV_ITEMS: Array<{ id: NavView; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'overview', label: 'Tổng quan Sảnh', icon: LayoutDashboard },
  { id: 'bot-lab', label: 'Phòng Lab Bot Python', icon: Code2 },
  { id: 'matchmaking', label: 'Đấu trường Xếp hạng', icon: Swords },
  { id: 'tournaments', label: 'Giải đấu Sự kiện', icon: Trophy },
  { id: 'private-room', label: 'Phòng riêng P2P', icon: Radio },
  { id: 'multi-watch', label: 'Xem trực tiếp (4 Bàn)', icon: Eye },
];

const VIEW_TITLES: Record<NavView, string> = {
  overview: 'Sảnh Chiến Thuật OTTv2',
  'bot-lab': 'Phòng Lab & Huấn Luyện Bot Python 3',
  matchmaking: 'Đấu Trường Xếp Hạng Trực Tuyến',
  tournaments: 'Giải Đấu Cá Nhân Theo Sprint',
  'private-room': 'Phòng Đấu Riêng P2P',
  'multi-watch': 'Trung Tâm Xem Trực Tiếp 4 Bàn',
};

function AppWorkspace() {
  const { notify } = useToast();

  // Sound FX state
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => soundFx.enabled);

  // Navigation & Responsive Drawer
  const [activeView, setActiveView] = useState<NavView>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // User, Bot & Dashboard Data
  const [user, setUser] = useState<BackendUser | null>(() => backendClient.user);
  const [editorCode, setEditorCode] = useState<string>(() => {
    try {
      return localStorage.getItem('ottv2-draft-bot-code') || SAMPLE_BOTS.phantom_hunter;
    } catch {
      return SAMPLE_BOTS.phantom_hunter;
    }
  });
  const [savedBotCode, setSavedBotCode] = useState<string>('');
  const [savedBotVersion, setSavedBotVersion] = useState<number>(user?.activeBotVersion || 0);

  const [leaderboard, setLeaderboard] = useState<
    Array<{ id: string; displayName: string; elo: number; isSystemBot?: boolean }>
  >([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [tournaments, setTournaments] = useState<TournamentItem[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(true);

  // Modals
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<ModalTab>('login');
  const [replayState, setReplayState] = useState<{
    open: boolean;
    data: any | null;
    p1: string;
    p2: string;
  }>({ open: false, data: null, p1: 'Player 1', p2: 'Player 2' });

  // Active 1v1 Match Session (Backend or P2P)
  const [activeMatch, setActiveMatch] = useState<ActiveMatchSession | null>(null);
  const [reconnectOffer, setReconnectOffer] = useState<{
    session: ActiveMatchSession;
    expiresAt: string;
  } | null>(null);
  const [reconnectNow, setReconnectNow] = useState(() => Date.now());
  const p2pCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!reconnectOffer) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setReconnectNow(now);
      if (new Date(reconnectOffer.expiresAt).getTime() <= now) setReconnectOffer(null);
    }, 250);
    return () => window.clearInterval(timer);
  }, [reconnectOffer]);

  const handleEditorCodeChange = (nextCode: string) => {
    setEditorCode(nextCode);
    try {
      localStorage.setItem('ottv2-draft-bot-code', nextCode);
    } catch {
      // ignore
    }
  };

  const refreshPublicAndUserData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [lb, tours] = await Promise.all([
        backendClient.getLeaderboard().catch(() => []),
        backendClient.getTournaments().catch(() => []),
      ]);
      setLeaderboard(lb);
      setTournaments(tours);

      if (backendClient.token) {
        const [me, myMatches, myBot] = await Promise.all([
          backendClient.refreshMe().catch(() => null),
          backendClient.getMatches().catch(() => []),
          backendClient.getMyBot().catch(() => ({ version: 0, code: '', sha256: '' })),
        ]);
        setUser(me);
        setMatches(myMatches);
        setSavedBotVersion(myBot.version || 0);
        setSavedBotCode(myBot.code || '');
      } else {
        setMatches([]);
        setSavedBotVersion(0);
        setSavedBotCode('');
      }
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    refreshPublicAndUserData();
    const offAuth = backendClient.on('auth-changed', (nextUser) => {
      setUser(nextUser);
    });
    return () => offAuth();
  }, [refreshPublicAndUserData]);

  // Global listener for Backend Matchmaking `match-found`
  useEffect(() => {
    let pendingSparringMatchId: string | null = null;
    const offSpar = backendClient.on('sparring-ready', (pkt) => {
      pendingSparringMatchId = pkt.matchId || null;
    });

    const offMatchFound = backendClient.on('match-found', (pkt) => {
      const m = pkt.match;
      if (!m) return;
      const isSparring =
        pendingSparringMatchId === m.id ||
        pkt.opponent?.id === '00000000-0000-4000-8000-000000000001';
      const mySeat =
        pkt.seat === 1 || pkt.seat === 2
          ? pkt.seat
          : pkt.role === 'player1'
          ? 1
          : pkt.role === 'player2'
          ? 2
          : null;

      setActiveMatch({
        source: 'backend',
        matchId: m.id,
        seed: m.seed,
        pieceCount: m.pieceCount || 9,
        mode: pkt.mode || m.mode || m.match_type || 'bot',
        mySeat,
        player1Name: m.player1?.displayName || 'Player 1',
        player2Name: m.player2?.displayName || 'Player 2',
        player1Elo: m.player1?.elo,
        player2Elo: m.player2?.elo,
        rules: m.rules || null,
        tournamentId: m.tournamentId || null,
        tournamentPhase: m.tournamentPhase || null,
        isSparring,
      });
    });
    const handleReconnect = (pkt: any) => {
      const m = pkt.match;
      if (!m) return;
      setReconnectOffer(null);
      setActiveMatch({
        source: 'backend',
        matchId: m.id,
        seed: m.seed,
        pieceCount: m.pieceCount || 9,
        mode: pkt.mode || m.match_type || 'human',
        mySeat: pkt.role === 'player1' ? 1 : 2,
        player1Name: m.player1?.displayName || 'Player 1',
        player2Name: m.player2?.displayName || 'Player 2',
        player1Elo: m.player1?.elo,
        player2Elo: m.player2?.elo,
        rules: m.rules || null,
        tournamentId: m.tournament_id || null,
        tournamentPhase: m.tournament_phase || null,
      });
    };
    const offRejoined = backendClient.on('match-rejoined', handleReconnect);
    const offAvailable = backendClient.on('match-rejoin-available', (pkt) => {
      const m = pkt.match;
      if (!m) return;
      setActiveMatch(null);
      setReconnectOffer({
        session: {
          source: 'backend',
          matchId: m.id,
          seed: m.seed,
          pieceCount: m.pieceCount || 9,
          mode: m.match_type || 'human',
          mySeat: pkt.role === 'player1' ? 1 : 2,
          player1Name: m.player1?.displayName || 'Player 1',
          player2Name: m.player2?.displayName || 'Player 2',
          player1Elo: m.player1?.elo,
          player2Elo: m.player2?.elo,
          rules: m.rules || null,
          tournamentId: m.tournament_id || null,
          tournamentPhase: m.tournament_phase || null,
        },
        expiresAt: pkt.expiresAt,
      });
    });
    const offForfeited = backendClient.on('match-forfeited', (pkt) => {
      setReconnectOffer((current) => {
        if (current?.session.matchId !== pkt.matchId) return current;
        notify(pkt.message || 'Bạn đã thua vì không vào lại phòng trong 10 giây.', 'error');
        return null;
      });
    });

    return () => {
      offSpar();
      offMatchFound();
      offRejoined();
      offAvailable();
      offForfeited();
    };
  }, [notify]);

  const handleSaveBotToServer = async (code: string) => {
    try {
      const res = await backendClient.saveMyBot(code);
      setSavedBotCode(code);
      setSavedBotVersion(res.version);
      notify(`Đã lưu Bot Python phiên bản v${res.version} lên máy chủ!`, 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể lưu mã Bot lên máy chủ.', 'error');
      throw err;
    }
  };

  const handleWatchReplayById = async (matchId: string, p1: string, p2: string) => {
    try {
      const replay = await backendClient.getMatchReplay(matchId);
      setReplayState({ open: true, data: replay, p1, p2 });
    } catch (err: any) {
      notify(err.message || 'Không tải được biên bản Replay của trận này.', 'error');
    }
  };

  const handleOpenAuth = (tab: ModalTab = 'login') => {
    setAuthModalTab(tab);
    setAuthModalOpen(true);
  };

  const handleExitActiveMatch = () => {
    const leavingMatch = activeMatch?.source === 'backend' ? activeMatch : null;
    if (leavingMatch) {
      backendClient.leaveMatch(leavingMatch.matchId);
      setReconnectOffer({
        session: leavingMatch,
        expiresAt: new Date(Date.now() + 10000).toISOString(),
      });
    }
    if (p2pCleanupRef.current) {
      p2pCleanupRef.current();
      p2pCleanupRef.current = null;
    }
    backendClient.closePeerChannel();
    setActiveMatch(null);
    refreshPublicAndUserData();
  };

  const reconnectSeconds = reconnectOffer
    ? Math.max(0, Math.ceil((new Date(reconnectOffer.expiresAt).getTime() - reconnectNow) / 1000))
    : 0;

  return (
    <div className="relative min-h-screen flex text-[var(--text-primary)]">
      {/* Full-Viewport Dark Fantasy Castle, Pumpkin Lanterns & Drifting Fireflies */}
      <HalloweenBackdrop />

      {/* Desktop Persistent Sidebar */}
      <aside className="relative z-20 hidden lg:flex lg:flex-col lg:w-64 shrink-0 border-r border-[var(--border-subtle)] bg-[#120c1e]/85 backdrop-blur-md">
        <div className="h-16 px-6 flex items-center border-b border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => {
              if (!activeMatch) setActiveView('overview');
            }}
            className="flex items-center gap-2.5 text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-xl bg-[var(--p1-bg)] border border-[var(--p1-border)] flex items-center justify-center text-[var(--accent-primary)]">
              <Flame className="w-4 h-4" />
            </div>
            <span className="font-display font-extrabold text-lg tracking-tight text-[var(--text-primary)] whitespace-nowrap">
              OTTv2 Arena
            </span>
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = !activeMatch && activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={Boolean(activeMatch)}
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45 ${
                  active
                    ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] border border-[var(--border-accent)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/50'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom Audio Control in Sidebar */}
        <div className="p-4 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => {
              const next = soundFx.toggle();
              setSoundEnabled(next);
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)] transition-colors cursor-pointer whitespace-nowrap"
          >
            {soundEnabled ? (
              <>
                <Volume2 className="w-4 h-4 text-[var(--accent-primary)]" />
                Âm thanh hiệu ứng: Bật
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4" />
                Âm thanh hiệu ứng: Tắt
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-72 h-full bg-[#150e23] border-r border-[var(--border-subtle)] p-4 flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <span className="font-display font-bold text-base text-[var(--text-primary)]">
                  OTTv2 Arena
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-[var(--text-secondary)]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = !activeMatch && activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={Boolean(activeMatch)}
                      onClick={() => {
                        setActiveView(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium ${
                        active
                          ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] border border-[var(--border-accent)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="pt-4 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => {
                  const next = soundFx.toggle();
                  setSoundEnabled(next);
                }}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)]"
              >
                {soundEnabled ? (
                  <>
                    <Volume2 className="w-4 h-4 text-[var(--accent-primary)]" />
                    Âm thanh: Bật
                  </>
                ) : (
                  <>
                    <VolumeX className="w-4 h-4" />
                    Âm thanh: Tắt
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {/* Clean Single-Row Top Header */}
        <header className="h-16 px-4 sm:px-8 border-b border-[var(--border-subtle)] bg-[#120c1e]/80 backdrop-blur-md flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Mở menu điều hướng"
              className="lg:hidden p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-bold text-[var(--text-primary)] truncate">
              {activeMatch ? 'Bàn Thi Đấu Chiến Thuật 9×9' : VIEW_TITLES[activeView]}
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => handleOpenAuth(user ? 'profile' : 'login')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
            >
              <User className="w-3.5 h-3.5" />
              {user ? `${user.displayName} · ${user.elo}` : 'Đăng nhập'}
            </button>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-8 py-6 sm:py-8">
          {reconnectOffer && reconnectSeconds > 0 && !activeMatch && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
              <div className="text-sm text-[var(--text-primary)]">
                Bạn đã rời phòng. Hãy vào lại trong <strong>{reconnectSeconds} giây</strong> để tiếp tục trận đấu.
              </div>
              <button
                type="button"
                onClick={() => {
                  backendClient.rejoinMatch(reconnectOffer.session.matchId).catch((err: any) => {
                    notify(err.message || 'Không thể vào lại phòng.', 'error');
                  });
                }}
                className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-black transition-colors hover:bg-amber-300"
              >
                Vào lại phòng: {reconnectSeconds}s
              </button>
            </div>
          )}
          {activeMatch ? (
            <ActiveMatchArena
              session={activeMatch}
              customEditorCode={editorCode}
              savedBotCode={savedBotCode}
              hasSavedBot={savedBotVersion > 0 && Boolean(savedBotCode.trim())}
              themeMode="halloween"
              onExit={handleExitActiveMatch}
              onOpenReplay={(data, p1, p2) => setReplayState({ open: true, data, p1, p2 })}
            />
          ) : (
            <>
              {activeView === 'overview' && (
                <OverviewView
                  user={user}
                  botVersion={savedBotVersion}
                  leaderboard={leaderboard}
                  recentMatches={matches}
                  tournaments={tournaments}
                  loadingData={loadingData}
                  onNavigate={(v) => setActiveView(v)}
                  onOpenAuth={(tab) => handleOpenAuth(tab || 'login')}
                  onWatchMatchReplay={(m) => handleWatchReplayById(m.id, m.player1, m.player2)}
                />
              )}

              {activeView === 'bot-lab' && (
                <BotLabView
                  user={user}
                  themeMode="halloween"
                  editorCode={editorCode}
                  onEditorCodeChange={handleEditorCodeChange}
                  savedBotVersion={savedBotVersion}
                  onSaveBotToServer={handleSaveBotToServer}
                  onOpenAuth={(tab) => handleOpenAuth(tab || 'login')}
                />
              )}

              {activeView === 'matchmaking' && (
                <MatchmakingView
                  user={user}
                  savedBotVersion={savedBotVersion}
                  matches={matches}
                  onRefreshMatches={refreshPublicAndUserData}
                  onOpenAuth={(tab) => handleOpenAuth(tab || 'login')}
                  onWatchMatchReplay={(m) => handleWatchReplayById(m.id, m.player1, m.player2)}
                />
              )}

              {activeView === 'tournaments' && (
                <TournamentsView
                  user={user}
                  themeMode="halloween"
                  tournaments={tournaments}
                  onRefreshTournaments={refreshPublicAndUserData}
                  onOpenAuth={(tab) => handleOpenAuth(tab || 'login')}
                  onWatchReplayById={handleWatchReplayById}
                />
              )}

              {activeView === 'private-room' && (
                <PrivateRoomView
                  user={user}
                  onLaunchMatch={(session, cleanupFn) => {
                    p2pCleanupRef.current = cleanupFn || null;
                    setActiveMatch(session);
                  }}
                />
              )}

              {activeView === 'multi-watch' && <MultiWatchView themeMode="halloween" />}
            </>
          )}
        </main>
      </div>

      {/* Auth & Player Profile Modal */}
      <AuthSettingsModal
        open={authModalOpen}
        initialTab={authModalTab}
        user={user}
        onClose={() => setAuthModalOpen(false)}
        onUserUpdated={(nextUser) => {
          setUser(nextUser);
          refreshPublicAndUserData();
        }}
      />

      {/* SHA-256 Verified Replay Modal */}
      <ReplayModal
        open={replayState.open}
        replayData={replayState.data}
        player1Name={replayState.p1}
        player2Name={replayState.p2}
        themeMode="halloween"
        onClose={() => setReplayState((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppWorkspace />
    </ToastProvider>
  );
}
