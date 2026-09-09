/**
 * socket.io 는 재연결하면 **새 socket.id** 를 받는다. 서버의 `players` 맵은 옛 id 로만
 * 채워져 있으므로, 다시 `player:join` 을 보내지 않으면 그 뒤의 chat:send·player:move 가
 * 서버 첫 줄(`players.get(socket.id)`)에서 조용히 버려진다 — 헤더는 "AI 연결" 초록인 채로.
 *
 * 첫 connect 에는 재조인하지 않는다: 스폰 경로(`GameScene.joinMultiplayer`)가 이미 보냈고,
 * 두 번 보내면 다른 클라이언트에 `player:joined` 가 두 번 간다.
 */
export function createRejoinTracker() {
  let disconnected = false;
  return {
    onDisconnect() {
      disconnected = true;
    },
    shouldRejoin(playerReady: boolean): boolean {
      if (!disconnected || !playerReady) return false;
      disconnected = false;
      return true;
    },
  };
}
