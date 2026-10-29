import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
// @ts-ignore
import { htmlReport } from './scripts/k6-reporter.js';
// @ts-ignore
import { textSummary } from './scripts/k6-summary.js';

export const options = {
  stages: [
    { duration: '3s', target: 20 },   // Khởi động nhanh (20 VUs)
    { duration: '7s', target: 80 },   // Đẩy tải lên 80 VUs
    { duration: '5s', target: 150 },  // Đỉnh tải cao (150 VUs đồng thời)
    { duration: '3s', target: 0 },    // Hạ tải về 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'], // 95% request phải phản hồi dưới 400ms
    http_req_failed: ['rate<0.02'],   // Tỷ lệ lỗi dưới 2%
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:3000';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';

export default function () {
  // 1. HTTP Endpoint: Health Check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'GET /health status is 200': (r) => r.status === 200,
  });

  // 2. HTTP Endpoint: Đăng ký tài khoản (Test CPU & scrypt)
  // Thực hiện ngẫu nhiên với tỷ lệ 15% số lượt lặp để không làm phình DB quá nhanh
  if (Math.random() < 0.15) {
    const stamp = Date.now();
    const rand = Math.floor(Math.random() * 100000);
    const regPayload = JSON.stringify({
      email: `k6.${stamp}.${rand}@loadtest.local`,
      password: 'SecurePassword123!',
      displayName: `K6User_${rand}`,
    });
    const regRes = http.post(`${BASE_URL}/api/auth/register`, regPayload, {
      headers: { 'Content-Type': 'application/json' },
    });
    check(regRes, {
      'POST /api/auth/register status is 201': (r) => r.status === 201,
    });
  }

  // 3. WebSocket Endpoint: Mở kết nối & gửi Ping
  const params = { tags: { protocol: 'websocket' } };
  const wsRes = ws.connect(WS_URL, params, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'ping' }));
    });

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'pong') {
          socket.close();
        }
      } catch {
        socket.close();
      }
    });

    socket.setTimeout(function () {
      socket.close();
    }, 2500);
  });

  check(wsRes, {
    'WebSocket /ws handshaked 101': (r) => r && r.status === 101,
  });

  sleep(0.05);
}

export function handleSummary(data) {
  return {
    'k6-report.html': htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
