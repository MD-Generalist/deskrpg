/**
 * 판단 모음 — **사람이 답해야 하는 것만** 모은다.
 *
 * Paperclip 의 수신함과 같은 기준이다: "무엇이 이것을 다음으로 전진시키는가" 에 답할 수
 * 없는 줄은 넣지 않는다. 방치된 항목을 자동으로 재배정하지 않고 드러낸다.
 *
 * 순수 함수다 — 화면과 지표가 같은 목록을 보게 하려면 조립이 한 곳이어야 한다.
 * 세는 일은 `needs-attention.ts` 가 맡고, 이 파일은 **줄을 만든다.**
 */
export type AttentionRowKind = "approval" | "blocked" | "review" | "cron_failed";

export type AttentionRow = {
  kind: AttentionRowKind;
  /** 승인이면 approvalId, 카드면 taskId, 크론이면 jobId. */
  id: string;
  title: string;
  /** 발생 시각(ISO). 플러그인이 못 준 카드만 null 이다. */
  at: string | null;
  requestedBy: string | null;
  /** 승인은 묶인 카드 수, 나머지는 1. */
  count: number;
};

export type AttentionInboxInput = {
  /** `at` 은 호출자가 `taskTimeMs` 로 읽어 ISO 로 바꾼 값. 못 읽으면 null. */
  cards: readonly { id: string; status: string; title: string; at?: string | null }[];
  approvals: readonly {
    id: string;
    title: string;
    requestedBy: string;
    createdAt: string;
    taskIds: readonly string[];
  }[];
  cronFailures: readonly {
    messageId: string;
    jobId: string;
    jobName: string;
    createdAt: string;
  }[];
};

export function buildAttentionInbox(input: AttentionInboxInput): AttentionRow[] {
  const rows: AttentionRow[] = [];
  // 승인 대기 카드는 각각이 아니라 **승인 한 줄**로 모인다 — 사용자가 한 번 눌러 푸는 단위다.
  const claimed = new Set<string>();
  for (const approval of input.approvals) {
    for (const taskId of approval.taskIds) claimed.add(taskId);
    rows.push({
      kind: "approval",
      id: approval.id,
      title: approval.title,
      at: approval.createdAt,
      requestedBy: approval.requestedBy,
      count: approval.taskIds.length,
    });
  }
  for (const card of input.cards) {
    // 승인에 묶인 blocked 카드를 또 내면 사용자가 같은 것을 두 번 본다.
    if (card.status === "blocked" && !claimed.has(card.id))
      rows.push({
        kind: "blocked",
        id: card.id,
        title: card.title,
        at: card.at ?? null,
        requestedBy: null,
        count: 1,
      });
    else if (card.status === "review")
      rows.push({
        kind: "review",
        id: card.id,
        title: card.title,
        at: card.at ?? null,
        requestedBy: null,
        count: 1,
      });
  }
  for (const cron of input.cronFailures)
    rows.push({
      kind: "cron_failed",
      id: cron.jobId,
      title: cron.jobName,
      at: cron.createdAt,
      requestedBy: null,
      count: 1,
    });

  // 오래된 것이 위로 — 방치를 드러내는 것이 이 화면의 일이다. 시각을 못 읽은 줄만 뒤로
  // 보내고 id 로 갈라, 같은 입력에 늘 같은 순서가 나오게 한다.
  return rows.sort((a, b) => {
    if (a.at && b.at) return a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? -1 : 1;
    if (a.at) return -1;
    if (b.at) return 1;
    return a.id.localeCompare(b.id);
  });
}
