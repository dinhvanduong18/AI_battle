import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
// @ts-ignore
import { htmlReport } from './scripts/k6-reporter.js';
// @ts-ignore
import { textSummary } from './scripts/k6-summary.js';

// Các chỉ số riêng cho ghép trận
const matchmakingTime = new Trend('matchmaking_time_ms', true);
const matchesCreated = new Counter('matches_created_count');
const wsAuthTime = new Trend('ws_auth_time_ms', true);

export const options = {
  stages: [
    { duration: '3s', target: 10 },  // 10 người tìm trận
    { duration: '8s', target: 50 },  // 50 người tìm trận đồng thời
    { duration: '5s', target: 100 }, // Đỉnh tải 100 người ghép cặp liên tục
    { duration: '3s', target: 0 },   // Hạ tải
  ],
  thresholds: {
    matchmaking_time_ms: ['p(95)<2000'], // 95% số trận ghép thành công trong dưới 2 giây
    ws_auth_time_ms: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:3000';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';

export default function () {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1000000);

  // 1. Đăng ký tài khoản nhanh để có token hợp lệ
  const regRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      email: `mm.k6.${stamp}.${rand}@matchtest.local`,
      password: 'MatchmakingPass123!',
      displayName: `Player_${rand}`,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (regRes.status !== 201) {
    return;
  }
  const token = regRes.json('token');

  // 2. Mở kết nối WebSocket và tham gia Hàng đợi ghép trận
  let searchStartTime = 0;
  let authStartTime = 0;

  ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', () => {
      authStartTime = Date.now();
      // Gửi token xác thực
      socket.send(JSON.stringify({ type: 'auth', token }));
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === 'authenticated') {
          wsAuthTime.add(Date.now() - authStartTime);
          // Gửi lệnh tìm trận Người vs Người
          searchStartTime = Date.now();
          socket.send(JSON.stringify({ type: 'find-match' }));
        }

        if (msg.type === 'searching') {
          // Đang trong hàng đợi chờ đối thủ
        }

        if (msg.type === 'match-found') {
          // GHÉP TRẬN THÀNH CÔNG!
          const duration = Date.now() - searchStartTime;
          matchmakingTime.add(duration);
          matchesCreated.add(1);

          // Gửi khóa phiên P-256
          socket.send(
            JSON.stringify({
              type: 'session-key',
              matchId: msg.match.id,
              key: {
                kty: 'EC',
                crv: 'P-256',
                x: 'test-pub-key-x',
                y: 'test-pub-key-y',
              },
            })
          );
          // Đóng socket sau khi đã hoàn tất bắt tay ghép trận
          socket.setTimeout(function () {
            socket.close();
          }, 300);
        }

        if (msg.type === 'peer-session-key') {
          // Nhận được khóa đối thủ -> hoàn tất handshake
          socket.close();
        }
      } catch {
        socket.close();
      }
    });

    // Timeout nếu quá 3 giây chưa ghép xong
    socket.setTimeout(function () {
      socket.close();
    }, 3000);
  });

  sleep(0.1);
}

export function handleSummary(data) {
  return {
    'k6-matchmaking-report.html': htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
