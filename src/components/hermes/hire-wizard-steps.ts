/**
 * 고용 마법사의 단계 구성과 전이.
 *
 * 능력에 따라 **기능이 조용히 깨지는 대신 눈에 보이게 줄어든다.** 잠긴 단계는
 * 사라지지 않고 이유와 함께 남는다 — 사라지면 사용자는 그런 기능이 있는 줄도
 * 모르고, 회색으로 남으면 무엇을 하면 열리는지 알 수 있다.
 */

import type { PluginStatus } from "@/lib/hermes/plugin-capability";

export type WizardStep = "profile" | "identity" | "appearance" | "config";

export type StepAvailability = {
  step: WizardStep;
  enabled: boolean;
  /** 잠긴 이유의 i18n 키. 열려 있으면 null */
  lockedReason: string | null;
};

/**
 * ① 프로필 → ② 인격 → ③ 외형 → ④ AI 모델. 여기서 끝난다.
 *
 * 예전의 ④ 배치는 할 일이 없는 링크 버튼만 남은 단계였다 — 자리는 맵이 맡는다. 외형은 등록 때
 * 자동으로 하나 배정되고, ③ 에서 바꾼다.
 */
const ORDER: WizardStep[] = ["profile", "identity", "appearance", "config"];

export function availableSteps(
  status: PluginStatus,
  localDiscovery: boolean,
  /** 이 마법사가 다룰 프로필이 이미 있는가(방금 만들었거나 기존 프로필로 들어왔다). */
  hasProfile: boolean,
): StepAvailability[] {
  const pluginOk = status === "plugin_ready";

  // 401 과 404 는 사용자가 할 일이 정반대다 — 키 교체 vs 플러그인 설치.
  const blockedReason =
    status === "plugin_unauthorized"
      ? "hermes.plugin.locked.unauthorized"
      : status === "plugin_absent"
        ? "hermes.plugin.locked.absent"
        : "hermes.plugin.locked.unknown";

  return ORDER.map((step) => {
    if (step === "profile") {
      // 프로필은 플러그인이 없어도 로컬 파일시스템 발견으로 찾아 등록할 수 있다.
      const enabled = pluginOk || localDiscovery;
      return { step, enabled, lockedReason: enabled ? null : blockedReason };
    }
    if (step === "appearance") {
      // 외형은 DeskRPG 가 저장한다 — 플러그인과 무관하고, 다룰 프로필만 있으면 된다.
      return hasProfile
        ? { step, enabled: true, lockedReason: null }
        : { step, enabled: false, lockedReason: "hermes.wizard.locked.needsProfile" };
    }
    // 인격·AI 모델은 플러그인 없이는 원격에서 손댈 방법이 없다.
    if (!pluginOk) return { step, enabled: false, lockedReason: blockedReason };
    // 프로필이 없으면 읽을 대상이 없다. 예전에는 이 단계가 열려 있어, 빈 조회 결과가
    // "인격 파일을 읽을 수 없다" 로 보이고 모델 목록 대신 자유 입력이 떴다(2026-09-18).
    if (!hasProfile)
      return { step, enabled: false, lockedReason: "hermes.wizard.locked.needsProfile" };
    return { step, enabled: true, lockedReason: null };
  });
}

export function identityDecision(payload: {
  isDefaultTemplate?: boolean | null;
  unreadable?: boolean;
}): "edit_fresh" | "ask_overwrite" | "blocked" {
  if (payload.unreadable) return "blocked";
  // **불리언이 아닌 것은 전부 막는다.** 예전에는 `=== null` 만 걸렀는데, 필드가
  // 아예 **없는** payload(`{}`)가 오면 `undefined` 가 falsy 로 흘러
  // `ask_overwrite` 가 됐다 — 즉 "인격이 없다"를 "인격이 있으니 덮어쓸까요"로
  // 뒤집어 보여줬다. 스테이징에서 실제로 재현됐다(2026-09-02): 플러그인은
  // `isDefaultTemplate: true` 를 정직하게 줬는데 화면은 덮어쓰기를 물었다.
  //
  // 타입이 `boolean | null` 이라 TypeScript 는 필드 누락을 막아주지만, 응답을
  // `as IdentityPayload` 로 캐스팅하는 순간 그 보호가 사라진다. 런타임에서
  // 다시 확인해야 하는 이유다.
  //
  // 모르면 막는 쪽이 안전하다 — 빈 편집기를 열거나 덮어쓰기를 제안하면 사람이
  // 쓴 인격을 저장 한 번으로 잃는다.
  if (typeof payload.isDefaultTemplate !== "boolean") return "blocked";
  return payload.isDefaultTemplate ? "edit_fresh" : "ask_overwrite";
}

export type ServingVerdict = "served" | "key_rejected" | "not_served" | "unknown";

/**
 * ① 에서 만든 프로필이 실제로 서빙되는지 — `GET .../identity` 실호출 한 번의 결과로
 * 판정한다(판정 I, `served_profiles` 스냅샷은 쓰지 않는다).
 *
 * 수정 라운드 1: 프록시 라우트는 업스트림 실패를 항상 HTTP 200 + `errorCode` 로 옮긴다
 * (Cloudflare 가 origin 5xx 본문을 갈아치우는 문제의 연장선, `route.ts` 의 `proxyInit`
 * 주석 참조) — 그 과정에서 원래 있던 업스트림 상태 코드(`PluginResponse.status`)가
 * 함께 사라져, 구조화 `error` 필드 없는 401 과 404 가 둘 다 `plugin_error` 로 뭉쳐
 * "401 과 404 는 사용자가 할 일이 정반대다" 원칙이 이 층에서 재발했다. 프록시 4종이
 * 이제 `upstreamStatus` 를 함께 싣는다 — 여기서 그 값으로 401(키 문제)과 404(allowlist
 * 로 이 프로필을 서빙하지 않음)를 가른다.
 */
export function classifyServingCheck(input: {
  errorCode: string | null;
  upstreamStatus: number | null;
}): ServingVerdict {
  if (!input.errorCode) return "served";
  if (input.upstreamStatus === 401) return "key_rejected";
  if (input.upstreamStatus === 404) return "not_served";
  return "unknown";
}

export function nextStep(current: WizardStep, steps: StepAvailability[]): WizardStep | null {
  const idx = ORDER.indexOf(current);
  for (let i = idx + 1; i < ORDER.length; i += 1) {
    const candidate = steps.find((s) => s.step === ORDER[i]);
    if (candidate?.enabled) return candidate.step;
  }
  return null;
}

/** 바로 앞의 **열린** 단계. 없으면 null — 첫 단계에서는 "이전" 이 나오지 않는다. */
export function previousStep(current: WizardStep, steps: StepAvailability[]): WizardStep | null {
  const idx = ORDER.indexOf(current);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const candidate = steps.find((s) => s.step === ORDER[i]);
    if (candidate?.enabled) return candidate.step;
  }
  return null;
}
/** 다음 단계가 잠겨 있으면 그 이유 — "다음" 버튼의 툴팁이 된다. */
export function nextLockedReason(current: WizardStep, steps: StepAvailability[]): string | null {
  const idx = ORDER.indexOf(current);
  const candidate = steps.find((s) => s.step === ORDER[idx + 1]);
  return candidate && !candidate.enabled ? (candidate.lockedReason ?? null) : null;
}
