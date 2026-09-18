/**
 * 결과물 진입점의 상태 — 결과물 모달(열기·닫기·사건)과 NPC 대화의 "결과물 저장됨" 칩.
 * GamePageClient 가 소켓 `artifact:event` 를 여기로 접는다. 화면 없는 순수 함수라 따로 고정한다.
 */

export type ArtifactSocketEvent = {
  channelId?: string;
  event?: {
    kind?: string;
    payload?: {
      artifact_id?: string;
      title?: string;
      profile?: string;
      source_kind?: string;
    };
  };
};

export type ArtifactsModalState = {
  show: boolean;
  /** 모달이 열린 동안 받은 사건 수 — 오르면 모달이 디바운스해 다시 읽는다. */
  refreshTick: number;
  /** 모달이 열린 동안 받은 마지막 사건(삭제·새 버전 반영용). */
  lastEvent: { kind: string; artifactId: string } | null;
  initial: { artifactId?: string; taskId?: string } | null;
  /** 모달 개폐와 무관하게 계속 오르는 사건 수 — 칸반 카드의 결과물 섹션이 다시 읽는 신호. */
  eventSeq: number;
};

export type ArtifactsModalAction =
  | { type: "open"; initial?: { artifactId?: string; taskId?: string } }
  | { type: "close" }
  | { type: "event"; kind?: string; artifactId?: string };

export const INITIAL_ARTIFACTS_MODAL: ArtifactsModalState = {
  show: false,
  refreshTick: 0,
  lastEvent: null,
  initial: null,
  eventSeq: 0,
};

/**
 * 모달은 열릴 때마다 새로 마운트돼 처음부터 읽는다. 그래서 여닫을 때 tick·마지막 사건을 비우고,
 * 닫힌 동안의 사건은 모달 쪽에 쌓지 않는다 — 새 모달이 옛 사건을 되풀이하거나 마운트 직후
 * 쓸데없는 디바운스 재조회를 하지 않게.
 */
export function reduceArtifactsModal(
  state: ArtifactsModalState,
  action: ArtifactsModalAction,
): ArtifactsModalState {
  switch (action.type) {
    case "open":
      return {
        ...state,
        show: true,
        initial: action.initial ?? null,
        refreshTick: 0,
        lastEvent: null,
      };
    case "close":
      return { ...state, show: false, initial: null, refreshTick: 0, lastEvent: null };
    case "event": {
      const eventSeq = state.eventSeq + 1;
      if (!state.show) return { ...state, eventSeq };
      return {
        ...state,
        eventSeq,
        refreshTick: state.refreshTick + 1,
        lastEvent:
          action.kind && action.artifactId
            ? { kind: action.kind, artifactId: action.artifactId }
            : state.lastEvent,
      };
    }
  }
}

export type ArtifactChip = { artifactId: string; title: string };

/**
 * 열린 NPC 대화에서 저장된 결과물이면 칩을 더한다. `artifact.created|versioned` 이고 출처가
 * 채팅이며 프로필이 지금 대화 중인 NPC 의 것일 때만 — 같은 결과물은 한 번만(새 버전은 제목만 갱신).
 */
export function nextArtifactChips(
  prev: ArtifactChip[],
  data: ArtifactSocketEvent,
  openProfile: string | null | undefined,
): ArtifactChip[] {
  const kind = data.event?.kind;
  const payload = data.event?.payload;
  if (kind !== "artifact.created" && kind !== "artifact.versioned") return prev;
  if (!payload?.artifact_id || payload.source_kind !== "chat") return prev;
  if (!openProfile || payload.profile !== openProfile) return prev;
  const title = payload.title || payload.artifact_id;
  const index = prev.findIndex((chip) => chip.artifactId === payload.artifact_id);
  if (index === -1) return [...prev, { artifactId: payload.artifact_id, title }];
  if (prev[index].title === title) return prev;
  return prev.map((chip, i) => (i === index ? { ...chip, title } : chip));
}
