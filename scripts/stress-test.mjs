#!/usr/bin/env node
import { WebSocket } from 'ws';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const hasFlag = (flag) => args.includes(flag);

const TARGET_URL = getArg('--target', process.env.TARGET_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const WS_URL = TARGET_URL.replace(/^http/, 'ws') + '/ws';
const CONCURRENCY = Number(getArg('--concurrency', 100));
const DURATION_SEC = Number(getArg('--duration', 10));
const HTTP_ONLY = hasFlag('--http-only');
const WS_ONLY = hasFlag('--ws-only');

function calculatePercentiles(latencies) {
  if (!latencies.length) return { min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const getP = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    min: sorted[0].toFixed(1),
    p50: getP(50).toFixed(1),
    p90: getP(90).toFixed(1),
    p95: getP(95).toFixed(1),
    p99: getP(99).toFixed(1),
    max: sorted[sorted.length - 1].toFixed(1),
  };
}

async function runHttpStress() {
  console.log(`\n======================================================`);
  console.log(`🚀 BẮT ĐẦU TEST TẢI HTTP API: ${TARGET_URL}`);
  console.log(`- Mức đồng thời (Concurrency): ${CONCURRENCY} workers`);
  console.log(`- Thời gian test: ${DURATION_SEC} giây`);
  console.log(`======================================================\n`);

  const latencies = [];
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;
  const startTime = performance.now();
  const endTime = startTime + DURATION_SEC * 1000;

  async function worker(workerId) {
    let reqIndex = 0;
    while (performance.now() < endTime) {
      reqIndex++;
      const reqStart = performance.now();
      try {
        // Luân phiên giữa Health check và User profile / login
        const email = `stress.w${workerId}.${reqIndex}.${Date.now()}@test.local`;
        const res = await fetch(`${TARGET_URL}/health`, { method: 'GET' });
        const latency = performance.now() - reqStart;
        latencies.push(latency);
        totalRequests++;
        if (res.ok) {
          successfulRequests++;
        } else {
          failedRequests++;
        }
      } catch (err) {
        failedRequests++;
        totalRequests++;
      }
      // Micro sleep để chống bão request vô tận chiếm hết socket loop
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  const totalDurationSec = (performance.now() - startTime) / 1000;
  const rps = (totalRequests / totalDurationSec).toFixed(1);
  const stats = calculatePercentiles(latencies);

  console.log(`📊 KẾT QUẢ TEST HTTP (GET /health):`);
  console.log(`  - Tổng requests:        ${totalRequests}`);
  console.log(`  - Thành công (2xx):     ${successfulRequests} (${((successfulRequests / totalRequests) * 100 || 0).toFixed(1)}%)`);
  console.log(`  - Thất bại / Lỗi:       ${failedRequests}`);
  console.log(`  - Throughput (RPS):     ${rps} req/sec`);
  console.log(`  - Latency:`);
  console.log(`      Min:  ${stats.min} ms`);
  console.log(`      p50:  ${stats.p50} ms`);
  console.log(`      p90:  ${stats.p90} ms`);
  console.log(`      p95:  ${stats.p95} ms`);
  console.log(`      p99:  ${stats.p99} ms`);
  console.log(`      Max:  ${stats.max} ms`);
}

async function runAuthStress() {
  console.log(`\n======================================================`);
  console.log(`🔐 BẮT ĐẦU TEST TẢI ĐĂNG KÝ & BĂM MẬT KHẨU (scrypt CPU)`);
  console.log(`- Tạo ${Math.min(CONCURRENCY, 50)} tài khoản đồng thời`);
  console.log(`======================================================\n`);

  const count = Math.min(CONCURRENCY, 50);
  const latencies = [];
  let success = 0;
  let fail = 0;
  const start = performance.now();

  const promises = Array.from({ length: count }, async (_, i) => {
    const email = `auth.test.${Date.now()}.${i}@stress.local`;
    const t0 = performance.now();
    try {
      const res = await fetch(`${TARGET_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'Password123456!',
          displayName: `User ${i}`,
        }),
      });
      const t1 = performance.now();
      latencies.push(t1 - t0);
      if (res.status === 201) success++;
      else fail++;
    } catch {
      fail++;
    }
  });

  await Promise.all(promises);
  const duration = (performance.now() - start) / 1000;
  const stats = calculatePercentiles(latencies);

  console.log(`📊 KẾT QUẢ ĐĂNG KÝ ĐỒNG THỜI:`);
  console.log(`  - Tổng tài khoản:   ${count}`);
  console.log(`  - Thành công:       ${success}`);
  console.log(`  - Thất bại:         ${fail}`);
  console.log(`  - Tổng thời gian:   ${duration.toFixed(2)}s (${(count / duration).toFixed(1)} đăng ký/giây)`);
  console.log(`  - Latency p50:      ${stats.p50} ms | p95: ${stats.p95} ms | Max: ${stats.max} ms`);
}

async function runWsStress() {
  console.log(`\n======================================================`);
  console.log(`⚡ BẮT ĐẦU TEST TẢI KẾT NỐI WEBSOCKET (/ws): ${WS_URL}`);
  console.log(`- Số lượng kết nối đồng thời: ${CONCURRENCY} sockets`);
  console.log(`======================================================\n`);

  let connected = 0;
  let failed = 0;
  const connectLatencies = [];
  const pingLatencies = [];
  const sockets = [];

  console.log(`⏳ Đang mở đồng thời ${CONCURRENCY} kết nối WebSocket...`);
  const connectStart = performance.now();

  const connectPromises = Array.from({ length: CONCURRENCY }, (_, i) => {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let done = false;
      try {
        const ws = new WebSocket(WS_URL);
        const timeout = setTimeout(() => {
          if (!done) {
            done = true;
            failed++;
            ws.terminate();
            resolve();
          }
        }, 10000);

        ws.on('open', () => {
          if (!done) {
            done = true;
            clearTimeout(timeout);
            connectLatencies.push(performance.now() - t0);
            connected++;
            sockets.push(ws);
            resolve();
          }
        });

        ws.on('error', () => {
          if (!done) {
            done = true;
            clearTimeout(timeout);
            failed++;
            resolve();
          }
        });
      } catch {
        if (!done) {
          done = true;
          failed++;
          resolve();
        }
      }
    });
  });

  await Promise.all(connectPromises);
  const connectDuration = (performance.now() - connectStart) / 1000;
  const connectStats = calculatePercentiles(connectLatencies);

  console.log(`\n📊 KẾT QUẢ KẾT NỐI WEBSOCKET:`);
  console.log(`  - Mở thành công:      ${connected}/${CONCURRENCY} (${((connected / CONCURRENCY) * 100).toFixed(1)}%)`);
  console.log(`  - Kết nối thất bại:   ${failed}`);
  console.log(`  - Tổng thời gian mở:  ${connectDuration.toFixed(2)}s (${(connected / connectDuration).toFixed(1)} conn/sec)`);
  console.log(`  - Connect Latency:    p50: ${connectStats.p50} ms | p95: ${connectStats.p95} ms | Max: ${connectStats.max} ms`);

  if (sockets.length > 0) {
    console.log(`\n🔄 Đang thử nghiệm gửi Ping đồng thời qua ${sockets.length} WebSocket...`);
    const pingStart = performance.now();
    const pingPromises = sockets.map((ws) => {
      return new Promise((resolve) => {
        const t0 = performance.now();
        const timer = setTimeout(resolve, 3000);
        ws.once('message', () => {
          clearTimeout(timer);
          pingLatencies.push(performance.now() - t0);
          resolve();
        });
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    await Promise.all(pingPromises);
    const pingStats = calculatePercentiles(pingLatencies);
    console.log(`  - Ping RTT Latency:   p50: ${pingStats.p50} ms | p95: ${pingStats.p95} ms | Max: ${pingStats.max} ms`);

    console.log(`🧹 Đóng ${sockets.length} kết nối an toàn...`);
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {}
    }
  }
}

async function main() {
  console.log(`======================================================`);
  console.log(`🎯 AI_BATTLE LOAD & STRESS TESTING RUNNER`);
  console.log(`======================================================`);

  try {
    const health = await fetch(`${TARGET_URL}/health`).then((r) => r.json()).catch(() => null);
    if (!health) {
      console.error(`❌ Không kết nối được tới server tại ${TARGET_URL}!`);
      console.error(`👉 Hãy chắc chắn server đang chạy (ví dụ: npm run dev hoặc docker compose up)`);
      process.exit(1);
    }
    console.log(`✅ Server online (Mode: ${health.mode || 'local'})`);

    if (!WS_ONLY) {
      await runHttpStress();
      await runAuthStress();
    }
    if (!HTTP_ONLY) {
      await runWsStress();
    }

    console.log(`\n✨ HOÀN TẤT KIỂM THỬ TẢI TOÀN BỘ!\n`);
  } catch (err) {
    console.error(`Lỗi trong quá trình stress test:`, err);
    process.exit(1);
  }
}

main();
