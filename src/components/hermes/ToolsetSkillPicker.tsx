"use client";

/**
 * 프로필의 Hermes 툴셋·스킬을 이름을 타이핑하는 대신 체크리스트로 고른다.
 *
 * 선택 상태는 호출부가 소유한다(제어 컴포넌트). `null` 을 넘기면 서버의 현재 상태가
 * 기본값이고, 불러온 직후 `onLoaded` 로 그 값을 알려 준다. 저장도 호출부 몫이다 —
 * config PUT 에 `{ enabledToolsets, disabledSkills }` 로 보낸다. 올리는 목록에는 불러온 행 이름만
 * 싣는다(필수 스킬 제외) — 플러그인이 모르는 이름을 400 으로 거절하므로, 시드는 `onLoaded` 로 한다.
 * 구버전 플러그인(`plugin_upgrade_required`)이면 아무것도 그리지 않고 `onUnsupported` 를
 * 불러 호출부가 텍스트 입력으로 폴백하게 한다.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import type { SkillRow, ToolsetRow } from "@/lib/hermes/plugin-client-types";

import {
  classifyLoad,
  groupSkills,
  initialSelection,
  toggleSkill,
  toggleToolset,
} from "./picker-model";
import Modal from "@/components/ui/Modal";

import ToolProviderPanel from "./ToolProviderPanel";

export type ToolsetSkillPickerProps = {
  profileBase: string; // `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(name)}`
  enabledToolsets: string[] | null; // null = 서버 현재 상태를 기본값으로
  onEnabledToolsetsChange(next: string[]): void;
  disabledSkills: string[] | null;
  onDisabledSkillsChange(next: string[]): void;
  onLoaded?(initial: { enabledToolsets: string[]; disabledSkills: string[] }): void;
  onUnsupported?(): void; // plugin_upgrade_required → 호출부가 텍스트 입력으로 폴백
  disabled?: boolean;
  /**
   * 게이트웨이 소유자인가(플러그인 0.10.0 `profile_tool_providers`). 참이면 프로바이더를 고르는 도구에
   * "설정" 을 붙이고, 설정이 필요한 도구를 체크하는 순간 설정 패널을 펼친다. 키 쓰기가 소유자 전용이다.
   */
  canManageToolProviders?: boolean;
};

type Phase = "loading" | "ok" | "error" | "unsupported";
type Body = Record<string, unknown>;
type LoadResult = {
  key: string;
  phase: Exclude<Phase, "loading">;
  toolsets: ToolsetRow[];
  skills: SkillRow[];
  errorBody: Body | null;
};

const EMPTY = { toolsets: [] as ToolsetRow[], skills: [] as SkillRow[], errorBody: null };

/** 본문이 JSON 객체가 아니면(HTML 오류 페이지·빈 본문·잘린 JSON) 오류로 흐르게 한다 —
 *  `NpcHireWizard` 의 `parseJsonBody` 와 같은 코드로, 이미 등록·번역된 코드다. */
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

export default function ToolsetSkillPicker(props: ToolsetSkillPickerProps): JSX.Element | null {
  const t = useT();
  const { profileBase } = props;
  const [query, setQuery] = useState("");
  // 펼친 도구 설정 패널 하나. 저장이 끝난 도구는 목록을 다시 받지 않고 "키 필요" 만 걷는다 —
  // 다시 받으면 onLoaded 가 체크 상태를 서버 값으로 되돌려, 아직 저장 안 한 체크를 잃는다.
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [configuredNow, setConfiguredNow] = useState<Record<string, boolean>>({});
  const [reloadSeq, setReloadSeq] = useState(0);
  // 결과에 요청 키를 붙여 둔다 — 키가 지금 요청과 다르면 "불러오는 중" 이다. 효과 안에서
  // 동기로 loading 을 되돌리지 않아도 profileBase 가 바뀌거나 다시 시도하면 곧바로 로딩이 된다.
  const loadKey = `${profileBase}\n${reloadSeq}`;
  const [result, setResult] = useState<LoadResult | null>(null);

  // 부모가 인라인 함수를 넘겨도 다시 불러오지 않도록 콜백은 ref 로 들고 있는다.
  const callbacks = useRef({ onLoaded: props.onLoaded, onUnsupported: props.onUnsupported });
  useEffect(() => {
    callbacks.current = { onLoaded: props.onLoaded, onUnsupported: props.onUnsupported };
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let responses: Response[];
      let bodies: Body[];
      try {
        responses = await Promise.all([
          fetch(`${profileBase}/toolsets`),
          fetch(`${profileBase}/skills`),
        ]);
        bodies = await Promise.all(responses.map(readBody));
      } catch {
        // 네트워크 실패 — 보여 줄 코드가 없으니 일반 문구(loadFailed)로 떨어진다.
        if (!cancelled) setResult({ key: loadKey, phase: "error", ...EMPTY });
        return;
      }
      if (cancelled) return;
      // 게이트 실패(401·409·428 …)는 errorCode 를 싣지만, 싣지 않은 non-2xx 가 와도 빈 목록을
      // "정상"으로 그리지 않는다 — 일반 문구로 떨어진다.
      const bare = responses.findIndex((r, i) => !r.ok && typeof bodies[i].errorCode !== "string");
      if (bare >= 0) {
        setResult({ key: loadKey, phase: "error", ...EMPTY });
        return;
      }
      const verdict = classifyLoad(bodies);
      if (verdict === "unsupported") {
        setResult({ key: loadKey, phase: "unsupported", ...EMPTY });
        callbacks.current.onUnsupported?.();
        return;
      }
      if (verdict === "error") {
        const errorBody = bodies.find((b) => typeof b.errorCode === "string") ?? null;
        setResult({ key: loadKey, phase: "error", ...EMPTY, errorBody });
        return;
      }
      const [toolsetBody, skillBody] = bodies;
      const toolsets = Array.isArray(toolsetBody.toolsets)
        ? (toolsetBody.toolsets as ToolsetRow[])
        : [];
      const skills = Array.isArray(skillBody.skills) ? (skillBody.skills as SkillRow[]) : [];
      setResult({ key: loadKey, phase: "ok", toolsets, skills, errorBody: null });
      callbacks.current.onLoaded?.(initialSelection(toolsets, skills));
    })();
    return () => {
      cancelled = true;
    };
  }, [profileBase, loadKey]);

  const current = result?.key === loadKey ? result : null;
  const phase: Phase = current?.phase ?? "loading";
  const toolsets = current?.toolsets ?? EMPTY.toolsets;
  const skills = current?.skills ?? EMPTY.skills;
  const errorBody = current?.errorBody ?? null;

  const serverDefaults = useMemo(() => initialSelection(toolsets, skills), [toolsets, skills]);
  const enabledToolsets = props.enabledToolsets ?? serverDefaults.enabledToolsets;
  const disabledSkills = props.disabledSkills ?? serverDefaults.disabledSkills;
  const groups = useMemo(() => groupSkills(skills, query), [skills, query]);

  if (phase === "unsupported") return null;

  if (phase === "loading") {
    return <p className="text-xs text-text-muted">{t("hermes.picker.loading")}</p>;
  }

  if (phase === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-danger">
          {getLocalizedErrorMessage(t, errorBody, "hermes.picker.loadFailed")}
        </p>
        <button
          type="button"
          onClick={() => setReloadSeq((n) => n + 1)}
          className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-raised/80"
        >
          {t("hermes.picker.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <fieldset className="space-y-1 rounded border border-border p-3">
        <legend className="px-1 text-xs font-semibold text-text">
          {t("hermes.picker.toolsets")}
        </legend>
        {toolsets.map((ts) => {
          const configurable = Boolean(props.canManageToolProviders && ts.hasProviders);
          const configured = configuredNow[ts.name] ?? ts.configured;
          return (
            <div key={ts.name} className="space-y-1">
              <div className="flex items-start gap-2">
                <label className="flex min-w-0 flex-1 items-start gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    className="mt-1"
                    data-toolset={ts.name}
                    checked={enabledToolsets.includes(ts.name)}
                    disabled={props.disabled}
                    onChange={(e) => {
                      props.onEnabledToolsetsChange(
                        toggleToolset(enabledToolsets, ts.name, e.target.checked, toolsets),
                      );
                      // `hermes tools` 처럼, 설정이 안 된 도구를 켜면 곧바로 프로바이더·키를 묻는다.
                      if (e.target.checked && configurable && configured === false)
                        setOpenTool(ts.name);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{ts.label || ts.name}</span>
                    {configured === false && (
                      <span className="ml-2 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted">
                        {t("hermes.picker.needsKey")}
                      </span>
                    )}
                    {ts.description && (
                      <span className="block text-xs text-text-muted">{ts.description}</span>
                    )}
                  </span>
                </label>
                {configurable && (
                  <button
                    type="button"
                    data-configure-tool={ts.name}
                    onClick={() => setOpenTool(ts.name)}
                    className="shrink-0 rounded bg-surface-raised px-2 py-1 text-xs font-semibold text-text hover:bg-surface-raised/80"
                  >
                    {t("hermes.toolProviders.configure")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </fieldset>

      {/* 도구별 제공자 설정은 목록 사이에 펼치지 않고 팝업으로 띄운다 — 제공자가 열 개 넘는 도구(TTS·웹)가
          목록을 밀어내 어느 도구를 보던 중인지 잃게 했다. 한 번에 하나만 연다. */}
      {openTool && (
        <Modal
          open
          size="md"
          onClose={() => setOpenTool(null)}
          title={t("hermes.toolProviders.title", {
            tool: toolsets.find((ts) => ts.name === openTool)?.label || openTool,
          })}
        >
          <Modal.Body>
            <ToolProviderPanel
              profileBase={profileBase}
              toolset={openTool}
              disabled={props.disabled}
              onSaved={() => setConfiguredNow((cur) => ({ ...cur, [openTool]: true }))}
            />
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              onClick={() => setOpenTool(null)}
              className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-raised/80"
            >
              {t("hermes.toolProviders.close")}
            </button>
          </Modal.Footer>
        </Modal>
      )}

      <fieldset className="space-y-2 rounded border border-border p-3">
        <legend className="px-1 text-xs font-semibold text-text">
          {t("hermes.picker.skills")}
        </legend>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("hermes.picker.searchSkills")}
          className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
        />
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="text-xs text-text-muted">{t("hermes.picker.noSkills")}</p>
          ) : (
            groups.map((group) => (
              <div key={group.category || "__uncategorized"} className="space-y-1">
                <p className="text-xs font-semibold text-text-muted">
                  {group.category || t("hermes.picker.uncategorized")}
                </p>
                {group.skills.map((skill) => (
                  <label key={skill.name} className="flex items-start gap-2 text-sm text-text">
                    {/* 체크는 "켜짐" 을 뜻한다 — disabledSkills 의 반대. */}
                    <input
                      type="checkbox"
                      className="mt-1"
                      data-skill={skill.name}
                      checked={skill.essential || !disabledSkills.includes(skill.name)}
                      disabled={props.disabled || skill.essential}
                      onChange={(e) =>
                        props.onDisabledSkillsChange(
                          toggleSkill(disabledSkills, skill.name, e.target.checked, skills),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{skill.name}</span>
                      {skill.essential && (
                        <span className="ml-2 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted">
                          {t("hermes.picker.essential")}
                        </span>
                      )}
                      {skill.description && (
                        <span className="block text-xs text-text-muted">{skill.description}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            ))
          )}
        </div>
      </fieldset>
    </div>
  );
}
