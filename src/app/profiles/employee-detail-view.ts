/**
 * 직원 상세 화면의 **되돌릴 수 없는 결정**을 순수 함수로 뽑아 둔다.
 *
 * 직원을 지우면 그 인격의 NPC 자리와 태스크가 CASCADE 로 함께 사라진다. 문구가 수치를 잃어도,
 * 삭제 뒤 알림이 서버 필드 이름과 어긋나도 화면은 아무 일 없다는 얼굴을 한다(실제로 그랬다 —
 * `unboundNpcs` 를 읽는 코드가 `deletedNpcs` 를 보내는 서버를 만나 알림이 조용히 사라져 있었다).
 * 그래서 이 세 판정은 화면이 아니라 여기서 고정한다.
 */

/** 삭제를 묻는 문구에 넣을 수치. 개수를 모른 채 누르는 확인은 확인이 아니다. */
export function deleteConfirmParams(
  name: string,
  usage: { npcs?: unknown; channels?: unknown } | null | undefined,
): { name: string; npcs: string; channels: string } {
  const toCount = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? String(Math.trunc(parsed)) : "0";
  };
  return { name, npcs: toCount(usage?.npcs), channels: toCount(usage?.channels) };
}

/** 삭제 응답에서 알림 수치를 읽는다. 서버 필드는 `deletedNpcs`·`channels` 다. */
export function deletedNoticeFrom(data: unknown): { npcs: number; channels: number } | null {
  if (!data || typeof data !== "object") return null;
  const npcs = Number((data as { deletedNpcs?: unknown }).deletedNpcs ?? 0);
  const channels = Number((data as { channels?: unknown }).channels ?? 0);
  if (!Number.isFinite(npcs) || npcs <= 0) return null;
  return { npcs: Math.trunc(npcs), channels: Number.isFinite(channels) ? Math.trunc(channels) : 0 };
}

/**
 * 소유자만 인격·외형·AI 모델·계정·삭제를 만진다. 공유받은 사용자는 상태 확인까지다.
 * 외형은 따로 두지 않는다 — 마법사의 ③ 외형 단계가 그 편집기다(같은 편집기가 두 번 보였다).
 */
export function visibleSections(isOwner: boolean): ReadonlyArray<"status" | "persona" | "account"> {
  return isOwner ? ["status", "persona", "account"] : ["status"];
}
