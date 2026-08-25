// 프리셋을 적용할 때 사용자가 쓴 페르소나(identity/soul)를 덮어써도 되는지 판정한다.
//
// NPC 고용 모달에는 프리셋이 두 갈래로 들어온다.
//
//   외형 프리셋 카드 클릭   → 사용자는 "외형"을 골랐다. 페르소나 교체는 부수효과다.
//   페르소나 select 변경    → 사용자는 "페르소나"를 골랐다. 교체가 곧 요청 자체다.
//
// 앞의 경우에만 이미 손댄 페르소나를 지킨다. 뒤의 경우까지 지키면 페르소나를
// 바꾸라는 명시적 요청이 조용히 무시된다.
//
// 판정은 identity/soul 을 따로 하지 않고 **페르소나 전체를 한 단위로** 한다.
// 필드별로 판정하면 identity 만 편집한 흔한 경우에 soul 만 프리셋으로 갈려서,
// 절반은 사용자 것이고 절반은 프리셋인 페르소나가 만들어진다 — 그리고 화면의
// 프리셋 이름이 그 어느 쪽도 정확히 가리키지 못하게 된다.
export type PresetApplySource = "appearance" | "persona";

export type PersonaCustomizedState = {
  identity: boolean;
  soul: boolean;
};

/**
 * @param source     프리셋이 어느 조작에서 들어왔는가.
 * @param customized 각 필드를 사용자가 직접 편집했는가.
 * @returns true 면 identity·soul 을 함께 프리셋 본문으로 교체한다.
 */
export function shouldReplacePresetText(
  source: PresetApplySource,
  customized: PersonaCustomizedState,
): boolean {
  if (source === "persona") return true;
  return !customized.identity && !customized.soul;
}
