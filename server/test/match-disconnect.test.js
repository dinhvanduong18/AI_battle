import test from 'node:test';
import assert from 'node:assert/strict';
import { areBothMatchPlayersOffline } from '../src/match-disconnect.js';

function presenceStore(values = {}) {
  return {
    get: async key => values[key] ?? null
  };
}

test('only abandons a disconnected match when both player sessions are offline', async () => {
  const player1Key = 'ottv2:presence:player-1';
  const player2Key = 'ottv2:presence:player-2';

  assert.equal(await areBothMatchPlayersOffline(presenceStore(), 'player-1', 'player-2'), true);
  assert.equal(
    await areBothMatchPlayersOffline(presenceStore({ [player1Key]: 'backend-1' }), 'player-1', 'player-2'),
    false
  );
  assert.equal(
    await areBothMatchPlayersOffline(presenceStore({ [player2Key]: 'backend-1' }), 'player-1', 'player-2'),
    false
  );
  assert.equal(
    await areBothMatchPlayersOffline(presenceStore({
      [player1Key]: 'backend-1',
      [player2Key]: 'backend-2'
    }), 'player-1', 'player-2'),
    false
  );
});
