export interface BotMoveResponse {
  from: number;
  to: number;
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  elapsedMs: number;
}

export class BotRunner {
  name: string;
  timeoutMs: number;
  worker: Worker | null = null;
  ready = false;
  lastElapsedMs = 0;

  constructor(name = 'Python Bot', timeoutMs = 200) {
    this.name = name;
    this.timeoutMs = timeoutMs;
  }

  static async checkSyntax(botCode: string): Promise<{ ok: boolean; error?: string }> {
    const tester = new BotRunner('SyntaxChecker', 5000);
    try {
      await tester.loadBot(botCode, 'SyntaxChecker');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Lỗi cú pháp Python.' };
    } finally {
      tester.destroy();
    }
  }

  async loadBot(botCode: string, name?: string): Promise<void> {
    if (name) this.name = name;
    this.destroy();

    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker('/bot-sandbox.js', { type: 'module' });
        this.worker = worker;
      } catch (err: any) {
        reject(new Error('Không thể khởi tạo Web Worker: ' + err.message));
        return;
      }

      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.destroy();
        reject(err);
      };

      const timer = setTimeout(
        () => fail(new Error(`Quá thời gian khởi tạo runtime Python cho "${this.name}"`)),
        60000
      );

      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.type !== 'bot-loaded' || settled) return;
        settled = true;
        cleanup();
        if (data.success) {
          this.ready = true;
          resolve();
        } else {
          this.destroy();
          reject(new Error(data.error || 'Nạp Bot Python thất bại.'));
        }
      };

      const onError = (event: ErrorEvent) =>
        fail(new Error('Lỗi Sandbox Worker: ' + (event.message || 'không xác định')));

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ type: 'load-bot', botCode });
    });
  }

  async getMove(myPlayerId: 1 | 2, gameState: unknown): Promise<BotMoveResponse> {
    if (!this.ready || !this.worker) {
      throw new Error(`Bot "${this.name}" chưa được nạp sẵn sàng.`);
    }
    const worker = this.worker;
    const start = performance.now();

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };

      const fail = (err: Error, terminate = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (terminate) this.destroy();
        reject(err);
      };

      const timer = setTimeout(() => {
        const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
        const err = Object.assign(
          new Error(`TLE: Bot "${this.name}" vượt quá giới hạn ${this.timeoutMs}ms (mất ${elapsedMs}ms)`),
          { isTimeout: true, elapsedMs }
        );
        fail(err, true);
      }, this.timeoutMs);

      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.type !== 'move-result' || settled) return;
        const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
        if (!data.success) {
          fail(new Error(data.error || 'Bot không trả về nước đi hợp lệ.'));
          return;
        }
        settled = true;
        cleanup();
        this.lastElapsedMs = elapsedMs;
        resolve({ ...data.move, elapsedMs });
      };

      const onError = (event: ErrorEvent) =>
        fail(new Error('Lỗi runtime Worker: ' + (event.message || 'không xác định')), true);

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ type: 'get-move', myPlayerId, gameState });
    });
  }

  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
  }
}
