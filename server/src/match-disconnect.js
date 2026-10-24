export async function areBothMatchPlayersOffline(redis, player1Id, player2Id) {
  const [player1Presence, player2Presence] = await Promise.all([
    redis.get(`ottv2:presence:${player1Id}`),
    redis.get(`ottv2:presence:${player2Id}`)
  ]);
  return player1Presence === null && player2Presence === null;
}
