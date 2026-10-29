import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
// @ts-ignore
import { htmlReport } from './scripts/k6-reporter.js';
// @ts-ignore
import { textSummary } from './scripts/k6-summary.js';

// Kịch bản kiểm tra ngưỡng TẢI CAO (Stress Test) nhằm tìm giới hạn chịu tải tối đa của server Render (0.1 CPU, 512MB RAM)
export const options = {
  stages: [
    { duration: '5s', target: 50 },   // Khởi động nhanh: 50 users
    { duration: '10s', target: 150 }, // Mức 1: 150 users (Vượt qua tải thông thường)
    { duration: '15s', target: 250 }, // Mức 2: 250 users (Tiệm cận ngưỡng RAM/CPU 0.1)
    { duration: '15s', target: 350 }, // Mức 3: 350 users (Ép tải đỉnh điểm xem có sập/nghẽn không)
    { duration: '10s', target: 0 },   // Hạ tải về 0
  ],
  thresholds: {
    // Với 0.1 CPU khi chịu tải 350 CCU, độ trễ p95 sẽ tăng
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.15'], // Tỷ lệ lỗi cho phép tối đa 15% khi stress đỉnh
  },
};

const BASE_URL = __ENV.TARGET_URL || 'https://ottv2-backend-46l0.onrender.com';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';

export default function () {
  // 1. Kiểm tra sức tải HTTP Endpoint (/health)
  const healthRes = http.get(`${BASE_URL}/health`, { timeout: '10s' });
  check(healthRes, {
    'GET /health thành công 200': (r) => r.status === 200,
  });

  // 2. Thử nghiệm mở kết nối WebSocket giữ kết nối (CCU) và Ping
  const params = { tags: { protocol: 'websocket' } };
  const wsRes = ws.connect(WS_URL, params, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'ping' }));
    });

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'pong') {
          // Giữ socket mở trong 1.5 giây để mô phỏng CCU online thực tế
          socket.setTimeout(function () {
            socket.close();
          }, 1500);
        }
      } catch {
        socket.close();
      }
    });

    socket.setTimeout(function () {
      socket.close();
    }, 4000);
  });

  check(wsRes, {
    'WebSocket /ws kết nối thành công 101': (r) => r && r.status === 101,
  });

  sleep(0.1);
}

export function handleSummary(data) {
  return {
    'k6-high-stress-report.html': htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
