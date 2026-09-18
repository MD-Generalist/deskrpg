import type { CharacterAppearance } from "@/game/three/office-appearance";
import { OFFICE_LOOKS, officeLookAppearance, resolveOfficeLook } from "@/game/three/office-looks";

/**
 * 새 직원의 외형을 고른다 — **외형 없는 직원을 만들지 않는다.**
 *
 * 외형이 비어 있으면 렌더러가 기본 룩(`office-jun`)으로 접어, 직원이 전부 같은 얼굴로
 * 출근했다. 그래서 등록하는 순간 이 게이트웨이에서 아직 아무도 안 쓴 룩을 하나 준다.
 * 50종을 다 썼으면 겹치더라도 전체에서 고른다. 바꾸는 곳은 직원 상세 화면이다.
 *
 * @param usedAppearances 같은 게이트웨이 직원들의 `appearance` 값(형태 불문 — 모르면 무시)
 * @param random 테스트가 고정할 수 있게 주입한다
 */
export function pickOfficeLookForNewProfile(
  usedAppearances: readonly unknown[],
  random: () => number = Math.random,
): CharacterAppearance {
  const used = new Set(
    usedAppearances.map((value) => resolveOfficeLook(value)?.id).filter(Boolean),
  );
  const unused = OFFICE_LOOKS.filter((look) => !used.has(look.id));
  const pool = unused.length > 0 ? unused : OFFICE_LOOKS;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return officeLookAppearance(pool[index].id);
}
