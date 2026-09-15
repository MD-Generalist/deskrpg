"use client";

import Link from "next/link";

import { useT } from "@/lib/i18n";
import { HERMES_AGENT_REPO_URL, PLUGIN_INSTALL_COMMAND } from "@/lib/hermes/plugin-install-command";

/**
 * 게이트웨이가 **하나도 없는** 사용자에게 보여주는 온보딩 안내.
 *
 * 가입 직후 `/gateways` 로 떨어진 사람은 Hermes 를 설치한 적도, 모델 제공자에 로그인한
 * 적도 없다. 그 사람에게 빈 등록 폼만 주면 막다른 길이다 — DeskRPG 는 에이전트 런타임을
 * 내장하지 않는다는 사실부터 말해 주어야 한다.
 */
export const GATEWAY_EXAMPLE_BASE_URL = "http://127.0.0.1:8642";

export default function GatewayOnboardingGuide() {
  const t = useT();

  return (
    <section className="mb-6 rounded-xl border border-primary/30 bg-surface p-5">
      <h2 className="text-lg font-semibold">{t("gateways.onboarding.title")}</h2>
      <p className="mt-2 text-sm text-text-muted">{t("gateways.onboarding.intro")}</p>

      <ol className="mt-4 space-y-4">
        <li>
          <p className="text-sm font-semibold">{t("gateways.onboarding.step1Title")}</p>
          <p className="mt-1 text-sm text-text-muted">{t("gateways.onboarding.step1Body")}</p>
          <a
            href={HERMES_AGENT_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-block break-all text-sm font-semibold text-primary"
          >
            {HERMES_AGENT_REPO_URL}
          </a>
        </li>

        <li>
          <p className="text-sm font-semibold">{t("gateways.onboarding.step2Title")}</p>
          <p className="mt-1 text-sm text-text-muted">
            {t("gateways.onboarding.step2Body", { example: GATEWAY_EXAMPLE_BASE_URL })}
          </p>
          <p className="mt-1 text-sm font-medium text-danger">
            {t("gateways.onboarding.step2OwnerKeyWarning")}
          </p>
        </li>

        <li>
          <p className="text-sm font-semibold">{t("gateways.onboarding.step3Title")}</p>
          <p className="mt-1 text-sm text-text-muted">{t("gateways.onboarding.step3Body")}</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-bg px-3 py-2 text-xs text-text">
            <code>{PLUGIN_INSTALL_COMMAND}</code>
          </pre>
        </li>

        <li>
          <p className="text-sm font-semibold">{t("gateways.onboarding.step4Title")}</p>
          <p className="mt-1 text-sm text-text-muted">{t("gateways.onboarding.step4Body")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
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
        </li>
      </ol>
    </section>
  );
}
