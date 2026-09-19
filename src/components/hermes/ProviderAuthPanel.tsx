"use client";

/**
 * NPC 프로필이 쓰는 모델 프로바이더를 앱 안에서 인증한다 — 게이트웨이 소유자용.
 *
 * `authType` 별로 세 가지다.
 * - `oauth_device`: 로그인 → 코드와 인증 페이지 링크를 보여 주고, 승인될 때까지 세션을 폴링한다.
 * - `api_key`: 쓰기 전용 키 입력. 값은 서버로 보내고 다시 읽어 오지 않는다.
 * - `external`: 앱에서 할 수 없는 로그인 — 게이트웨이 호스트에서 칠 명령만 안내한다.
 * `authType` 이 없으면(구버전 플러그인·모르는 프로바이더) 아무것도 그리지 않는다.
 *
 * 비밀 값 규칙: 키 입력란은 비제어(uncontrolled)다. 제어 입력은 React 가 `value` **속성**까지
 * 동기화해 DOM 직렬화(innerHTML)에 키가 실린다 — 값은 입력란 프로퍼티에만 있고, 저장 성공
 * 시 비운다. 로그로 내보내지 않고, 실패 문구는 코드로만 현지화한다(업스트림 `error` 원문 금지).
 *
 * 폴링 규칙: `setTimeout` 체인 — 응답을 받은 뒤에야 다음을 예약하므로 겹치지 않는다.
 * 취소·언마운트는 타이머를 풀고 살아 있는 세션을 한 번만 DELETE 한다. 승인·거절·만료처럼
 * 업스트림이 끝낸 세션은 지우지 않는다.
 */
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";

import { CopyCommand } from "@/components/CopyCommand";
import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage, isErrorCode } from "@/lib/i18n/error-codes";
import type {
  OAuthPollPayload,
  OAuthStartPayload,
  ProviderAuthType,
} from "@/lib/hermes/plugin-client-types";

import { isSafeHttpUrl, oauthReducer, pollDelayMs } from "./provider-auth-model";
import { SECRET_INPUT_PROPS } from "./secret-input";
import { getWizardErrorMessage, isWizardErrorCode } from "./wizard-error-codes";

/**
 * `provider.name` 은 그리지 않는다 — 제목·이름은 호출부가 붙인다(이 패널은 인증 조작만).
 * `profileBase`·`provider.id` 가 바뀌면 패널 상태 전체를 새로 시작한다(아래 기본 export 참조).
 */
export type ProviderAuthPanelProps = {
  profileBase: string; // `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(name)}`
  provider: {
    id: string;
    name: string;
    authenticated: boolean;
    authType?: ProviderAuthType;
    envVars?: string[];
    cliCommand?: string | null;
  };
  onAuthenticated(): void; // 로그인·키 저장·연결 끊기 성공 뒤 — 호출부가 카탈로그를 다시 불러온다
  disabled?: boolean;
};

type Body = Record<string, unknown>;
type Translator = ReturnType<typeof useT>;

const TERMINAL_STATUSES: ReadonlyArray<OAuthPollPayload["status"]> = [
  "approved",
  "denied",
  "expired",
  "error",
];
/** 프록시가 HTTP 200 + errorCode 로 싣는 일시 오류 — 네트워크 실패처럼 만료 전까지 다시 묻는다. */
const TRANSIENT_POLL_CODES: ReadonlySet<string> = new Set([
  "timeout",
  "unreachable",
  "upstream_error",
]);
/** 네트워크가 끊겨 폴 응답을 못 받는 동안 무한히 돌지 않도록 — 만료 시각 + 여유. */
const EXPIRY_GRACE_MS = 30_000;

const BTN =
  "rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-raised/80 disabled:opacity-50";
const BTN_PRIMARY =
  "rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50";
const BADGE = "rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted";

/** 본문이 JSON 객체가 아니면 `malformed_response` 로 흐르게 한다(ToolsetSkillPicker 와 같다). */
async function readBody(response: Response): Promise<Body> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { errorCode: "malformed_response" };
    }
    return body as Body;
  } catch {
    return { errorCode: "malformed_response" };
  }
}

/** 업스트림 실패는 HTTP 200 + `errorCode` 로 온다 — 상태 코드만 보지 않는다. */
function succeeded(response: Response, body: Body): boolean {
  return response.ok && typeof body.errorCode !== "string";
}

function errorCodeOf(body: Body | null, fallback: string): string {
  return body && typeof body.errorCode === "string" ? body.errorCode : fallback;
}

/**
 * 코드 → 현지화 문구. 공용 표(`error-codes.ts`)에 없고 마법사 표에만 있는 프록시 코드
 * (`timeout`·`unreachable`·`upstream_error` …)는 그 표로 옮긴다. 어느 쪽도 아니면 fallback.
 */
function errorText(t: Translator, code: string, fallbackKey: string): string {
  if (!isErrorCode(code) && isWizardErrorCode(code)) return getWizardErrorMessage(t, code);
  return getLocalizedErrorMessage(t, { errorCode: code }, fallbackKey);
}

/** 성공 뒤 호출부가 카탈로그를 다시 불러오기 전까지 보여 줄 인증 상태. `base` 는 그때의 prop —
 *  prop 이 바뀌면(다시 불러옴) 덮어쓴 값은 저절로 물러난다. */
type Override = { base: boolean; value: boolean } | null;

/**
 * 대상(`profileBase`·`provider.id`)마다 안쪽 패널을 새로 마운트한다. 상태가 이어지면 입력해 둔
 * 키가 **다른** 프로바이더 엔드포인트로 PUT 되거나, 진행 중 로그인이 옛 세션을 새 경로로
 * 폴링하거나, "연결됨" 덮어쓰기가 엉뚱한 프로바이더에 남는다. 키를 바꾸면 옛 패널이
 * 언마운트되며 살아 있는 세션을 한 번 DELETE 하고 입력란도 함께 사라진다.
 */
export default function ProviderAuthPanel(props: ProviderAuthPanelProps): JSX.Element | null {
  return <ProviderAuthPanelInner key={`${props.profileBase}|${props.provider.id}`} {...props} />;
}

function ProviderAuthPanelInner(props: ProviderAuthPanelProps): JSX.Element | null {
  const t = useT();
  const { profileBase, provider, disabled = false } = props;
  const providerPath = `${profileBase}/oauth/${encodeURIComponent(provider.id)}`;
  const keyPath = `${profileBase}/provider-keys/${encodeURIComponent(provider.id)}`;

  const [oauth, dispatch] = useReducer(oauthReducer, { kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const [hasKeyValue, setHasKeyValue] = useState(false);
  const [override, setOverride] = useState<Override>(null);
  const keyInput = useRef<HTMLInputElement | null>(null);

  const connected =
    override && override.base === provider.authenticated ? override.value : provider.authenticated;

  // 부모가 인라인 함수를 넘겨도 폴링을 다시 걸지 않도록 최신 prop 은 ref 로 든다.
  const latest = useRef({
    onAuthenticated: props.onAuthenticated,
    profileBase,
    authenticated: provider.authenticated,
  });
  useEffect(() => {
    latest.current = {
      onAuthenticated: props.onAuthenticated,
      profileBase,
      authenticated: provider.authenticated,
    };
  });

  /** DELETE 해야 할 살아 있는 세션. 한 번 비우면 다시 지우지 않는다 — DELETE 는 정확히 1회. */
  const liveSession = useRef<string | null>(null);
  const pollDelay = useRef(pollDelayMs(undefined));
  const unmounted = useRef(false);

  const releaseSession = useCallback(() => {
    const sessionId = liveSession.current;
    if (!sessionId) return;
    liveSession.current = null;
    void fetch(`${latest.current.profileBase}/oauth/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }).catch(() => {
      // 지우지 못해도 세션은 업스트림에서 만료된다 — 화면에 알릴 것이 없다.
    });
  }, []);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      releaseSession();
    };
  }, [releaseSession]);

  const markAuthenticated = useCallback((value: boolean) => {
    setOverride({ base: latest.current.authenticated, value });
    latest.current.onAuthenticated();
  }, []);

  // ── OAuth 폴링 ────────────────────────────────────────────────────────────
  const waitingSession = oauth.kind === "waiting" ? oauth.sessionId : null;
  const waitingExpiresAt = oauth.kind === "waiting" ? oauth.expiresAt : 0;

  useEffect(() => {
    if (!waitingSession) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const url = `${providerPath}/sessions/${encodeURIComponent(waitingSession)}`;

    const schedule = (delay: number) => {
      timer = setTimeout(() => void tick(), delay);
    };

    async function tick() {
      let response: Response | null = null;
      let body: Body = {};
      try {
        response = await fetch(url);
        body = await readBody(response);
      } catch {
        response = null; // 일시적인 네트워크 실패 — 만료 전까지는 다시 묻는다.
      }
      if (stopped) return;

      const transient =
        !response ||
        (!succeeded(response, body) &&
          typeof body.errorCode === "string" &&
          TRANSIENT_POLL_CODES.has(body.errorCode));
      if (transient) {
        if (Date.now() > waitingExpiresAt + EXPIRY_GRACE_MS) {
          releaseSession();
          dispatch({ type: "poll", status: "expired", error: null });
          return;
        }
        schedule(pollDelay.current);
        return;
      }
      if (!response || !succeeded(response, body)) {
        releaseSession();
        dispatch({ type: "fail", errorCode: errorCodeOf(body, "oauth_error") });
        return;
      }

      const status = body.status as OAuthPollPayload["status"] | undefined;
      if (status === "pending") {
        const retryAfter = typeof body.retryAfter === "number" ? body.retryAfter * 1000 : 0;
        schedule(Math.max(pollDelay.current, retryAfter));
        return;
      }
      if (status && TERMINAL_STATUSES.includes(status)) {
        // 업스트림이 끝낸 세션 — 지울 것이 없다.
        liveSession.current = null;
        dispatch({ type: "poll", status, error: null });
        if (status === "approved") markAuthenticated(true);
        return;
      }
      releaseSession();
      dispatch({ type: "fail", errorCode: "malformed_response" });
    }

    schedule(pollDelay.current);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [waitingSession, waitingExpiresAt, providerPath, releaseSession, markAuthenticated]);

  const startLogin = async () => {
    setActionError(null);
    dispatch({ type: "start" });
    let ok = false;
    let body: Body = {};
    try {
      const response = await fetch(`${providerPath}/start`, { method: "POST" });
      body = await readBody(response);
      ok = succeeded(response, body);
    } catch {
      // 네트워크 실패 — 아래에서 oauth_error 로 떨어진다.
    }
    const start = body as Partial<OAuthStartPayload>;
    // 업스트림에 세션이 생겼으면 먼저 붙잡는다 — 화면이 이미 닫혔거나 응답 모양이 틀려도
    // 치울 수 있게.
    if (ok && typeof start.sessionId === "string" && start.sessionId !== "") {
      liveSession.current = start.sessionId;
    }
    if (unmounted.current) {
      releaseSession();
      return;
    }
    if (!ok) {
      dispatch({ type: "fail", errorCode: errorCodeOf(body, "oauth_error") });
      return;
    }
    if (
      typeof start.sessionId !== "string" ||
      start.sessionId === "" ||
      typeof start.userCode !== "string" ||
      typeof start.verificationUrl !== "string"
    ) {
      releaseSession();
      dispatch({ type: "fail", errorCode: "malformed_response" });
      return;
    }
    pollDelay.current = pollDelayMs(start.pollInterval);
    dispatch({
      type: "started",
      sessionId: start.sessionId,
      userCode: start.userCode,
      verificationUrl: start.verificationUrl,
      expiresIn: typeof start.expiresIn === "number" ? start.expiresIn : 900,
      now: Date.now(),
    });
  };

  const cancelLogin = () => {
    releaseSession();
    dispatch({ type: "cancel" });
  };

  /** 연결 끊기·키 저장·키 삭제의 공통 뼈대. 성공이면 응답 본문, 실패면 null. */
  const mutate = async (url: string, init: RequestInit): Promise<Body | null> => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(url, init);
      const body = await readBody(response);
      if (unmounted.current) return null;
      if (!succeeded(response, body)) {
        setActionError(errorCodeOf(body, "unknown"));
        return null;
      }
      return body;
    } catch {
      if (!unmounted.current) setActionError("unknown");
      return null;
    } finally {
      if (!unmounted.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    const body = await mutate(providerPath, { method: "DELETE" });
    if (!body) return;
    dispatch({ type: "cancel" });
    // ok:false 는 그 프로필 auth.json 에 지울 것이 없었다는 뜻이다(인증은 환경변수·풀에서 올 수 있다) —
    // 끊겼다고 덮어쓰지 않고 다시 불러온 카탈로그 상태를 그대로 보인다.
    if (body.ok === false) latest.current.onAuthenticated();
    else markAuthenticated(false);
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    const input = keyInput.current;
    const value = input?.value ?? "";
    if (!value) return;
    const ok =
      (await mutate(keyPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      })) !== null;
    if (!ok) return;
    if (input) input.value = "";
    setHasKeyValue(false);
    setEditingKey(false);
    markAuthenticated(true);
  };

  const removeKey = async () => {
    if ((await mutate(keyPath, { method: "DELETE" })) !== null) {
      setEditingKey(false);
      markAuthenticated(false);
    }
  };

  const actionErrorLine = actionError && (
    <p className="text-sm text-danger">
      {errorText(t, actionError, "hermes.providerAuth.actionFailed")}
    </p>
  );
  const connectedBadge = <span className={BADGE}>{t("hermes.providerAuth.connected")}</span>;

  // ── external ─────────────────────────────────────────────────────────────
  if (provider.authType === "external") {
    if (!connected && !provider.cliCommand) return null;
    return (
      <div className="space-y-2">
        {connected && <div>{connectedBadge}</div>}
        {provider.cliCommand && (
          <>
            <p className="text-xs text-text-muted">{t("hermes.providerAuth.cliHint")}</p>
            <CopyCommand command={provider.cliCommand} />
          </>
        )}
      </div>
    );
  }

  // ── oauth_device ─────────────────────────────────────────────────────────
  if (provider.authType === "oauth_device") {
    const inFlow = oauth.kind === "starting" || oauth.kind === "waiting";
    if (connected && !inFlow) {
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {connectedBadge}
            <button
              type="button"
              className={BTN}
              disabled={disabled || busy}
              onClick={() => void disconnect()}
            >
              {t("hermes.providerAuth.disconnect")}
            </button>
          </div>
          {actionErrorLine}
        </div>
      );
    }

    if (oauth.kind === "waiting") {
      return (
        <div className="space-y-2 rounded border border-border p-3">
          <p className="text-xs text-text-muted">{t("hermes.providerAuth.enterCode")}</p>
          <p className="font-mono text-lg font-semibold tracking-widest text-text select-all">
            {oauth.userCode}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {isSafeHttpUrl(oauth.verificationUrl) && (
              <a
                href={oauth.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={BTN_PRIMARY}
              >
                {t("hermes.providerAuth.openVerification")}
              </a>
            )}
            <button type="button" className={BTN} disabled={disabled} onClick={cancelLogin}>
              {t("hermes.providerAuth.cancel")}
            </button>
          </div>
          <p className="text-xs text-text-muted">{t("hermes.providerAuth.waiting")}</p>
        </div>
      );
    }

    if (oauth.kind === "failed") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-danger">
            {errorText(t, oauth.errorCode, "hermes.providerAuth.failed.oauth_error")}
          </p>
          <button
            type="button"
            className={BTN}
            disabled={disabled}
            onClick={() => void startLogin()}
          >
            {t("hermes.providerAuth.retry")}
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        className={BTN_PRIMARY}
        disabled={disabled || oauth.kind === "starting"}
        onClick={() => void startLogin()}
      >
        {t("hermes.providerAuth.login")}
      </button>
    );
  }

  // ── api_key ──────────────────────────────────────────────────────────────
  if (provider.authType === "api_key") {
    if (connected && !editingKey) {
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {connectedBadge}
            <button
              type="button"
              className={BTN}
              disabled={disabled || busy}
              onClick={() => {
                setActionError(null);
                setEditingKey(true);
              }}
            >
              {t("hermes.providerAuth.replaceKey")}
            </button>
            <button
              type="button"
              className={BTN}
              disabled={disabled || busy}
              onClick={() => void removeKey()}
            >
              {t("hermes.providerAuth.removeKey")}
            </button>
          </div>
          {actionErrorLine}
        </div>
      );
    }

    const envVar = provider.envVars?.[0];
    return (
      <form className="space-y-2" onSubmit={(e) => void saveKey(e)}>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-text">
            {t("hermes.providerAuth.keyLabel")}
            {envVar && <span className="ml-2 font-mono font-normal text-text-muted">{envVar}</span>}
          </span>
          <input
            ref={keyInput}
            {...SECRET_INPUT_PROPS}
            placeholder={t("hermes.providerAuth.keyPlaceholder")}
            disabled={disabled || busy}
            onChange={(e) => setHasKeyValue(e.target.value !== "")}
            className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={BTN_PRIMARY} disabled={disabled || busy || !hasKeyValue}>
            {t("hermes.providerAuth.saveKey")}
          </button>
          {connected && (
            <>
              <button
                type="button"
                className={BTN}
                disabled={disabled || busy}
                onClick={() => {
                  if (keyInput.current) keyInput.current.value = "";
                  setHasKeyValue(false);
                  setEditingKey(false);
                }}
              >
                {t("hermes.providerAuth.cancel")}
              </button>
              <button
                type="button"
                className={BTN}
                disabled={disabled || busy}
                onClick={() => void removeKey()}
              >
                {t("hermes.providerAuth.removeKey")}
              </button>
            </>
          )}
        </div>
        {actionErrorLine}
      </form>
    );
  }

  return null;
}
