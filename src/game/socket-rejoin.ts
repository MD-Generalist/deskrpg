/**
 * socket.io 는 재연결하면 **새 socket.id** 를 받는다. 서버의 `players` 맵은 옛 id 로만
 * 채워져 있으므로, 다시 `player:join` 을 보내지 않으면 그 뒤의 chat:send·player:move 가
 * 서버 첫 줄(`players.get(socket.id)`)에서 조용히 버려진다 — 헤더는 "AI 연결" 초록인 채로.
 *
 * 첫 connect 에는 재조인하지 않는다: 스폰 경로(`OfficeSimulation.joinMultiplayer`)가 이미 보냈고,
 * 두 번 보내면 다른 클라이언트에 `player:joined` 가 두 번 간다.
 */
/**
 * `setupSocketListeners()` 는 정상 흐름에서 두 번 불린다 — 부팅의 `request-socket` →
 * `socket-ready` 1차, 그리고 `createPlayer()` 의 `player-spawned` → `ThreeGame.tsx` 가 같은
 * 소켓으로 `socket-ready` 를 재발행하는 2차. 시뮬레이션이 살아 있는 동안 `on` 을 그냥 쌓으면 같은
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

/**
 * `EventBus "socket-rejoin"` 경로(Task 3 이 `chat:error not_joined` 를 받으면 emit)는
 * `connect` 트래커와 경쟁한다: 실제 순서는 disconnect → 유저가 chat 을 보냄(socket.io 가
 * 버퍼링) → reconnect: socket.io-client 는 버퍼링된 `chat:send` 를 **유저 `connect`
 * 리스너보다 먼저** 플러시한다 → 서버가 `chat:error not_joined` 로 응답 → 그제서야 connect
 * 핸들러가 join(#1) → 뒤늦게 도착한 chat:error 핸들러가 또 join(#2). 같은 소켓에 두 번.
 *
 * "이 소켓 id 로 이미 join 했는가" 만 보면 된다 — 같은 id 면 #1 이 이미 처리했으니 건너뛰고,
 * id 가 다르면(또는 아직 없으면, 즉 disconnected 상태) 이 join 은 아직 안 나간 것이므로
 * 내보낸다. `currentSocketId` 가 undefined(연결 끊긴 순간)인 경우도 "이 id 로는 아직
 * join 안 함" 으로 취급해 내보낸다 — socket.io 가 버퍼링해 뒀다가 재연결 시 보낸다.
 */
export function shouldRejoinForError(
  currentSocketId: string | undefined,
  joinedSocketId: string | undefined,
): boolean {
  if (currentSocketId === undefined || joinedSocketId === undefined) return true;
  return currentSocketId !== joinedSocketId;
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
