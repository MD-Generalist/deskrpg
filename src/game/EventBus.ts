// 브라우저와 SSR 양쪽에서 도는 단순 EventEmitter. 모듈 수준에서 `window` 를 만지지 않는다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

class SimpleEventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
    return this;
  }

  removeListener(event: string, fn?: Listener): this {
    if (fn) {
      this.listeners.get(event)?.delete(fn);
    } else {
      this.listeners.delete(event);
    }
    return this;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}

export const EventBus = new SimpleEventEmitter();

export type PendingChannelData = {
  channelId: string;
  mapRevision?: string;
  mapData: unknown;
  tiledJson?: unknown;
  mapConfig?: unknown;
  /** 채널의 NPC 걸음 속도(`npc-motion-config`). 비어 있으면 기본값. */
  motionConfig?: unknown;
  savedPosition?: { x: number; y: number } | null;
} | null;

const PENDING_CHANNEL_DATA_KEY = "__deskrpgPendingChannelData";

function readPendingChannelData(): PendingChannelData {
  if (typeof globalThis === "undefined") return null;
  return (
    (globalThis as typeof globalThis & { [PENDING_CHANNEL_DATA_KEY]?: PendingChannelData })[
      PENDING_CHANNEL_DATA_KEY
    ] ?? null
  );
}

function writePendingChannelData(data: PendingChannelData) {
  if (typeof globalThis === "undefined") return;
  (globalThis as typeof globalThis & { [PENDING_CHANNEL_DATA_KEY]?: PendingChannelData })[
    PENDING_CHANNEL_DATA_KEY
  ] = data;
}

// 대기 중인 채널 데이터 — 시뮬레이션이 시작하기 전에 두고, start() 가 읽어 소비한다
export let pendingChannelData: PendingChannelData = readPendingChannelData();

export function setPendingChannelData(data: PendingChannelData) {
  pendingChannelData = data;
  writePendingChannelData(data);
}
