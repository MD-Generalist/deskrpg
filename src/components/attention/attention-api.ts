/**
 * 판단 모음 REST(`/api/channels/:id/attention`)의 브라우저 쪽 호출.
 *
 * 칸반과 같은 규약이다 — 같은 출처의 DeskRPG 라우트, 세션 쿠키, 실패는 서버가 내려 준
 * `{code, message}` 를 그대로 실어 던진다. 여기서 번역하거나 접지 않는다.
 */
import type { AttentionRow } from "@/lib/attention-inbox";
import type { AttentionCounts } from "@/lib/needs-attention";

export type AttentionInbox = { rows: AttentionRow[]; counts: AttentionCounts };

export class AttentionApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AttentionApiError";
    this.status = status;
    this.code = code;
  }
}

async function unwrap(res: Response): Promise<unknown> {
  const body = await res.json().catch(() => null);
  if (res.ok) return body;
  const failure = (body ?? {}) as { code?: string; message?: string };
  throw new AttentionApiError(res.status, failure.code ?? "unknown", failure.message ?? "failed");
}

export function createAttentionApi(channelId: string) {
  const base = `/api/channels/${encodeURIComponent(channelId)}`;
  return {
    async load(signal?: AbortSignal): Promise<AttentionInbox> {
      return (await unwrap(await fetch(`${base}/attention`, { signal }))) as AttentionInbox;
    },
    async decide(
      approvalId: string,
      body: {
        decision: "approve" | "reject" | "request_revision";
        note?: string;
        targets?: { task_id: string; decision: string }[];
      },
    ): Promise<unknown> {
      return unwrap(
        await fetch(`${base}/approvals/${encodeURIComponent(approvalId)}/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    },
  };
}
