import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
// @ts-ignore
import { htmlReport } from './scripts/k6-reporter.js';
// @ts-ignore
import { textSummary } from './scripts/k6-summary.js';

// Kịch bản kiểm tra ngưỡng tối đa của server Render (0.1 CPU, 512MB RAM)
export const options = {
  stages: [
    { duration: '5s', target: 20 },   // Mức 1: 20 người dùng (Tải nhẹ)
    { duration: '10s', target: 50 },  // Mức 2: 50 người dùng (Tải trung bình)
    { duration: '15s', target: 100 }, // Mức 3: 100 người dùng (Tải cao)
    { duration: '10s', target: 150 }, // Mức 4: 150 người dùng (Ngưỡng áp lực tối đa của 0.1 CPU)
    { duration: '5s', target: 0 },    // Hạ tải về 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<2500'], // Cho phép độ trễ mạng Internet từ Việt Nam tới Singapore/US
    http_req_failed: ['rate<0.05'],    // Tỷ lệ lỗi dưới 5%
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
    'k6-render-stress-report.html': htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
