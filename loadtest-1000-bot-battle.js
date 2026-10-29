import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Các chỉ số riêng biệt cho Bot Battle
const botUploadLatency = new Trend('bot_upload_latency_ms', true);
const matchmakingTime = new Trend('bot_matchmaking_time_ms', true);
const matchesCreated = new Counter('matches_created_count');
const wsAuthTime = new Trend('ws_auth_time_ms', true);
const botReadyRelayTime = new Trend('bot_ready_relay_ms', true);
const botErrors = new Counter('bot_battle_errors');

export const options = {
  stages: [
    { duration: '15s', target: 200 },  // Giai đoạn 1: 200 bot vào đấu trường
    { duration: '20s', target: 600 },  // Giai đoạn 2: Tăng nhanh lên 600 bot
    { duration: '25s', target: 1000 }, // Giai đoạn 3: Đỉnh điểm 1,000 bot đấu cùng lúc
    { duration: '20s', target: 1000 }, // Giữ tải đỉnh 1,000 bot
    { duration: '15s', target: 0 },    // Hạ tải kết thúc giải đấu
  ],
  thresholds: {
    http_req_failed: ['rate<0.10'],
    bot_matchmaking_time_ms: ['p(95)<4000'], // 95% ghép trận bot dưới 4 giây
  },
};

const BASE_URL = __ENV.TARGET_URL || 'https://ottv2-backend-46l0.onrender.com';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';

export default function () {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 10000000);
  const userEmail = `bot.tester.${stamp}.${rand}@ottv2.local`;
  const userPass = 'OttBotBattle2026!';
  const userNick = `AI_Bot_${rand.toString().slice(-4)}`;

  // ==========================================
  // HÀNH ĐỘNG 1: Đăng ký tài khoản người chơi/bot
  // ==========================================
  const regRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      email: userEmail,
      password: userPass,
      displayName: userNick,
    }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '8s' }
  );

  const regOk = check(regRes, {
    '1. Đăng ký tài khoản thành công 201': (r) => r.status === 201,
  });
  if (!regOk) {
    botErrors.add(1);
    sleep(2);
    return;
  }
  const token = regRes.json('token');

  // ==========================================
  // HÀNH ĐỘNG 2: Nạp mã nguồn Bot Python hợp lệ
  // ==========================================
  const tUpload = Date.now();
  const botCode = `def get_next_move(my_player_id, game_state):\n    moves = game_state.get('validMoves', [])\n    return moves[0] if moves else None\n`;
  const botRes = http.post(
    `${BASE_URL}/api/bots/me`,
    JSON.stringify({ code: botCode }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: '8s',
    }
  );
  botUploadLatency.add(Date.now() - tUpload);

  const botOk = check(botRes, {
    '2. Nạp Bot Python thành công 201': (r) => r.status === 201,
  });
  if (!botOk) {
    botErrors.add(1);
  }

  // ==========================================
  // HÀNH ĐỘNG 3, 4, 5, 6, 7: WebSocket & Đấu Bot
  // ==========================================
  let authStartTime = 0;
  let searchStartTime = 0;
  let matchId = '';

  const wsRes = ws.connect(WS_URL, { timeout: '10s' }, function (socket) {
    socket.on('open', () => {
      authStartTime = Date.now();
      // Gửi token xác thực tài khoản
      socket.send(JSON.stringify({ type: 'auth', token }));
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        // Đã xác thực -> Gửi yêu cầu tìm trận BOT ĐẤU BOT
        if (msg.type === 'authenticated') {
          wsAuthTime.add(Date.now() - authStartTime);
          searchStartTime = Date.now();
          socket.send(JSON.stringify({ type: 'find-bot-match' }));
        }

        // Đang trong hàng đợi ghép trận
        if (msg.type === 'searching') {
          // In queue
        }

        // Ghép cặp Bot vs Bot thành công!
        if (msg.type === 'match-found') {
          matchmakingTime.add(Date.now() - searchStartTime);
          matchesCreated.add(1);
          matchId = msg.match.id;

          // Bắt tay trao đổi khóa phiên mật mã P-256
          socket.send(
            JSON.stringify({
              type: 'session-key',
              matchId: matchId,
              publicKey: {
                kty: 'EC',
                crv: 'P-256',
                x: 'test-bot-key-x',
                y: 'test-bot-key-y',
              },
            })
          );
        }

        // Nhận xác nhận khóa phiên -> Gửi tín hiệu BOT_READY
        if (msg.type === 'session-key-accepted' || msg.type === 'peer-session-key') {
          const tRelay = Date.now();
          socket.send(
            JSON.stringify({
              type: 'match-relay',
              matchId: matchId,
              payload: { type: 'BOT_READY', botName: userNick },
            })
          );
          botReadyRelayTime.add(Date.now() - tRelay);

          // Giữ kết nối ván đấu bot trong 2 giây (mô phỏng ván cờ tính toán)
          socket.setTimeout(() => socket.close(), 2000);
        }
      } catch {
        socket.close();
      }
    });

    // Timeout an toàn sau 6 giây
    socket.setTimeout(() => socket.close(), 6000);
  });

  check(wsRes, {
    '3. Kết nối WebSocket 101': (r) => r && r.status === 101,
  });

  // ==========================================
  // HÀNH ĐỘNG 8: Tải bảng xếp hạng Elo vinh danh
  // ==========================================
  const lbRes = http.get(`${BASE_URL}/api/leaderboard`, { timeout: '8s' });
  check(lbRes, {
    '4. Bảng xếp hạng Elo 200': (r) => r.status === 200,
  });

  sleep(0.3);
}
