export interface BackendUser {
  id: string;
  email: string;
  displayName: string;
  elo: number;
  isAdmin?: boolean;
  activeBotVersion?: number;
}

export interface MatchSummary {
  id: string;
  seed: number;
  status: string;
  match_type?: 'human' | 'bot';
  tournament_phase?: 'practice' | 'ranked' | null;
  winner_id: string | null;
  final_state_hash?: string | null;
  replay_sha256?: string | null;
  created_at: string;
  completed_at: string | null;
  replay_available: boolean;
  player1: string;
  player2: string;
  player1_id?: string;
  player2_id?: string;
  elo_delta?: number;
}

export interface TournamentItem {
  id: string;
  name: string;
  format: string;
  description: string;
  status: 'registration' | 'qualifying' | 'completed';
  registration_closes_at: string;
  ends_at: string;
  max_teams: number;
  current_week: number;
  week_started_at: string | null;
  rules_json: any;
  rules_schedule?: string[];
  participant_count?: number;
  created_at: string;
}

type EventHandler = (payload: any) => void;

export function resolveDefaultBackendUrl(): string {
  const envUrl = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3000';
}

export class BackendClient {
  public baseUrl: string;
  public token: string | null = null;
  public user: BackendUser | null = null;
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private activeMatchId: string | null = null;

  constructor() {
    try {
      localStorage.removeItem('ottv2-backend-url');
    } catch {
      // ignore
    }
    this.baseUrl = resolveDefaultBackendUrl();
    this.restoreSession();
  }

  on(event: string, fn: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return () => {
      this.handlers.get(event)?.delete(fn);
    };
  }

  private emit(event: string, payload?: any) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`BackendClient listener error [${event}]:`, err);
      }
    }
  }

  restoreSession(): boolean {
    try {
      this.token = localStorage.getItem('ottv2-backend-token');
      const rawUser = localStorage.getItem('ottv2-backend-user');
      this.user = rawUser ? JSON.parse(rawUser) : null;
    } catch {
      this.token = null;
      this.user = null;
    }
    return Boolean(this.token && this.user);
  }

  saveSession(token: string, user: BackendUser) {
    this.token = token;
    this.user = user;
    try {
      localStorage.setItem('ottv2-backend-token', token);
      localStorage.setItem('ottv2-backend-user', JSON.stringify(user));
    } catch {
      // ignore
    }
    this.emit('auth-changed', user);
  }

  updateStoredUser(user: BackendUser) {
    this.user = user;
    try {
      localStorage.setItem('ottv2-backend-user', JSON.stringify(user));
    } catch {
      // ignore
    }
    this.emit('auth-changed', user);
  }

  clearSession() {
    this.closeSocket();
    this.token = null;
    this.user = null;
    try {
      localStorage.removeItem('ottv2-backend-token');
      localStorage.removeItem('ottv2-backend-user');
    } catch {
      // ignore
    }
    this.emit('auth-changed', null);
  }

  async checkHealth(): Promise<{ ok: boolean; latencyMs: number; mode?: string }> {
    const start = performance.now();
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      ok: Boolean(data?.ok),
      latencyMs: Math.round(performance.now() - start),
      mode: data?.mode,
    };
  }

  private async request(path: string, method = 'GET', body?: unknown, authRequired = false) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    else if (authRequired) throw new Error('Vui lòng đăng nhập trước khi thực hiện thao tác này.');

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Không thể kết nối tới máy chủ hệ thống. Vui lòng thử lại sau giây lát.');
    }

    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && authRequired) {
      this.clearSession();
      throw new Error(json.error || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
    if (!res.ok) {
      throw new Error(json.error || `Yêu cầu thất bại (${res.status})`);
    }
    return json;
  }

  async register(email: string, password: string, displayName: string) {
    const res = await this.request('/api/auth/register', 'POST', { email, password, displayName });
    this.saveSession(res.token, res.user);
    return res.user as BackendUser;
  }

  async login(email: string, password: string) {
    const res = await this.request('/api/auth/login', 'POST', { email, password });
    this.saveSession(res.token, res.user);
    return res.user as BackendUser;
  }

  async refreshMe() {
    if (!this.token) return null;
    const res = await this.request('/api/me', 'GET', undefined, true);
    if (res.user) this.updateStoredUser(res.user);
    return res.user as BackendUser;
  }

  async updateProfile(changes: { displayName?: string; currentPassword?: string; newPassword?: string }) {
    const res = await this.request('/api/me', 'PATCH', changes, true);
    if (res.user) this.updateStoredUser(res.user);
    return res.user as BackendUser;
  }


  async getLeaderboard(): Promise<Array<{ id: string; displayName: string; elo: number; isSystemBot?: boolean }>> {
    const res = await this.request('/api/leaderboard');
    return Array.isArray(res.players) ? res.players : [];
  }

  async getMatches(): Promise<MatchSummary[]> {
    if (!this.token) return [];
    const res = await this.request('/api/matches', 'GET', undefined, true);
    return Array.isArray(res.matches) ? res.matches : [];
  }

  async getMatchReplay(matchId: string) {
    const res = await this.request(`/api/matches/${encodeURIComponent(matchId)}/replay`, 'GET', undefined, true);
    if (res.replay) return res.replay;
    if (res.downloadUrl) {
      const dl = await fetch(res.downloadUrl);
      if (!dl.ok) throw new Error('Không tải được file Replay.');
      return dl.json();
    }
    throw new Error('Không tìm thấy dữ liệu Replay.');
  }

  async getMyBot(): Promise<{ version: number; code: string; sha256: string; createdAt?: string }> {
    const res = await this.request('/api/bots/me', 'GET', undefined, true);
    return res.bot || { version: 0, code: '', sha256: '' };
  }

  async saveMyBot(code: string): Promise<{ version: number; sha256: string }> {
    const res = await this.request('/api/bots/me', 'POST', { code }, true);
    await this.refreshMe().catch(() => {});
    return res;
  }

  async getTournaments(): Promise<TournamentItem[]> {
    const res = await this.request('/api/tournaments');
    if (!Array.isArray(res.tournaments)) return [];

    return res.tournaments.map((tournament: TournamentItem & { team_count?: number }) => ({
      ...tournament,
      participant_count: tournament.participant_count ?? tournament.team_count ?? 0,
    }));
  }

  async getTournamentDetail(id: string) {
    return this.request(`/api/tournaments/${encodeURIComponent(id)}`);
  }

  async createTournament(payload: {
    name: string;
    format: string;
    description: string;
    registrationClosesAt: string;
    endsAt: string;
    maxTeams: number;
    sprintRules: string[];
  }) {
    return this.request('/api/tournaments', 'POST', payload, true);
  }

  async startTournament(id: string) {
    return this.request(`/api/tournaments/${encodeURIComponent(id)}/start`, 'POST', {}, true);
  }

  async registerTournament(id: string) {
    return this.request(`/api/tournaments/${encodeURIComponent(id)}/register`, 'POST', {}, true);
  }

  async submitMatchResult(payload: unknown) {
    const res = await this.request('/api/match/submit-result', 'POST', payload, true);
    await this.refreshMe().catch(() => {});
    return res;
  }

  async claimDisconnect(matchId: string) {
    const res = await this.request('/api/match/claim-disconnect', 'POST', { matchId }, true);
    await this.refreshMe().catch(() => {});
    return res;
  }

  // ── WebSocket + Dual-Transport P2P Connection ─────────────────
  async connectWs(): Promise<void> {
    if (!this.token) throw new Error('Vui lòng đăng nhập trước khi kết nối máy chủ thi đấu.');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws';
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      this.ws = socket;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Quá thời gian kết nối WebSocket máy chủ.'));
      }, 8000);

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'auth', token: this.token }));
      });

      socket.addEventListener('message', (ev) => {
        let packet: any;
        try {
          packet = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (packet.type === 'authenticated') {
          clearTimeout(timeout);
          if (packet.user) this.updateStoredUser(packet.user);
          if (this.activeMatchId && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'rtc-connected', matchId: this.activeMatchId }));
          }
          this.emit('ws-status', 'connected');
          resolve();
          return;
        }
        this.handleWsPacket(packet);
      });

      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Không thể thiết lập kết nối WebSocket tới máy chủ.'));
      });

      socket.addEventListener('close', () => {
        this.emit('ws-status', 'disconnected');
      });
    });
  }

  private handleWsPacket(packet: any) {
    if (
      packet.type === 'match-forfeited' ||
      packet.type === 'match-forfeited-win' ||
      packet.type === 'match-forfeited-loss' ||
      packet.type === 'match-aborted'
    ) {
      this.activeMatchId = null;
    }
    if (packet.type === 'match-found') {
      this.activeMatchId = packet.match?.id || null;
      this.setupWebRtcChannel(packet).catch(() => {
        // Fallback to WebSocket match-relay automatically
      });
      this.emit('match-found', packet);
      return;
    }
    if (packet.type === 'signal') {
      this.handleWebRtcSignal(packet.payload).catch(() => {});
      return;
    }
    if (packet.type === 'match-relay') {
      this.emit('peer-data', packet.payload);
      return;
    }
    this.emit(packet.type, packet);
  }

  private async setupWebRtcChannel(packet: any) {
    this.closePeerChannel();
    if (typeof RTCPeerConnection === 'undefined') return;
    const matchId = packet.match?.id;
    if (!matchId) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.sendWs({ type: 'signal', matchId, payload: { candidate: ev.candidate } });
      }
    };

    const bindChannel = (ch: RTCDataChannel) => {
      this.dc = ch;
      ch.onopen = () => this.emit('datachannel-open', { matchId });
      ch.onmessage = (ev) => {
        try {
          this.emit('peer-data', JSON.parse(ev.data));
        } catch {
          // ignore
        }
      };
    };

    if (packet.role === 'player1') {
      bindChannel(pc.createDataChannel('ottv2-match', { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendWs({ type: 'signal', matchId, payload: { description: pc.localDescription } });
    } else {
      pc.ondatachannel = (ev) => bindChannel(ev.channel);
    }
  }

  private async handleWebRtcSignal(payload: any) {
    if (!this.pc || !payload || !this.activeMatchId) return;
    if (payload.description) {
      await this.pc.setRemoteDescription(payload.description);
      if (payload.description.type === 'offer') {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendWs({
          type: 'signal',
          matchId: this.activeMatchId,
          payload: { description: this.pc.localDescription },
        });
      }
    } else if (payload.candidate && this.pc.remoteDescription) {
      await this.pc.addIceCandidate(payload.candidate);
    }
  }

  /**
   * Sends signed P2P consensus message via direct WebRTC DataChannel when open,
   * or seamlessly falls back to authenticated WebSocket match-relay.
   */
  sendPeerMessage(matchId: string, payload: unknown, forceWsRelay = false) {
    if (!forceWsRelay && this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(payload));
      return;
    }
    this.sendWs({ type: 'match-relay', matchId, payload });
  }

  sendWs(packet: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Kết nối WebSocket máy chủ đã đóng.');
    }
    this.ws.send(JSON.stringify(packet));
  }

  async findHumanMatch() {
    await this.connectWs();
    this.sendWs({ type: 'find-match' });
  }

  async findBotMatch() {
    await this.connectWs();
    this.sendWs({ type: 'find-bot-match' });
  }

  async findTournamentMatch(tournamentId: string) {
    await this.connectWs();
    this.sendWs({ type: 'find-tournament-match', tournamentId });
  }

  async findSparringMatch(mode: 'human' | 'bot', tournamentId?: string) {
    await this.connectWs();
    this.sendWs({ type: 'find-sparring-match', mode, tournamentId });
  }

  cancelMatch() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendWs({ type: 'cancel-match' });
    }
  }

  registerSessionKey(matchId: string, publicKey: JsonWebKey) {
    this.sendWs({ type: 'session-key', matchId, publicKey });
  }

  abortBotSetup(matchId: string, message: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendWs({ type: 'bot-setup-failed', matchId, message });
    }
  }

  botForfeit(matchId: string, message: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendWs({ type: 'bot-forfeit', matchId, message });
    }
  }

  closePeerChannel() {
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
  }

  closeSocket() {
    this.closePeerChannel();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

export const backendClient = new BackendClient();
