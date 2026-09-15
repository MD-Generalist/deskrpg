"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useT } from "../lib/i18n";

// 클립보드 API의 제공 여부에는 구독 이벤트가 없으며 서버에서는 사용할 수 없다.
const subscribeClipboard = () => () => {};
const clipboardAvailable = () =>
  typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
const serverClipboardAvailable = () => false;

/**
 * 붙여넣어야 하는 명령을 보여 주고 복사 버튼을 붙인다.
 *
 * 설치 안내에서 사용자가 하는 일은 결국 "이 줄을 터미널에 붙여넣기" 하나다. 지금까지는
 * 손으로 긁어야 했고, 줄이 길어 가로 스크롤 안에서 일부만 잡히기 쉬웠다.
 *
 * 클립보드는 보안 컨텍스트(HTTPS·localhost)에서만 열린다. 평문 HTTP 로 띄운 인스턴스에서는
 * 버튼을 감추고 기존처럼 명령만 보여 준다 — 눌러도 아무 일이 없는 버튼을 두지 않는다.
 */
export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const canCopy = useSyncExternalStore(
    subscribeClipboard,
    clipboardAvailable,
    serverClipboardAvailable,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return; // 거부당하면 조용히 둔다 — 명령은 화면에 그대로 있다.
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`relative ${className ?? ""}`}>
      <pre className="overflow-x-auto rounded-lg bg-bg px-3 py-2 pr-20 text-xs text-text">
        {command}
      </pre>
      {canCopy && (
        <button
          type="button"
          onClick={() => void copy()}
          className="absolute top-1.5 right-1.5 rounded border border-border bg-surface-raised px-2 py-1 text-[11px] text-text-muted hover:text-text"
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      )}
    </div>
  );
}
