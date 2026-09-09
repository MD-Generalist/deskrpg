"use client";

import { useT } from "@/lib/i18n";

interface SystemMessageProps {
  /** 서버가 넣은 JSON — `{"kind":"invited","names":[…]}` 부류. */
  content: string;
}

type SystemPayload = { kind?: string; names?: unknown; name?: unknown };

/**
 * 시스템 줄은 서버가 로케일을 모르는 채로 쓴다. 그래서 본문이 JSON 이고, 문장은 여기서 만든다.
 * 파싱에 실패하면(옛 형식·잘린 값) 원문을 그대로 보인다 — 삼키는 것보다 낫다.
 */
export function systemMessageText(
  content: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  let payload: SystemPayload;
  try {
    payload = JSON.parse(content) as SystemPayload;
  } catch {
    return content;
  }
  if (!payload || typeof payload !== "object") return content;
  const names = Array.isArray(payload.names) ? payload.names.map(String) : [];
  const name = typeof payload.name === "string" ? payload.name : "";
  switch (payload.kind) {
    case "invited":
      return names.length > 0 ? t("room.system.invited", { names: names.join(", ") }) : content;
    case "left":
      return name ? t("room.system.left", { name }) : content;
    case "renamed":
      return name ? t("room.system.renamed", { name }) : content;
    default:
      return content;
  }
}

export default function SystemMessage({ content }: SystemMessageProps) {
  const t = useT();
  return (
    <div className="py-1 text-center text-[11px] text-text-dim">
      {systemMessageText(content, t)}
    </div>
  );
}
