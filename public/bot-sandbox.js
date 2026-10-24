/* Python bot worker. Pyodide runs each bot off the UI thread. */
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

let pyodidePromise = loadPyodide();
let botReady = false;

function blockBrowserAPIs() {
    const blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts'];
    for (const name of blocked) {
        try {
            Object.defineProperty(self, name, {
                configurable: false,
                writable: false,
                value() { throw new Error('API bị chặn trong sandbox bot'); }
            });
        } catch (_) { /* browser may expose a non-configurable property */ }
    }
}

function normalizeMove(rawMove, gameState) {
    if (!rawMove || typeof rawMove !== 'object') {
        throw new Error('get_next_move() cần trả về dict chứa fromRow, fromCol, toRow, toCol');
    }
    const cols = gameState?.boardCols || 9;
    if (Number.isInteger(rawMove.from) && Number.isInteger(rawMove.to)) {
        return {
            from: rawMove.from,
            to: rawMove.to,
            fromRow: Number.isInteger(rawMove.fromRow) ? rawMove.fromRow : Math.floor(rawMove.from / cols),
            fromCol: Number.isInteger(rawMove.fromCol) ? rawMove.fromCol : rawMove.from % cols,
            toRow: Number.isInteger(rawMove.toRow) ? rawMove.toRow : Math.floor(rawMove.to / cols),
            toCol: Number.isInteger(rawMove.toCol) ? rawMove.toCol : rawMove.to % cols
        };
    }
    if ([rawMove.fromRow, rawMove.fromCol, rawMove.toRow, rawMove.toCol].every(Number.isInteger)) {
        return {
            fromRow: rawMove.fromRow,
            fromCol: rawMove.fromCol,
            toRow: rawMove.toRow,
            toCol: rawMove.toCol,
            from: rawMove.fromRow * cols + rawMove.fromCol,
            to: rawMove.toRow * cols + rawMove.toCol
        };
    }
    throw new Error('Nước đi không hợp lệ: cần đủ tọa độ fromRow, fromCol, toRow, toCol');
}

self.onmessage = async function (event) {
    const msg = event.data || {};
    if (msg.type === 'load-bot' || msg.type === 'check-bot') {
        try {
            const pyodide = await pyodidePromise;
            blockBrowserAPIs();
            botReady = false;
            await pyodide.runPythonAsync(msg.botCode || '');
            const valid = pyodide.runPython(`
import json
if 'get_next_move' not in globals() and 'getNextMove' in globals():
    get_next_move = getNextMove
callable(globals().get('get_next_move'))
`);
            if (!valid) throw new Error('Bot cần định nghĩa hàm get_next_move(my_player_id, game_state)');
            botReady = true;
            self.postMessage({ type: 'bot-loaded', success: true });
        } catch (error) {
            self.postMessage({ type: 'bot-loaded', success: false, error: error.message || 'Không nạp được Python bot' });
        }
        return;
    }

    if (msg.type === 'get-move') {
        if (!botReady) {
            self.postMessage({ type: 'move-result', success: false, error: 'Python bot chưa được nạp' });
            return;
        }
        try {
            const pyodide = await pyodidePromise;
            pyodide.globals.set('__ott_player_id', msg.myPlayerId);
            pyodide.globals.set('__ott_game_state_json', JSON.stringify(msg.gameState));
            const jsonResult = pyodide.runPython(
                'json.dumps(get_next_move(__ott_player_id, json.loads(__ott_game_state_json)))'
            );
            const rawMove = JSON.parse(jsonResult);
            self.postMessage({ type: 'move-result', success: true, move: normalizeMove(rawMove, msg.gameState) });
        } catch (error) {
            self.postMessage({ type: 'move-result', success: false, error: 'Lỗi Python: ' + (error.message || 'không xác định') });
        }
    }
};
