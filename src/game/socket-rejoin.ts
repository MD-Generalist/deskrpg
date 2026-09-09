/**
 * socket.io 는 재연결하면 **새 socket.id** 를 받는다. 서버의 `players` 맵은 옛 id 로만
 * 채워져 있으므로, 다시 `player:join` 을 보내지 않으면 그 뒤의 chat:send·player:move 가
 * 서버 첫 줄(`players.get(socket.id)`)에서 조용히 버려진다 — 헤더는 "AI 연결" 초록인 채로.
 *
 * 첫 connect 에는 재조인하지 않는다: 스폰 경로(`GameScene.joinMultiplayer`)가 이미 보냈고,
 * 두 번 보내면 다른 클라이언트에 `player:joined` 가 두 번 간다.
 */
/**
 * `setupSocketListeners()` 는 정상 흐름에서 두 번 불린다 — `create()` 의 `request-socket` →
 * `socket-ready` 1차, 그리고 `spawnPlayer()` 의 `player-spawned` → `PhaserGame.tsx` 가 같은
 * 소켓으로 `socket-ready` 를 재발행하는 2차. 씬이 살아 있는 동안 `on` 을 그냥 쌓으면 같은
 * 이벤트에 핸들러가 두 번 걸려, 재조인 1회에 `player:join` 이 두 번 나간다.
 *
 * 씬 전체를 "이미 셋업됨" 플래그로 건너뛰는 대신, 등록 자체를 멱등으로 만든다 — 2차
 * `socket-ready` 가 실제로는 (페이지 레벨 재연결로) 새 소켓을 실어올 수도 있으므로, 메서드
 * 전체를 건너뛰면 그 새 소켓에는 리스너가 아예 안 걸리는 다른 버그가 생긴다.
 */
export function registerOnce<E extends string>(
  bus: { on(event: E, handler: () => void): unknown; off(event: E, handler: () => void): unknown },
  event: E,
  handler: () => void,
): void {
  bus.off(event, handler);
  bus.on(event, handler);
}

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
