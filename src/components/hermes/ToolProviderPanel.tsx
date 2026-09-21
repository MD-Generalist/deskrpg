"use client";

/**
 * 도구 하나의 프로바이더를 고르고 필요한 API 키를 넣는다 — `hermes tools` 의 도구별 설정 단계.
 *
 * 행은 플러그인(0.10.0)이 Hermes 의 `TOOL_CATEGORIES` 에서 그대로 준다. 키는 쓰기 전용이다 — 서버는
 * 설정 여부만 알려 주고, 입력한 값은 저장 뒤 화면에서도 지운다. 서버에 설치하거나 구독 로그인이 필요한
 * 행(`setup: "cli"`)은 고를 수 없고 명령을 안내한다.
 *
 * 소유자만 이 패널을 본다(쓰기 라우트가 소유자 전용이다). 호출부가 그 판정을 한다.
 */
import { useCallback, useEffect, useState, type JSX } from "react";

import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import type { ToolProviderRow, ToolProvidersPayload } from "@/lib/hermes/plugin-client-types";

import { isSafeHttpUrl } from "./provider-auth-model";
import { SECRET_INPUT_PROPS } from "./secret-input";

type Props = {
  profileBase: string;
  toolset: string;
  /** 저장이 끝났다 — 호출부가 "키 필요" 같은 표시를 고친다. */
  onSaved?(result: { provider: string; ready: boolean }): void;
  disabled?: boolean;
};

type Body = Record<string, unknown>;

async function readBody(res: Response): Promise<Body> {
  try {
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { errorCode: "malformed_response" };
    }
    return body as Body;
  } catch {
    return { errorCode: "malformed_response" };
  }
}

/**
 * 처음 고를 행: 지금 쓰는 것 → 이미 준비된 행(키 없이 되는 무료 행 등) → 앱에서 고를 수 있는 첫 행.
 * Hermes 의 행 순서는 추천 순이지만 첫 행이 구독·설치 행이거나 키가 필요한 경우가 흔하다(웹 검색).
 */
export function defaultProviderChoice(payload: ToolProvidersPayload): string | null {
  if (payload.activeProvider) return payload.activeProvider;
  const selectable = payload.providers.filter((p) => p.setup !== "cli");
  return (selectable.find((p) => p.status === "ready") ?? selectable[0])?.name ?? null;
}

/** 주소 같은 비밀이 아닌 값 — 가리지 않고, 비밀번호 관리자 표시만 유지한다. */
export function isPlainEnvValue(key: string): boolean {
  return /_(URL|BASE_URL|HOST|ENDPOINT)$/.test(key);
}

const STATUS_KEY: Record<ToolProviderRow["status"], string> = {
  ready: "hermes.toolProviders.status.ready",
  needs_keys: "hermes.toolProviders.status.needsKeys",
  needs_setup: "hermes.toolProviders.status.needsSetup",
  needs_auth: "hermes.toolProviders.status.needsAuth",
};

export default function ToolProviderPanel({
  profileBase,
  toolset,
  onSaved,
  disabled,
}: Props): JSX.Element {
  const t = useT();
  const base = `${profileBase}/toolsets/${encodeURIComponent(toolset)}`;
  const [payload, setPayload] = useState<ToolProvidersPayload | null>(null);
  const [loadError, setLoadError] = useState<Body | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Body | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(
    async (keepChoice: boolean) => {
      setLoadError(null);
      try {
        const res = await fetch(`${base}/providers`);
        const body = await readBody(res);
        if (typeof body.errorCode === "string" || !res.ok) {
          setLoadError(body);
          return;
        }
        const next = body as unknown as ToolProvidersPayload;
        setPayload(next);
        setChoice((prev) => (keepChoice && prev ? prev : defaultProviderChoice(next)));
      } catch {
        setLoadError({});
      }
    },
    [base],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const row = payload?.providers.find((p) => p.name === choice) ?? null;
  const missing = row
    ? row.envVars.filter((e) => !e.isSet && !(values[e.key] ?? "").trim()).map((e) => e.key)
    : [];

  const save = async () => {
    if (!row || row.setup === "cli" || missing.length > 0) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const env: Record<string, string> = {};
      for (const e of row.envVars) {
        const v = (values[e.key] ?? "").trim();
        if (v) env[e.key] = v;
      }
      const res = await fetch(`${base}/provider`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: row.name, env }),
      });
      const body = await readBody(res);
      if (typeof body.errorCode === "string" || !res.ok) {
        setSaveError(body);
        return;
      }
      // 키 값은 저장 뒤 화면에서도 지운다 — 다시 보여 줄 이유가 없다.
      setValues({});
      setSaved(true);
      onSaved?.({ provider: row.name, ready: true });
      await load(true);
    } catch {
      setSaveError({});
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-danger">
          {getLocalizedErrorMessage(t, loadError, "hermes.toolProviders.loadFailed")}
        </p>
        <button
          type="button"
          onClick={() => void load(false)}
          className="rounded bg-surface-raised px-2 py-1 text-xs font-semibold"
        >
          {t("hermes.picker.retry")}
        </button>
      </div>
    );
  }
  if (!payload) return <p className="text-xs text-text-muted">{t("hermes.picker.loading")}</p>;

  return (
    <div className="space-y-3" data-tool-panel={toolset}>
      <p className="text-xs font-semibold text-text">{t("hermes.toolProviders.choose")}</p>
      <div className="space-y-1">
        {payload.providers.map((p) => (
          <label key={p.name} className="flex items-start gap-2 text-sm text-text">
            <input
              type="radio"
              name={`tool-provider-${toolset}`}
              className="mt-1"
              value={p.name}
              checked={choice === p.name}
              disabled={disabled || saving}
              onChange={() => {
                setChoice(p.name);
                setSaved(false);
                setSaveError(null);
              }}
            />
            <span className="min-w-0">
              <span className="font-medium">{p.name}</span>
              {p.badge && (
                <span className="ml-2 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted">
                  {p.badge}
                </span>
              )}
              {p.active && (
                <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {t("hermes.toolProviders.inUse")}
                </span>
              )}
              <span className="ml-1 text-[10px] text-text-muted">{t(STATUS_KEY[p.status])}</span>
              {p.tag && <span className="block text-xs text-text-muted">{p.tag}</span>}
            </span>
          </label>
        ))}
      </div>

      {row?.setup === "cli" && (
        <div className="space-y-1 text-xs text-text-muted">
          <p>{t("hermes.toolProviders.cliHint")}</p>
          <code className="block rounded bg-bg px-2 py-1 text-text">{payload.cliCommand}</code>
        </div>
      )}

      {row?.setup === "keys" && (
        <div className="space-y-2">
          {row.envVars.map((e) => (
            <label key={e.key} className="block space-y-1 text-xs text-text">
              <span className="font-semibold">
                {e.prompt}
                <span className="ml-2 font-mono font-normal text-text-muted">{e.key}</span>
                {e.url && isSafeHttpUrl(e.url) && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 font-normal text-primary underline"
                  >
                    {t("hermes.toolProviders.getKey")}
                  </a>
                )}
              </span>
              <input
                {...SECRET_INPUT_PROPS}
                type={isPlainEnvValue(e.key) ? "text" : "password"}
                data-env-key={e.key}
                value={values[e.key] ?? ""}
                disabled={disabled || saving}
                placeholder={
                  e.isSet
                    ? t("hermes.toolProviders.keySetPlaceholder")
                    : isPlainEnvValue(e.key)
                      ? t("hermes.toolProviders.urlPlaceholder")
                      : t("hermes.providerAuth.keyPlaceholder")
                }
                onChange={(ev) => setValues((prev) => ({ ...prev, [e.key]: ev.target.value }))}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
              />
            </label>
          ))}
        </div>
      )}

      {saveError && (
        <p className="text-xs text-danger">
          {getLocalizedErrorMessage(t, saveError, "hermes.toolProviders.saveFailed")}
        </p>
      )}
      {saved && <p className="text-xs text-success">{t("hermes.toolProviders.saved")}</p>}

      {row && row.setup !== "cli" && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={disabled || saving || missing.length > 0}
          className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {saving ? t("hermes.wizard.config.saving") : t("hermes.toolProviders.save")}
        </button>
      )}
    </div>
  );
}
