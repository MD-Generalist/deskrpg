"use client";

/**
 * 회의록 하나의 결과 패널을 서버 상태와 잇는다. 회의 종료 화면과 회의록 보기 양쪽에서 같은
 * 회의록 id 로 쓴다 — 종료 화면을 닫아도 제안이 사라지지 않는 이유다.
 *
 * 등록·요약 권한(`canManage`)과 등록 여부는 클라이언트가 추측하지 않고 회의록 조회가 돌려준 값을 쓴다.
 */
import { useCallback, useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import { getLocalizedMessage } from "@/lib/i18n/error-codes";
import type { MeetingOutcome, MeetingSummaryStatus } from "@/lib/meeting-outcome";
import type { OutcomeRegistration } from "@/lib/meeting-outcome-draft";

import MeetingOutcomePanel from "./MeetingOutcomePanel";

type Loaded = {
  /** 어느 회의록의 값인가. 다른 회의록으로 바뀌면 새 값이 올 때까지 그리지 않는다. */
  minutesId: string;
  outcome: MeetingOutcome | null;
  summaryStatus: MeetingSummaryStatus;
  canManage: boolean;
};

export type MeetingOutcomeSectionProps = {
  minutesId: string;
  npcs: Array<{ id: string; name: string }>;
  /** 요약이 다시 만들어졌을 때 — 바깥 화면의 주제·결론 표시를 새로 고칠 기회. */
  onSummaryChanged?: (summary: { keyTopics: string[]; conclusions: string | null }) => void;
  /** 등록이 끝났을 때 — 만든 카드로 이동하는 등의 후속 동작. */
  onRegistered?: (registered: NonNullable<MeetingOutcome["registered"]>) => void;
};

async function readError(res: Response): Promise<string> {
  try {
    // 회의 라우트는 `{errorCode}`, 칸반 관문(게이트웨이 없음·플러그인 구버전·남의 보드)은 `{code}` 로 답한다.
    const data = (await res.json()) as { errorCode?: string; code?: string; error?: string };
    return data.errorCode || data.code || data.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export default function MeetingOutcomeSection({
  minutesId,
  npcs,
  onSummaryChanged,
  onRegistered,
}: MeetingOutcomeSectionProps) {
  const t = useT();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/meetings/${minutesId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return (await res.json()) as {
          minutes: { outcome: MeetingOutcome | null; summaryStatus?: MeetingSummaryStatus };
          canManage?: boolean;
        };
      })
      .then((data) => {
        if (cancelled) return;
        setLoaded({
          minutesId,
          outcome: data.minutes.outcome,
          summaryStatus: data.minutes.summaryStatus ?? "ok",
          canManage: data.canManage === true,
        });
      })
      .catch(() => {
        // 회의록을 못 읽으면 패널을 그리지 않는다. 회의록 본문은 바깥 화면이 따로 보여 준다.
      });
    return () => {
      cancelled = true;
    };
  }, [minutesId]);

  const register = useCallback(
    async (body: OutcomeRegistration) => {
      const res = await fetch(`/api/meetings/${minutesId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(getLocalizedMessage(t, await readError(res)));
      const data = (await res.json()) as { registered: NonNullable<MeetingOutcome["registered"]> };
      setLoaded((prev) =>
        prev?.outcome
          ? { ...prev, outcome: { ...prev.outcome, registered: data.registered } }
          : prev,
      );
      onRegistered?.(data.registered);
    },
    [minutesId, onRegistered, t],
  );

  const retry = useCallback(async () => {
    const res = await fetch(`/api/meetings/${minutesId}/summarize`, { method: "POST" });
    if (!res.ok) throw new Error(getLocalizedMessage(t, await readError(res)));
    const data = (await res.json()) as {
      summaryStatus: MeetingSummaryStatus;
      keyTopics: string[];
      conclusions: string | null;
      outcome: MeetingOutcome | null;
    };
    setLoaded((prev) =>
      prev ? { ...prev, outcome: data.outcome, summaryStatus: data.summaryStatus } : prev,
    );
    onSummaryChanged?.({ keyTopics: data.keyTopics, conclusions: data.conclusions });
  }, [minutesId, onSummaryChanged, t]);

  if (!loaded || loaded.minutesId !== minutesId) return null;
  const registered = loaded.outcome?.registered ?? null;
  return (
    <MeetingOutcomePanel
      // 요약을 다시 만들면 초안을 새 결과로 갈아 끼운다.
      key={`${minutesId}:${loaded.summaryStatus}:${loaded.outcome?.followUps.length ?? 0}`}
      outcome={loaded.outcome}
      summaryStatus={loaded.summaryStatus}
      npcs={npcs}
      canRegister={loaded.canManage}
      registered={registered}
      onRegister={register}
      onRetrySummary={retry}
    />
  );
}
