"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useT } from "@/lib/i18n";
import { HERMES_AGENT_REPO_URL, PLUGIN_INSTALL_COMMAND } from "@/lib/hermes/plugin-install-command";
import Toast from "@/components/ui/Toast";
import { quickStartGamePath } from "@/lib/quick-start";
import { CopyCommand } from "../CopyCommand";

/**
 * 게이트웨이가 **하나도 없는** 사용자에게 보여주는 온보딩 안내.
 *
 * 가입 직후 `/gateways` 로 떨어진 사람은 Hermes 를 설치한 적도, 모델 제공자에 로그인한
 * 적도 없다. 그 사람에게 빈 등록 폼만 주면 막다른 길이다 — DeskRPG 는 에이전트 런타임을
 * 내장하지 않는다는 사실부터 말해 주어야 한다.
 */
const TOAST_MS = 3000;

export default function GatewayOnboardingGuide() {
  const t = useT();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(toastTimer.current ?? undefined), []);

  const fail = useCallback((message: string) => {
    clearTimeout(toastTimer.current ?? undefined);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  /**
   * 게이트웨이가 없어도 사무실은 만들 수 있다 — 서버가 캐릭터·채널을 기본값으로
   * 만들고(이미 있으면 그것을 그대로 쓰고) 식별자 둘만 돌려준다.
   */
  const quickStart = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const response = await fetch("/api/quick-start", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload?.channelId !== "string") {
        fail(t("quickStart.failed"));
        return;
      }
      router.push(quickStartGamePath({ channelId: payload.channelId }));
    } catch {
      fail(t("quickStart.failed"));
    } finally {
      setRunning(false);
    }
  }, [fail, router, running, t]);

  return (
    <section className="mb-6 rounded-xl border border-primary/30 bg-surface p-5">
      <h2 className="text-lg font-semibold">{t("gateways.onboarding.title")}</h2>
      <p className="mt-2 text-sm text-text-muted">{t("gateways.onboarding.intro")}</p>
      <a
        href={HERMES_AGENT_REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-1 inline-block break-all text-sm font-semibold text-primary"
      >
        {HERMES_AGENT_REPO_URL}
      </a>

      <div className="mt-4">
        <p className="text-sm font-semibold">{t("gateways.onboarding.step4Title")}</p>
        <p className="mt-1 text-sm text-text-muted">{t("gateways.onboarding.step4Body")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={quickStart}
            disabled={running}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {t("gateways.onboarding.quickStart")}
          </button>
          <Link
            href="/characters"
            className="rounded-lg bg-surface-raised px-3 py-1.5 text-sm font-medium hover:bg-surface-raised/80"
          >
            {t("gateways.onboarding.step4CharacterLink")}
          </Link>
          <Link
            href="/channels"
            className="rounded-lg bg-surface-raised px-3 py-1.5 text-sm font-medium hover:bg-surface-raised/80"
          >
            {t("gateways.onboarding.step4ChannelLink")}
          </Link>
        </div>
        <p className="mt-1 text-sm text-text-muted">{t("gateways.onboarding.quickStartHint")}</p>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">
          {t("gateways.onboarding.manualSetup")}
        </summary>
        <ol className="mt-3 space-y-4">
          <li>
            <p className="text-sm font-semibold">{t("gateways.onboarding.step1Title")}</p>
            <p className="mt-1 text-sm text-text-muted">{t("gateways.onboarding.step1Body")}</p>
            {/* 저장소 링크만 주고 끝내지 않는다 — 같은 호스트라면 마법사가 설치할 수 있다. */}
            <p className="mt-1 text-sm text-text-muted">
              {t("gateways.onboarding.step1WizardHint")}
            </p>
          </li>

          <li>
            <p className="text-sm font-semibold">{t("gateways.onboarding.step3Title")}</p>
            <p className="mt-1 text-sm text-text-muted">{t("gateways.onboarding.step3Body")}</p>
            <CopyCommand command={PLUGIN_INSTALL_COMMAND} className="mt-2" />
          </li>
        </ol>
      </details>
      <Toast message={toast ?? ""} visible={toast !== null} />
    </section>
  );
}
