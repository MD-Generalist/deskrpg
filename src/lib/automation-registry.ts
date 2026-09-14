/**
 * 자동화 훅 레지스트리 — Next 앱 코드와 소켓 서버(`src/server/*`) 사이의 경계.
 *
 * API 라우트(`src/app/**`)와 그 몸통(`src/lib/**`)은 **이 파일만** 본다. 소켓 서버가 뜰 때
 * (`startAutomationPollers`) 실제 구현을 `globalThis` 에 꽂고, 라우트는 꽂힌 것을 읽는다.
 * `rpc-registry.ts` 와 같은 무늬다.
 *
 * 왜 직접 import 하지 않는가: `@/server/automation-poller` 는 `socket-handlers.ts` 를 끌고
 * 들어오고, 그 파일의 `.js` 확장자 상대 import 는 tsx 런타임용이라 Next/Turbopack 번들에서
 * "Module not found" 로 빌드가 깨진다. 이 경계는 `app-server-boundary.test.ts` 가 지킨다.
 *
 * 꽂힌 것이 없으면(테스트·CLI 초기·폴러가 못 뜬 경우) 전부 조용히 no-op 다 — 폴링 실패가
 * REST 응답에 섞이지 않는다는 R24 의 약속과 같다.
 */

/** `src/server/automation-events.ts` 의 `NpcWorkingPayload` 와 같은 모양. 서버 모듈을 import 하지 않으려 여기 다시 적는다. */
export type AutomationWorkingPayload = {
  npcId: string;
  working: boolean;
  sources: { runningCards: number; cronRuns: number };
};

export type AutomationHooks = {
  /** 조작 직후 즉시 폴링(R24). 폴러가 없으면 null. 결과 모양은 `automation-poller.ts` 의 `PollOutcome`. */
  pollNow(channelId: string): Promise<unknown>;
  /** 바인딩이 생기거나 풀렸을 때 폴러 표를 다시 읽는다. */
  refreshPollers(): Promise<void>;
  /** 지금 "작업 중" 인 NPC 들의 스냅샷(R27). */
  getWorkingSnapshot(channelId: string): AutomationWorkingPayload[];
};

const KEY = "__deskrpg_automation_hooks__";
const g = globalThis as typeof globalThis & Record<string, AutomationHooks | undefined>;

export function registerAutomationHooks(hooks: AutomationHooks): void {
  g[KEY] = hooks;
}

export function unregisterAutomationHooks(): void {
  g[KEY] = undefined;
}

export function getAutomationHooks(): AutomationHooks | undefined {
  const hooks = g[KEY];
  return hooks && typeof hooks === "object" ? hooks : undefined;
}

/** 즉시 폴링 요청. 훅이 없으면 null 로 끝난다 — 예전 `pollNow` 가 폴러 없을 때 하던 대로. */
export function requestPollNow(channelId: string): Promise<unknown> {
  const hooks = getAutomationHooks();
  return hooks ? hooks.pollNow(channelId) : Promise.resolve(null);
}

export function requestRefreshPollers(): Promise<void> {
  const hooks = getAutomationHooks();
  return hooks ? hooks.refreshPollers() : Promise.resolve();
}

export function readWorkingSnapshot(channelId: string): AutomationWorkingPayload[] {
  const hooks = getAutomationHooks();
  return hooks ? hooks.getWorkingSnapshot(channelId) : [];
}

/** 테스트 전용 — 꽂힌 훅을 비운다. */
export function resetAutomationHooksForTests(): void {
  unregisterAutomationHooks();
}
