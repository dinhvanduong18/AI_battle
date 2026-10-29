import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
// @ts-ignore
import { htmlReport } from './scripts/k6-reporter.js';
// @ts-ignore
import { textSummary } from './scripts/k6-summary.js';

const httpLatency = new Trend('http_latency_ms', true);
const wsHandshakeTime = new Trend('ws_handshake_ms', true);
const httpFailures = new Counter('http_failure_count');
const wsFailures = new Counter('ws_failure_count');

// Kịch bản kiểm tra tải cực đại: 900 NGƯỜI DÙNG ĐỒNG THỜI (900 CCU)
export const options = {
  stages: [
    { duration: '10s', target: 200 }, // Khởi động: 200 CCU
    { duration: '15s', target: 500 }, // Bậc 2: 500 CCU
    { duration: '20s', target: 900 }, // Bậc 3: Đẩy lên đỉnh 900 CCU
    { duration: '15s', target: 900 }, // Giữ tải đỉnh 900 CCU
    { duration: '10s', target: 0 },   // Hạ tải về 0
  ],
  thresholds: {
    http_req_failed: ['rate<0.50'], // Theo dõi tỷ lệ lỗi
  },
};

const BASE_URL = __ENV.TARGET_URL || 'https://ottv2-backend-46l0.onrender.com';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';

export default function () {
  // 1. Kiểm tra sức tải HTTP Endpoint (/health)
  const tHttp = Date.now();
  const healthRes = http.get(`${BASE_URL}/health`, { timeout: '8s' });
  const httpOk = check(healthRes, {
    'GET /health 200 OK': (r) => r.status === 200,
  });
  if (!httpOk) {
    httpFailures.add(1);
  }
  httpLatency.add(Date.now() - tHttp);

  // 2. Mở kết nối WebSocket giữ kết nối đồng thời và ping/pong
  const tWs = Date.now();
  const wsRes = ws.connect(WS_URL, { timeout: '8s' }, function (socket) {
    socket.on('open', () => {
      wsHandshakeTime.add(Date.now() - tWs);
      socket.send(JSON.stringify({ type: 'ping' }));
    });

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'pong') {
          // Giữ socket mở trong 1.5 giây để duy trì CCU
          socket.setTimeout(() => socket.close(), 1500);
        }
      } catch {
        socket.close();
      }
    });

    socket.setTimeout(() => socket.close(), 3500);
  });

  const wsOk = check(wsRes, {
    'WebSocket 101 Switching': (r) => r && r.status === 101,
  });
  if (!wsOk) {
    wsFailures.add(1);
  }

  sleep(0.2);
}

export function handleSummary(data) {
  const reportName = __ENV.REPORT_FILE || 'k6-900-users-report.html';
  return {
    [reportName]: htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
