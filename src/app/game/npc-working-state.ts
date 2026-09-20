/**
 * 맵의 "작업 중" 상태(R27) — 채널 소켓의 `npc:working` 을 NPC 별로 접는다.
 *
 * 서버(`automation-events.ts`)는 값이 바뀔 때만 쏘고, 접속(`player:join`) 때는 지금 작업 중인
 * NPC 만 스냅샷으로 준다. 그래서 클라이언트의 기본값은 "작업 아님" 이고, `working:false` 는
 * 항목을 지운다. 낙관적 갱신은 없다(R26) — 이 맵은 서버가 말한 것만 담는다.
 *
 * 서버 모듈을 import 하지 않는다 — 클라이언트 번들 경계(`client-bundle-boundary.test.ts`).
 */

export type NpcWorkingPayload = {
  npcId: string;
  working: boolean;
  sources: { runningCards: number; cronRuns: number };
};

export type NpcWorkingMap = Readonly<Record<string, NpcWorkingPayload>>;

export const EMPTY_NPC_WORKING: NpcWorkingMap = Object.freeze({});

/** 페이로드 모양이 아니면 null — 소켓에서 온 값을 그대로 믿지 않는다. */
export function parseNpcWorkingPayload(raw: unknown): NpcWorkingPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<NpcWorkingPayload>;
  if (typeof p.npcId !== "string" || !p.npcId || typeof p.working !== "boolean") return null;
  const sources = p.sources && typeof p.sources === "object" ? p.sources : null;
  return {
    npcId: p.npcId,
    working: p.working,
    sources: {
      runningCards: typeof sources?.runningCards === "number" ? sources.runningCards : 0,
      cronRuns: typeof sources?.cronRuns === "number" ? sources.cronRuns : 0,
    },
  };
}

/** 한 페이로드를 접는다. 바뀐 게 없으면 같은 객체를 돌려줘 렌더를 아낀다. */
export function reduceNpcWorking(map: NpcWorkingMap, payload: NpcWorkingPayload): NpcWorkingMap {
  const current = map[payload.npcId];
  if (!payload.working) {
    if (!current) return map;
    const next = { ...map };
    delete next[payload.npcId];
    return next;
  }
  if (
    current &&
    current.sources.runningCards === payload.sources.runningCards &&
    current.sources.cronRuns === payload.sources.cronRuns
  )
    return map;
  return { ...map, [payload.npcId]: payload };
}

/** 지금 작업 중인 NPC id — 맵 시뮬레이션에 넘기는 형태. */
export function workingNpcIds(map: NpcWorkingMap): string[] {
  return Object.keys(map).filter((id) => map[id].working);
}

/**
 * NPC 별로 **몇 건**을 돌리고 있는가(카드 + 크론).
 *
 * 서버는 이 숫자를 `sources` 로 이미 보내는데 맵은 id 목록으로 접어 버려, 한 직원이 카드를
 * 두 장 돌려도 화면은 한 장처럼 보였다. Hermes 의 프로필별 동시 실행 상한은 설정하지 않으면
 * 무제한이라(`kanban_db_dispatch.py`) 두 장 이상은 드문 일이 아니다.
 */
export function workingNpcCounts(map: NpcWorkingMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, payload] of Object.entries(map)) {
    if (!payload.working) continue;
    out[id] = payload.sources.runningCards + payload.sources.cronRuns;
  }
  return out;
}
