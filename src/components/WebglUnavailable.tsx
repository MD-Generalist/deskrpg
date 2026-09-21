"use client";

import Link from "next/link";
import { MonitorX } from "lucide-react";

import { useT } from "@/lib/i18n";

type WebglUnavailableProps = {
  /** "다시 시도" — 전체 페이지를 다시 검사·마운트한다. */
  onRetry: () => void;
};

/**
 * 3D 오피스를 시작할 수 없을 때 채널 화면 대신 띄우는 전체 화면 안내.
 * 2D 폴백은 없으므로 여기서 더 들어갈 길을 주지 않는다 — 고치거나 돌아가거나 둘뿐이다.
 */
export default function WebglUnavailable({ onRetry }: WebglUnavailableProps) {
  const t = useT();

  return (
    <div
      role="alert"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg text-text px-6"
    >
      <div className="max-w-md w-full rounded-lg border border-border bg-surface p-6 text-center">
        <MonitorX className="w-10 h-10 mx-auto mb-4 text-danger" aria-hidden />
        <h1 className="text-xl font-semibold mb-3">{t("webgl.unavailableTitle")}</h1>
        <p className="text-sm text-text-muted mb-6 leading-relaxed">
          {t("webgl.unavailableDescription")}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded font-semibold"
          >
            {t("webgl.retry")}
          </button>
          <Link
            href="/channels"
            className="w-full sm:w-auto px-4 py-2 rounded border border-border text-text-muted hover:text-text"
          >
            {t("webgl.backToChannels")}
          </Link>
        </div>
      </div>
    </div>
  );
}
