import React, { useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import { Copy, Eye, Loader2, LogIn, PlusCircle, Radio, Shuffle, Users } from 'lucide-react';
import { SPRINT_RULE_PRESETS, buildRulesFromPreset } from '../core/ottEngine';
import type { BackendUser } from '../core/backendClient';
import type { ActiveMatchSession } from '../components/ActiveMatchArena';
import { useToast } from '../components/ToastProvider';

interface PrivateRoomViewProps {
  user: BackendUser | null;
  onLaunchMatch: (session: ActiveMatchSession, cleanupFn?: () => void) => void;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export const PrivateRoomView: React.FC<PrivateRoomViewProps> = ({ user, onLaunchMatch }) => {
  const { notify } = useToast();

  // Host Room Config
  const [hostMode, setHostMode] = useState<'human' | 'bot'>('human');
  const [pieceCount, setPieceCount] = useState<number>(9);
  const [presetKey, setPresetKey] = useState<string>('standard');
  const [seed, setSeed] = useState<number>(() => Math.floor(100000 + Math.random() * 8999999));

  const [waitingCode, setWaitingCode] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);

  // Join / Spectate Room Config
  const [joinCode, setJoinCode] = useState('');
  const [joiningRole, setJoiningRole] = useState<'player' | 'spectator' | null>(null);

  const peerRef = useRef<Peer | null>(null);

  useEffect(() => {
    return () => {
      // Only destroy if still waiting in lobby; once launched, cleanup transfers to App
      if (waitingCode && peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
    };
  }, [waitingCode]);

  const myDisplayName = user?.displayName || 'Kỳ Thủ Khách';

  const handleCreateRoom = () => {
    setCreatingRoom(true);
    const code = generateRoomCode();
    const peerId = `ottv2-room-${code.toLowerCase()}`;
    const peer = new Peer(peerId);
    peerRef.current = peer;

    const listeners = new Set<(payload: any) => void>();
    const spectators = new Set<DataConnection>();
    let player2Conn: DataConnection | null = null;
    const rules = buildRulesFromPreset(presetKey, 1);

    peer.on('open', () => {
      setCreatingRoom(false);
      setWaitingCode(code);
      notify(`Đã mở phòng P2P mã ${code}. Hãy gửi mã này cho đối thủ!`, 'success');
    });

    peer.on('error', (err) => {
      setCreatingRoom(false);
      setWaitingCode(null);
      notify(`Lỗi khởi tạo PeerJS: ${err.message}`, 'error');
    });

    peer.on('connection', (conn) => {
      conn.on('data', (raw: any) => {
        if (!raw || typeof raw !== 'object') return;

        if (raw.type === 'JOIN_REQUEST') {
          if (raw.role === 'spectator' || player2Conn) {
            spectators.add(conn);
            conn.send({
              type: 'ROOM_WELCOME',
              assignedSeat: null,
              roomCode: code,
              seed,
              pieceCount,
              mode: hostMode,
              rules,
              player1Name: myDisplayName,
              player2Name: player2Conn ? 'Người chơi 2' : 'Đang chờ…',
            });
            return;
          }

          player2Conn = conn;
          const guestName = String(raw.displayName || 'Đối thủ P2P');
          conn.send({
            type: 'ROOM_WELCOME',
            assignedSeat: 2,
            roomCode: code,
            seed,
            pieceCount,
            mode: hostMode,
            rules,
            player1Name: myDisplayName,
            player2Name: guestName,
          });

          setWaitingCode(null);

          const session: ActiveMatchSession = {
            source: 'p2p',
            matchId: `p2p-${code}`,
            roomCode: code,
            seed,
            pieceCount,
            mode: hostMode,
            mySeat: 1,
            isHost: true,
            player1Name: myDisplayName,
            player2Name: guestName,
            rules,
            p2pSend: (payload) => {
              player2Conn?.send(payload);
              for (const spec of spectators) {
                if (spec.open) spec.send(payload);
              }
            },
            subscribePeerData: (cb) => {
              listeners.add(cb);
              return () => listeners.delete(cb);
            },
          };

          peerRef.current = null; // Ownership transferred to active match
          onLaunchMatch(session, () => peer.destroy());
          return;
        }

        // Forward Player 2 moves to spectators as well
        for (const spec of spectators) {
          if (spec.open && spec !== conn) spec.send(raw);
        }
        for (const fn of listeners) fn(raw);
      });

      conn.on('close', () => {
        if (conn === player2Conn) {
          for (const fn of listeners) {
            fn({ type: 'PLAYER_FORFEIT', seat: 2, reason: 'disconnect-timeout' });
          }
        } else {
          spectators.delete(conn);
        }
      });
    });
  };

  const handleCancelWaiting = () => {
    peerRef.current?.destroy();
    peerRef.current = null;
    setWaitingCode(null);
  };

  const handleJoinRoom = (role: 'player' | 'spectator') => {
    const cleaned = joinCode.trim().toUpperCase().replace(/^OTT-/, '');
    if (cleaned.length < 4) {
      notify('Vui lòng nhập mã phòng hợp lệ (ví dụ: A7K9P2).', 'error');
      return;
    }

    setJoiningRole(role);
    const peer = new Peer();
    const listeners = new Set<(payload: any) => void>();

    peer.on('open', () => {
      const conn = peer.connect(`ottv2-room-${cleaned.toLowerCase()}`, { reliable: true });

      const timeout = setTimeout(() => {
        setJoiningRole(null);
        peer.destroy();
        notify('Không tìm thấy phòng hoặc chủ phòng đã đóng kết nối.', 'error');
      }, 9000);

      conn.on('open', () => {
        conn.send({
          type: 'JOIN_REQUEST',
          role,
          displayName: myDisplayName,
        });
      });

      conn.on('data', (raw: any) => {
        if (!raw || typeof raw !== 'object') return;
        if (raw.type === 'ROOM_WELCOME') {
          clearTimeout(timeout);
          setJoiningRole(null);
          const session: ActiveMatchSession = {
            source: 'p2p',
            matchId: `p2p-${cleaned}`,
            roomCode: cleaned,
            seed: raw.seed,
            pieceCount: raw.pieceCount,
            mode: raw.mode,
            mySeat: raw.assignedSeat,
            isHost: false,
            player1Name: raw.player1Name || 'Chủ phòng',
            player2Name: raw.player2Name || myDisplayName,
            rules: raw.rules || null,
            p2pSend: (payload) => conn.send(payload),
            subscribePeerData: (cb) => {
              listeners.add(cb);
              return () => listeners.delete(cb);
            },
          };
          onLaunchMatch(session, () => peer.destroy());
          return;
        }
        for (const fn of listeners) fn(raw);
      });

      conn.on('close', () => {
        if (role === 'player') {
          for (const fn of listeners) {
            fn({ type: 'PLAYER_FORFEIT', seat: 1, reason: 'disconnect-timeout' });
          }
        }
      });

      conn.on('error', () => {
        clearTimeout(timeout);
        setJoiningRole(null);
        peer.destroy();
        notify('Kết nối P2P thất bại.', 'error');
      });
    });

    peer.on('error', (err) => {
      setJoiningRole(null);
      peer.destroy();
      notify(`Không thể kết nối PeerJS: ${err.message}`, 'error');
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Create Private P2P Room */}
        <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium text-[var(--accent-primary)]">
                Kết nối WebRTC Trực tiếp · Không qua máy chủ trung gian
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mt-1 flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-[var(--accent-primary)]" />
                Tạo Phòng Đấu Riêng (Chủ phòng)
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
                Tùy chỉnh số lượng quân cờ mỗi bên, chọn địa hình vật cản Sprint và tạo mã phòng 6 ký tự để mời bạn bè đối kháng hoặc cho phép khán giả vào xem trực tiếp.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Chế độ thi đấu</label>
                <select
                  disabled={Boolean(waitingCode)}
                  value={hostMode}
                  onChange={(e) => setHostMode(e.target.value as 'human' | 'bot')}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                >
                  <option value="human">Người vs Người (Cầm quân 1v1)</option>
                  <option value="bot">Bot Python vs Bot Python</option>
                </select>
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Số quân mỗi bên</label>
                <select
                  disabled={Boolean(waitingCode)}
                  value={pieceCount}
                  onChange={(e) => setPieceCount(Number(e.target.value))}
                  className="w-full px-3 py-2 font-mono rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                >
                  {[6, 9, 12, 15, 18, 24].map((n) => (
                    <option key={n} value={n}>
                      {n} quân mỗi phe
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Bản đồ vật cản</label>
                <select
                  disabled={Boolean(waitingCode)}
                  value={presetKey}
                  onChange={(e) => setPresetKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                >
                  {Object.values(SPRINT_RULE_PRESETS).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Seed khởi tạo</label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    disabled={Boolean(waitingCode)}
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value) || 1)}
                    className="w-full px-3 py-2 font-mono rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    disabled={Boolean(waitingCode)}
                    onClick={() => setSeed(Math.floor(100000 + Math.random() * 8999999))}
                    title="Đổi Seed ngẫu nhiên"
                    className="px-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {waitingCode ? (
            <div className="p-4 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-panel)] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <Radio className="w-4 h-4 text-[var(--accent-primary)] animate-pulse" />
                  <span>Đang chờ đối thủ nhập mã phòng…</span>
                </div>
                <button
                  type="button"
                  onClick={handleCancelWaiting}
                  className="text-xs font-medium text-red-300 hover:underline cursor-pointer"
                >
                  Đóng phòng
                </button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                <span className="text-xl font-mono font-bold tracking-widest text-[var(--text-primary)]">
                  {waitingCode}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(waitingCode);
                    notify(`Đã sao chép mã phòng ${waitingCode}`, 'success');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] text-white cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Sao chép mã
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                disabled={creatingRoom}
                onClick={handleCreateRoom}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                {creatingRoom ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PlusCircle className="w-4 h-4" />
                )}
                Tạo phòng & Lấy mã mời
              </button>
            </div>
          )}
        </div>

        {/* Join or Spectate Existing Room */}
        <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium text-[var(--p2-main)]">
                Tham gia nhanh không cần đăng nhập
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mt-1 flex items-center gap-2">
                <Users className="w-5 h-5 text-[var(--p2-main)]" />
                Vào Phòng Đấu Hoặc Xem Trực Tiếp
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
                Nhập mã phòng 6 ký tự từ bạn bè hoặc Ban Tổ Chức để vào ghế Người chơi 2, hoặc kết nối ở chế độ Khán giả để theo dõi ván cờ trực tiếp.
              </p>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                Mã phòng P2P (6 ký tự)
              </label>
              <input
                type="text"
                maxLength={12}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Ví dụ: K8M4X2"
                className="w-full px-4 py-3 text-base font-mono tracking-widest uppercase rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              disabled={joiningRole !== null}
              onClick={() => handleJoinRoom('player')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              {joiningRole === 'player' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              Vào đấu (Người chơi 2)
            </button>

            <button
              type="button"
              disabled={joiningRole !== null}
              onClick={() => handleJoinRoom('spectator')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              {joiningRole === 'spectator' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4 text-[var(--p2-main)]" />
              )}
              Xem với tư cách Khán giả
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
