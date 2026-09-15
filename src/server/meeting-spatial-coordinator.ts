import type { MeetingSpatialState, MeetingSpatialTarget } from "../lib/meeting-discussion-state";

type Target = MeetingSpatialTarget;
type Dependencies = {
  timeoutMs?: number;
  layout(channelId: string): Promise<{ spaceId: string; targets: Target[] }>;
  capture(channelId: string, actorId: string): Promise<Target | null>;
  reserve(channelId: string, actorId: string, target: Target): Promise<boolean>;
  move(
    channelId: string,
    actorId: string,
    generation: number,
    target: Target,
    returning: boolean,
  ): Promise<boolean>;
  release(channelId: string, actorId: string): Promise<void>;
  returnTarget(channelId: string, actorId: string, origin: Target): Promise<Target | null>;
  publish(state: MeetingSpatialState): void;
};
type Session = {
  state: MeetingSpatialState;
  ownerId: string;
  origins: Map<string, Target>;
  ready: Promise<boolean>;
  resolve: (ready: boolean) => void;
  timer?: ReturnType<typeof setTimeout>;
  cancelRequested?: boolean;
};

/** 회의 공간 상태만 관리한다. 실제 좌석과 이동 소유권은 기존 motion 정본에 위임한다. */
export function createMeetingSpatialCoordinator(deps: Dependencies) {
  const sessions = new Map<string, Session>();
  const playerSockets = new Map<string, string>();
  const operations = new Map<string, Promise<unknown>>();
  const enqueue = <T>(channelId: string, operation: () => Promise<T>): Promise<T> => {
    const pending = (operations.get(channelId) ?? Promise.resolve())
      .catch(() => {})
      .then(operation);
    operations.set(channelId, pending);
    void pending
      .finally(() => {
        if (operations.get(channelId) === pending) operations.delete(channelId);
      })
      .catch(() => {});
    return pending;
  };
  const publish = (s: Session) => deps.publish(structuredClone(s.state));
  const settle = (s: Session, ready: boolean) => {
    clearTimeout(s.timer);
    s.resolve(ready);
  };
  function block(channelId: string, actorId: string, reasonCode: string, generation?: number) {
    const s = sessions.get(channelId);
    if (!s || (generation !== undefined && s.state.generation !== generation)) return;
    const p = s.state.participants.find((p) => p.actorId === actorId);
    if (p) p.state = "blocked";
    s.state.phase = "blocked";
    s.state.failure = { actorId, reasonCode };
    settle(s, false);
    publish(s);
  }
  async function start(channelId: string, ownerId: string, npcIds: string[]) {
    const previous = sessions.get(channelId);
    if (previous && previous.state.phase !== "idle" && previous.state.phase !== "blocked")
      return null;
    // 실패한 준비의 선택 수정은 원래 위치 기록을 유지한 채 같은 참가자를 재배치한다.
    if (
      previous?.state.phase === "blocked" &&
      previous.state.participants.some((p) => p.kind === "npc" && !npcIds.includes(p.actorId))
    ) {
      await cancel(channelId);
      return null;
    }
    let resolve!: (ready: boolean) => void;
    const s: Session = {
      ownerId,
      origins: previous?.origins ?? new Map(),
      ready: new Promise<boolean>((r) => {
        resolve = r;
      }),
      resolve: (v) => resolve(v),
      state: {
        channelId,
        spaceId: previous?.state.spaceId ?? "",
        generation: (previous?.state.generation ?? 0) + 1,
        phase: "assembling",
        participants: [
          ...(previous?.state.participants.filter((p) => p.kind === "player") ?? []),
          ...[...new Set(npcIds)].map((actorId) => ({
            actorId,
            kind: "npc" as const,
            state: "walking" as const,
            seatId: null,
            target: null,
          })),
        ],
        failure: null,
      },
    };
    sessions.set(channelId, s);
    const generation = s.state.generation;
    publish(s);
    const current = () =>
      sessions.get(channelId) === s &&
      s.state.generation === generation &&
      s.state.phase === "assembling" &&
      !s.cancelRequested;
    try {
      const layout = await deps.layout(channelId);
      if (!current()) return generation;
      s.state.spaceId = layout.spaceId;
      for (const p of s.state.participants.filter(
        (p) => p.kind === "player" && p.state === "blocked",
      )) {
        const socketId = playerSockets.get(`${channelId}:${p.actorId}`);
        if (socketId) await joinPlayer(channelId, p.actorId, socketId);
        if (!current()) return generation;
      }
      for (const actorId of [...new Set(npcIds)]) {
        if (!current()) break;
        const p = s.state.participants.find((p) => p.actorId === actorId && p.kind === "npc")!;
        const origin = await deps.capture(channelId, actorId);
        if (!current()) break;
        if (!origin) {
          block(channelId, actorId, "actor_unavailable", generation);
          break;
        }
        if (!s.origins.has(actorId)) s.origins.set(actorId, origin);
        let target: Target | undefined;
        for (const candidate of layout.targets) {
          if (await deps.reserve(channelId, actorId, candidate)) {
            target = candidate;
            break;
          }
          if (!current()) break;
        }
        if (!current()) break;
        if (!target) {
          block(channelId, actorId, "space_full", generation);
          break;
        }
        p.seatId = target.seatId;
        p.target = { x: target.x, y: target.y };
        if (!(await deps.move(channelId, actorId, generation, target, false))) {
          block(channelId, actorId, "movement_unavailable", generation);
          break;
        }
      }
      if (current() && npcIds.length === 0)
        block(channelId, ownerId, "actor_unavailable", generation);
      if (current()) {
        publish(s);
        s.timer = setTimeout(() => {
          const p = s.state.participants.find((p) => p.state === "walking");
          if (p) block(channelId, p.actorId, "arrival_timeout", generation);
        }, deps.timeoutMs ?? 120_000);
        s.timer.unref();
      }
    } catch {
      if (current()) block(channelId, npcIds[0] ?? ownerId, "layout_unavailable", generation);
    }
    return generation;
  }
  async function joinPlayer(channelId: string, userId: string, socketId: string) {
    let s = sessions.get(channelId);
    if (!s) {
      s = {
        ownerId: userId,
        origins: new Map(),
        ready: Promise.resolve(false),
        resolve: () => {},
        state: {
          channelId,
          spaceId: "",
          generation: 0,
          phase: "idle",
          participants: [],
          failure: null,
        },
      };
      sessions.set(channelId, s);
    }
    const key = `${channelId}:${userId}`;
    const previousSocket = playerSockets.get(key);
    if (previousSocket && previousSocket !== socketId)
      await deps.release(channelId, previousSocket);
    playerSockets.set(key, socketId);
    const existing = s.state.participants.find((p) => p.actorId === userId && p.kind === "player");
    if (existing && previousSocket === socketId && existing.state !== "blocked") return true;
    const p: MeetingSpatialState["participants"][number] = existing ?? {
      actorId: userId,
      kind: "player",
      state: "walking",
      target: null,
      seatId: null,
    };
    if (!existing) s.state.participants.push(p);
    try {
      const layout = await deps.layout(channelId);
      s.state.spaceId = layout.spaceId;
      for (const target of layout.targets)
        if (await deps.reserve(channelId, socketId, target)) {
          p.state = "walking";
          p.target = { x: target.x, y: target.y };
          p.seatId = target.seatId;
          publish(s);
          return true;
        }
      block(channelId, userId, "space_full");
    } catch {
      block(channelId, userId, "layout_unavailable");
    }
    return false;
  }
  async function leavePlayer(channelId: string, userId: string, socketId: string) {
    if (playerSockets.get(`${channelId}:${userId}`) !== socketId) return;
    playerSockets.delete(`${channelId}:${userId}`);
    await deps.release(channelId, socketId);
    const s = sessions.get(channelId);
    if (!s) return;
    s.state.participants = s.state.participants.filter(
      (p) => p.kind !== "player" || p.actorId !== userId,
    );
    if (s.state.phase === "assembling") block(channelId, userId, "participant_left");
    else publish(s);
  }
  function arrived(channelId: string, actorId: string, generation: number) {
    const s = sessions.get(channelId);
    if (!s || s.state.generation !== generation || s.cancelRequested) return false;
    const p = s.state.participants.find((p) => p.actorId === actorId);
    if (!p || (p.state !== "walking" && p.state !== "returning")) return false;
    p.state = p.seatId ? "seated" : "standing";
    if (
      s.state.phase === "returning" &&
      s.state.participants.every((p) => p.state !== "returning")
    ) {
      s.state.phase = "idle";
      clearTimeout(s.timer);
      s.state.participants = s.state.participants.filter((p) => p.kind === "player");
      s.origins.clear();
    } else if (
      s.state.phase === "assembling" &&
      s.state.participants.every((p) => p.state === "seated" || p.state === "standing")
    ) {
      s.state.phase = "ready";
      settle(s, true);
    }
    publish(s);
    return true;
  }
  async function cancel(channelId: string) {
    const s = sessions.get(channelId);
    if (!s || s.state.phase === "idle" || s.state.phase === "returning") return;
    settle(s, false);
    s.cancelRequested = false;
    const generation = ++s.state.generation;
    s.state.phase = "returning";
    s.state.failure = null;
    const npcs = s.state.participants.filter((p) => p.kind === "npc");
    for (const p of npcs) p.state = "returning";
    publish(s);
    s.timer = setTimeout(() => {
      const p = s.state.participants.find((p) => p.state === "returning");
      if (p) block(channelId, p.actorId, "return_timeout", generation);
    }, deps.timeoutMs ?? 120_000);
    s.timer.unref();
    for (const p of npcs) {
      const origin = s.origins.get(p.actorId);
      if (!origin) {
        s.state.participants = s.state.participants.filter((other) => other !== p);
        continue;
      }
      await deps.release(channelId, p.actorId);
      const target = await deps.returnTarget(channelId, p.actorId, origin);
      if (!target || !(await deps.reserve(channelId, p.actorId, target))) {
        block(channelId, p.actorId, "return_space_full", generation);
        continue;
      }
      p.seatId = target.seatId;
      p.target = { x: target.x, y: target.y };
      if (!(await deps.move(channelId, p.actorId, generation, target, true)))
        block(channelId, p.actorId, "return_unavailable", generation);
    }
    if (!s.state.participants.some((p) => p.kind === "npc")) {
      s.state.phase = "idle";
      s.origins.clear();
    }
    publish(s);
  }
  return {
    start: (channelId: string, ownerId: string, npcIds: string[]) =>
      enqueue(channelId, () => start(channelId, ownerId, npcIds)),
    cancel: (channelId: string) => {
      const s = sessions.get(channelId);
      if (s && s.state.phase !== "returning" && s.state.phase !== "idle") {
        s.cancelRequested = true;
        settle(s, false);
      }
      return enqueue(channelId, () => cancel(channelId));
    },
    arrived,
    block,
    joinPlayer: (channelId: string, userId: string, socketId: string) =>
      enqueue(channelId, () => joinPlayer(channelId, userId, socketId)),
    leavePlayer: (channelId: string, userId: string, socketId: string) =>
      enqueue(channelId, () => leavePlayer(channelId, userId, socketId)),
    playerArrived(channelId: string, userId: string, socketId: string) {
      const s = sessions.get(channelId);
      if (s && playerSockets.get(`${channelId}:${userId}`) === socketId)
        arrived(channelId, userId, s.state.generation);
    },
    snapshot: (channelId: string) => {
      const s = sessions.get(channelId);
      return s ? structuredClone(s.state) : null;
    },
    ready: (channelId: string, generation: number) => {
      const s = sessions.get(channelId);
      return s?.state.generation === generation ? s.ready : Promise.resolve(false);
    },
    owner: (channelId: string) => sessions.get(channelId)?.ownerId,
  };
}
export type MeetingSpatialCoordinator = ReturnType<typeof createMeetingSpatialCoordinator>;
