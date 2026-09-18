import { OFFICE_LOOKS, type OfficeLook } from "./office-looks";

/**
 * 외형 모델의 정본. 서버(API 라우트·소켓 핸들러)와 클라이언트가 함께 import 하므로
 * 브라우저 API·DB 접근이 이 파일에 들어오면 안 된다.
 *
 * 정본 형태는 `{ officeLookId, bodyType }` 두 키뿐이다. `officeLookId` 는 `OFFICE_LOOKS`
 * 의 ID 이고 `bodyType` 은 그 룩의 `bodyType` 과 같다. 추가 키는 저장·전달 시 보존한다.
 */

export type OfficeBodyType = OfficeLook["bodyType"];

export type CharacterAppearance = {
  officeLookId: string;
  bodyType: OfficeBodyType;
} & Record<string, unknown>;

/** 옛 LPC 레이어 선택(`{ itemKey, variant }`). DB 변환 코드에서만 쓴다. */
export interface AppearanceSelection {
  itemKey: string;
  variant: string;
}

/** 더 옛 형식의 레이어(`{ type, variant }`). DB 변환 코드에서만 쓴다. */
export interface AppearanceLayer {
  type: string;
  variant: string;
}

/**
 * 옛 레이어 외형. 룩 ID 가 없거나 레이어 키만 있던 시절의 저장값을 읽을 때 쓴다.
 * 새 코드는 이 타입으로 무엇도 만들지 않는다 — `normalizeOfficeAppearance` 로 접는다.
 */
export interface LegacyCharacterAppearance {
  officeLookId?: string;
  bodyType?: string;
  layers?: Record<string, AppearanceSelection | null>;
  body?: AppearanceLayer;
  eyes?: AppearanceLayer;
  nose?: AppearanceLayer | null;
  hair?: AppearanceLayer | null;
  torso?: AppearanceLayer | null;
  legs?: AppearanceLayer | null;
  feet?: AppearanceLayer | null;
}

/** 첫 번째 남성 룩 — 기본 외형이자 변환 실패 시의 폴백. */
export const DEFAULT_OFFICE_LOOK_ID = "office-jun";
/** 옛 외형의 `bodyType === "female"` 이 접히는 룩. */
export const DEFAULT_FEMALE_OFFICE_LOOK_ID = "office-nari";

/** 변환 규칙이 가리키는 룩이 실제 목록에 없으면 데이터 자체가 깨진 것이다 — 조용히 넘어가지 않는다. */
export function findOfficeLook(id: unknown): OfficeLook | undefined {
  if (typeof id !== "string") return undefined;
  return OFFICE_LOOKS.find((look) => look.id === id);
}

export function isOfficeLookId(id: unknown): id is string {
  return findOfficeLook(id) !== undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * REST 검증. 오류 문구를 돌려주고 정상이면 `null`.
 * `officeLookId` 가 없거나 알 수 없는 값이면 거절한다. `bodyType` 불일치는 거절하지
 * 않는다 — 저장 전에 `normalizeOfficeAppearance` 가 룩의 값으로 덮어쓴다.
 */
export function validateOfficeAppearance(value: unknown): string | null {
  if (!isRecord(value)) return "appearance must be an object";
  if (typeof value.officeLookId !== "string" || !value.officeLookId)
    return "appearance.officeLookId is required";
  if (!isOfficeLookId(value.officeLookId))
    return `unknown office look: ${String(value.officeLookId)}`;
  return null;
}

function fallbackLook(bodyType: unknown): OfficeLook {
  const id = bodyType === "female" ? DEFAULT_FEMALE_OFFICE_LOOK_ID : DEFAULT_OFFICE_LOOK_ID;
  const look = findOfficeLook(id);
  if (!look) throw new Error(`Default office look missing from OFFICE_LOOKS: ${id}`);
  return look;
}

/**
 * 어떤 값이든 정본 형태로 접는다(변환 규칙 D).
 *
 * - `null`/`undefined` → `null` 그대로.
 * - JSON 문자열은 파싱 뒤 같은 규칙, 파싱 실패는 기본 룩.
 * - 유효한 `officeLookId` 면 추가 키를 보존하고 `bodyType` 만 룩의 값으로 덮어쓴다.
 * - 그 밖에는 옛 `bodyType === "female"` → `office-nari`, 나머지 → `office-jun`.
 *   결과는 두 키뿐이고 옛 레이어 키는 버린다.
 */
export function normalizeOfficeAppearance(value: unknown): CharacterAppearance | null {
  if (value === null || value === undefined) return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = undefined;
    }
    // 문자열 "null" 은 값이 없는 것이 아니라 깨진 값이다 — 기본 룩으로 접는다.
  }
  if (!isRecord(parsed)) {
    const look = fallbackLook(undefined);
    return { officeLookId: look.id, bodyType: look.bodyType };
  }
  const look = findOfficeLook(parsed.officeLookId);
  if (look) return { ...parsed, officeLookId: look.id, bodyType: look.bodyType };
  const fallback = fallbackLook(parsed.bodyType);
  return { officeLookId: fallback.id, bodyType: fallback.bodyType };
}

/** 정본 형태의 기본 외형(첫 번째 남성 룩). 호출마다 새 객체를 준다. */
export function defaultOfficeAppearance(): CharacterAppearance {
  const look = fallbackLook(undefined);
  return { officeLookId: look.id, bodyType: look.bodyType };
}
