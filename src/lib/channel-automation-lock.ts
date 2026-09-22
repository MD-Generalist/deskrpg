import { AsyncLocalStorage } from "node:async_hooks";

type Lease = { channelId: string; active: boolean };
type ChannelQueue = {
  tails: Map<string, Promise<void>>;
  context: AsyncLocalStorage<Lease>;
};
const KEY = "__deskrpg_channel_automation_queue__";
const shared = globalThis as typeof globalThis & { [KEY]?: ChannelQueue };
const queue = (shared[KEY] ??= {
  tails: new Map(),
  context: new AsyncLocalStorage<Lease>(),
});

/** Next 번들과 소켓 서버가 공유한다. 단일 서버 프로세스의 채널별 실행 순서를 지킨다. */
export async function withChannelAutomationLock<T>(
  channelId: string,
  run: () => Promise<T>,
): Promise<T> {
  const current = queue.context.getStore();
  if (current?.active && current.channelId === channelId) return run();
  const previous = queue.tails.get(channelId) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.tails.set(channelId, tail);
  await previous;
  const lease: Lease = { channelId, active: true };
  try {
    return await queue.context.run(lease, run);
  } finally {
    // fire-and-forget 자식이 이 컨텍스트를 상속했더라도 해제 후 재진입할 수 없다.
    lease.active = false;
    release();
    if (queue.tails.get(channelId) === tail) queue.tails.delete(channelId);
  }
}
