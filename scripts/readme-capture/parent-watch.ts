/**
 * 캡처 서버가 자기를 띄운 프로세스보다 오래 살지 않게 한다.
 *
 * 캡처 서버는 프로세스 그룹째 정리하려고 `detached` 로 뜬다. 그래서 부모가 SIGKILL·Ctrl-C 로
 * 죽어 `finally`·`t.after` 가 돌지 못하면 서버는 그대로 남는다 — 테스트 러너를 중단할 때마다
 * `server-launcher.ts` 고아가 쌓였다(2026-09-21 실측: 한 체크아웃에 7개, 최장 1일 5시간).
 * 부모 쪽 정리는 부모가 살아 있어야 돈다. 확실한 쪽은 자식이 부모를 지켜보는 것이다.
 */
export const PARENT_WATCH_INTERVAL_MS = 1_000;

/** `kill(pid, 0)` 은 신호를 보내지 않고 존재만 본다. ESRCH 만 "없음" 이고 EPERM 은 살아 있다. */
export function processAlive(pid: number, kill: typeof process.kill = process.kill): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 부모가 사라지면 `onGone` 을 한 번 부른다. 돌려준 함수로 감시를 멈춘다. */
export function watchParent(
  parentPid: number,
  onGone: () => void,
  options: { intervalMs?: number; isAlive?: (pid: number) => boolean } = {},
): () => void {
  const isAlive = options.isAlive ?? ((pid: number) => processAlive(pid));
  const timer = setInterval(() => {
    if (isAlive(parentPid)) return;
    clearInterval(timer);
    onGone();
  }, options.intervalMs ?? PARENT_WATCH_INTERVAL_MS);
  // 감시 때문에 서버가 스스로 끝나지 못하는 일은 없어야 한다.
  timer.unref();
  return () => clearInterval(timer);
}
