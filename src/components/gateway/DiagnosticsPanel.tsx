"use client";

import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n";

/**
 * `/gateways` 의 진단 영역. 2026-09-20 부터 화면 아래가 아니라 상단 "진단" 버튼으로 연다 —
 * 늘 펼쳐 두면 화면만 길어진다. 이 컴포넌트는 계속 붙어 있고(권한 판정을 한 번만 한다),
 * 보일지는 `open` 이 정한다. 권한이 없으면 `onAvailable(false)` 로 알려 버튼조차 나오지 않게 한다.
 * `deskrpg doctor` 가 CLI 에서 보여 주던 것을 그대로 본다.
 *
 * 관리자가 아닌 사용자에게는 서버가 404 를 주고, 그때 이 컴포넌트는 **아무것도 그리지 않는다** —
 * 관리자 기능이 있다는 사실조차 화면에 남기지 않는다. 서버가 만든 문장을 그대로 보여 줄 뿐
 * 브라우저가 게이트웨이·DB 를 직접 찌르지 않는다(비밀은 서버 밖으로 나가지 않는다).
 */
type DiagnosticsReport = {
  environment: { errors: string[]; warnings: string[]; dbTarget: string };
  database: { ok: boolean; target: string; message: string };
  hostSetup: { wizard: boolean; hermesInstall: boolean };
  gateways: { id: string; label: string; pluginStatus: string; checkedAt: string | null }[];
};

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "failed" }
  | { kind: "ready"; report: DiagnosticsReport };

const mark = (value: boolean) => (value ? "✓" : "✗");

export default function DiagnosticsPanel({
  open = true,
  onAvailable,
}: {
  open?: boolean;
  onAvailable?: (available: boolean) => void;
} = {}) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/diagnostics");
        if (cancelled) return;
        // 404 는 "권한 없음" 의 위장이다 — 조용히 사라진다.
        if (res.status === 404) return setState({ kind: "hidden" });
        if (!res.ok) return setState({ kind: "failed" });
        setState({ kind: "ready", report: (await res.json()) as DiagnosticsReport });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 판정이 끝나면 호출부에 알린다 — 렌더 중에 부모 상태를 바꾸지 않도록 effect 에서.
  const available = state.kind === "ready" || state.kind === "failed";
  useEffect(() => {
    if (state.kind !== "loading") onAvailable?.(available);
  }, [state.kind, available, onAvailable]);

  if (!available || !open) return null;

  return (
    <details
      data-testid="diagnostics-panel"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <summary className="cursor-pointer text-lg font-semibold">{t("diagnostics.title")}</summary>
      {state.kind === "failed" ? (
        <p className="mt-3 text-sm text-danger">{t("diagnostics.failed")}</p>
      ) : (
        <div className="mt-4 space-y-4 text-sm">
          <section>
            <h3 className="font-semibold">
              {t("diagnostics.environment")} · {state.report.environment.dbTarget}
            </h3>
            {state.report.environment.errors.length === 0 &&
            state.report.environment.warnings.length === 0 ? (
              <p className="mt-1 text-text-muted">{t("diagnostics.none")}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {state.report.environment.errors.map((message) => (
                  <li key={message} className="text-danger">
                    ✗ {message}
                  </li>
                ))}
                {state.report.environment.warnings.map((message) => (
                  <li key={message} className="text-text-muted">
                    ! {message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="font-semibold">
              {t("diagnostics.database")} · {state.report.database.target}
            </h3>
            <p className={`mt-1 ${state.report.database.ok ? "text-text-muted" : "text-danger"}`}>
              {mark(state.report.database.ok)} {state.report.database.message}
            </p>
          </section>

          <section>
            <h3 className="font-semibold">{t("diagnostics.hostSetup")}</h3>
            {/* 환경변수 이름은 번역하지 않는다 — 운영자가 그대로 찾아 켜야 하는 스위치다. */}
            <ul className="mt-1 space-y-1 text-text-muted">
              <li>{mark(state.report.hostSetup.wizard)} DESKRPG_HOST_SETUP_ENABLED</li>
              <li>{mark(state.report.hostSetup.hermesInstall)} DESKRPG_HERMES_INSTALL_ENABLED</li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold">{t("diagnostics.gateways")}</h3>
            {state.report.gateways.length === 0 ? (
              <p className="mt-1 text-text-muted">{t("diagnostics.none")}</p>
            ) : (
              <ul className="mt-1 space-y-1 text-text-muted">
                {state.report.gateways.map((gateway) => (
                  <li key={gateway.id}>
                    {gateway.label} · {gateway.pluginStatus}
                    {gateway.checkedAt ? ` · ${gateway.checkedAt}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </details>
  );
}
