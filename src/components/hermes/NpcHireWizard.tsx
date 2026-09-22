"use client";

/**
 * NPC 고용 마법사 — ①프로필 ②인격 ③외형 ④AI 모델. ④ 에서 끝난다.
 *
 * 능력에 따라 단계가 눈에 보이게 줄어든다(`availableSteps`) — 잠긴 단계도 회색으로
 * 남고 이유를 보여준다, 숨기지 않는다. ②③ 은 다룰 프로필이 생기기 전까지 잠긴다.
 *
 * 예전의 ④ 배치는 없앴다. 할 일이 없는 링크 버튼("완성형 외형 선택하기"·"채널로 이동"·
 * "마법사 닫기")만 남은 단계였다. 외형은 등록 때 자동으로 배정되고(`registerHermesProfile`)
 * 직원 상세에서 바꾼다. 자리는 맵이 맡는다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage, withHeaderErrorCode } from "@/lib/i18n/error-codes";
import { isCreatableProfileName } from "@/lib/hermes/creatable-profile-name";
import { profileLoginUrl } from "@/lib/hermes/dashboard-link";
import type { PluginStatus } from "@/lib/hermes/plugin-capability";
import type { CatalogPayload } from "@/lib/hermes/plugin-client-types";

import {
  availableSteps,
  classifyServingCheck,
  identityDecision,
  nextStep,
  type StepAvailability,
  type WizardStep,
  previousStep,
  nextLockedReason,
} from "./hire-wizard-steps";
import ProfileAppearanceEditor from "./ProfileAppearanceEditor";
import ProviderAuthPanel from "./ProviderAuthPanel";
import ToolsetSkillPicker from "./ToolsetSkillPicker";
import { getWizardErrorMessage } from "./wizard-error-codes";
import type { CharacterAppearance } from "@/game/three/office-appearance";

// ---------------------------------------------------------------------------
// Types mirroring the proxy routes' response shapes (Task 5·6·7)
// ---------------------------------------------------------------------------

type ProvisionedProfile = {
  name: string;
  /**
   * 이 프로필이 **실제로 출근한 채널 수**. 출근은 그 게이트웨이가 이미 붙어 있는 채널에만
   * 일어나므로, 0 이면 ③ 의 결과 줄에서 "출근했습니다" 라고 말하면 안 된다. 이어서 편집하는
   * 기존 프로필(`resumed`)은 알 수 없으므로 `undefined` 다.
   */
  attendedChannels?: number;
  keyIssued: boolean;
  keyError?: string;
  keyStored: boolean;
  keyStoredError?: string;
  /** 기본 프로필 복제가 실패했다(프로필은 만들어졌다). 복제를 요청했을 때만 온다. */
  cloneError?: string;
  /** 복제로 물려받은 설정·키의 **이름**. 값은 오지 않는다. */
  cloned?: { configKeys?: string[]; envKeys?: string[] };
};

type IdentityPayload = {
  body: string | null;
  isDefaultTemplate: boolean | null;
  revision: string | null;
  unreadable?: boolean;
};

type ProxyFailure = {
  errorCode?: string;
  error?: string;
  shellCommand?: string | null;
  upstreamStatus?: number | null;
};

interface NpcHireWizardProps {
  gatewayId: string;
  pluginStatus: PluginStatus;
  localDiscovery: boolean;
  /**
   * 이 게이트웨이에 **이미 등록된** 프로필 이름들.
   *
   * 없으면 마법사는 "이번에 만든 프로필" 로만 ②③ 을 진행할 수 있어, 중간에 닫으면
   * 돌아갈 길이 사라진다(스테이징 실측 2026-09-03: `oliver` 를 만들고 닫았더니 인격을
   * 편집할 방법이 없었다). 기존 프로필의 인격·설정을 나중에 고치는 것도 마법사의
   * 정당한 용도다 — 스펙이 그 입구를 빠뜨렸다.
   */
  existingProfiles: string[];
  /**
   * 이 프로필로 **곧바로 ②인격부터** 시작한다. 프로필 목록의 "인격" 버튼이 쓴다 —
   * 마법사를 열고 ①에서 다시 고르게 하면 기능이 있어도 아무도 못 찾는다
   * (스테이징에서 사용자가 실제로 "인격을 수정할 방법이 없어 보인다" 고 했다).
   */
  initialProfile?: string | null;
  /**
   * 게이트웨이의 Hermes 대시보드 공개 주소(플러그인 `dashboard_url`, 소유자에게만 온다).
   * ③ 설정에서 "이 직원으로 로그인" 링크를 만든다. 없으면 안내 문구만 보인다.
   */
  dashboardUrl?: string | null;
  /**
   * 화면 제목. 직원 상세에서 이 마법사를 **편집기로** 쓸 때 "직원 등록 마법사" 라는 제목이
   * 맥락과 어긋나므로 호출부가 바꿔 준다.
   */
  title?: string;
  /**
   * 새 프로필을 기본 프로필에서 복제해 모델 설정·프로바이더 키를 물려받는다. 플러그인이
   * `profile_clone` 을 알릴 때만 켠다 — 구버전에는 모르는 필드를 보내지 않는다.
   */
  cloneDefaultProfile?: boolean;
  /**
   * 이 사용자가 게이트웨이 소유자인가. 프로바이더 키 저장·로그인은 소유자만 할 수 있다
   * (공유 사용자는 403). 모르면 false — 누를 수 없는 버튼을 보여주지 않는다.
   */
  canManageProviderAuth?: boolean;
  /** ①에서 프로필이 실제로 만들어진 직후. 바깥 프로필 목록이 이것으로 곧바로 다시 읽는다. */
  onProfileCreated?: (profileName: string) => void;
  /**
   * 마법사가 끝났다. ③ 의 "완료" 로 끝나면 그 직원 이름을 싣는다 — 호출부가 직원 상세로
   * 보낼 수 있다. 닫기·삭제로 끝나면 인자가 없다.
   */
  onDone: (result?: { profileName: string }) => void;
}

/**
 * 응답 본문을 파싱한다. **파싱 실패를 성공으로 자칭하지 않는다.**
 *
 * 예전에는 호출부마다 `await res.json().catch(() => ({}))` 였다. 그 `{}` 는
 * `errorCode` 가 없으므로 아래 오류 분기를 그대로 통과해 **성공한 payload** 로
 * 취급됐고, 필드가 전부 `undefined` 인 채 화면 판정에 들어갔다. 스테이징에서
 * 실제로 그 결과가 나왔다(2026-09-02): 플러그인이 `isDefaultTemplate: true` 를
 * 줬는데 화면은 "이미 작성된 인격이 있습니다" 를 물었다 — 파싱이 깨졌을 때의
 * 폴백이 하필 **위험한 쪽**이었다.
 *
 * 이제 파싱에 실패하면 `malformed_response` 코드를 실어 오류로 흐르게 한다.
 * 서버가 무엇을 보냈든(HTML 오류 페이지, 빈 본문, 잘린 JSON) 화면은 "성공"이라고
 * 말하지 않는다.
 */
async function parseJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await res.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { errorCode: "malformed_response" };
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { errorCode: "malformed_response" };
  }
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const code = (payload as { errorCode?: unknown }).errorCode;
  return typeof code === "string" ? code : null;
}

/** 프록시 4종이 실패 응답에 함께 싣는 원 업스트림 상태 코드. 없으면 null(예: 네트워크 실패). */
function extractUpstreamStatus(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const status = (payload as { upstreamStatus?: unknown }).upstreamStatus;
  return typeof status === "number" ? status : null;
}

export default function NpcHireWizard({
  gatewayId,
  pluginStatus,
  localDiscovery,
  existingProfiles,
  initialProfile = null,
  dashboardUrl = null,
  title,
  cloneDefaultProfile = false,
  canManageProviderAuth = false,
  onProfileCreated,
  onDone,
}: NpcHireWizardProps) {
  const t = useT();

  // `initialProfile` 로 들어오면 ①(프로필 만들기)은 이미 끝난 일이다 — 곧바로 ②로 연다.
  // 다만 ②가 잠겨 있으면(플러그인 없음) 그리 보낼 수 없으므로 ①로 떨어진다.
  const [current, setCurrent] = useState<WizardStep>(() =>
    initialProfile &&
    availableSteps(pluginStatus, localDiscovery, true).find((s) => s.step === "identity")?.enabled
      ? "identity"
      : "profile",
  );

  // --- Step ① profile ---
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<ProvisionedProfile | null>(
    initialProfile ? { name: initialProfile, keyIssued: true, keyStored: true } : null,
  );
  /** 이번 세션에서 만든 것이 아니라 기존 프로필로 들어왔는가 — 닫기 확인 문구가 갈린다. */
  const [resumed, setResumed] = useState(Boolean(initialProfile));
  const [serving, setServing] = useState<
    "idle" | "checking" | "served" | "key_rejected" | "not_served" | "error"
  >("idle");
  const [servingError, setServingError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteShellCommand, setDeleteShellCommand] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const steps = useMemo(
    () => availableSteps(pluginStatus, localDiscovery, created !== null),
    [pluginStatus, localDiscovery, created],
  );
  const stepByName = useMemo(
    () => Object.fromEntries(steps.map((s) => [s.step, s])) as Record<WizardStep, StepAvailability>,
    [steps],
  );

  // 복제 때 키를 어디까지 물려받을지. 끄면 기본 프로필이 실제로 쓰는 프로바이더 키만,
  // 켜면 API 키형 프로바이더 키 전부(범용·OAuth 토큰 제외)를 복사한다(플러그인 cloneKeys).
  const [copyAllApiKeys, setCopyAllApiKeys] = useState(false);
  const [copyKeysHint, setCopyKeysHint] = useState(false);
  const nameTrimmed = name.trim();
  const nameValid = nameTrimmed.length > 0 && isCreatableProfileName(nameTrimmed);

  // --- Step ② identity ---
  const [identityPayload, setIdentityPayload] = useState<IdentityPayload | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [identityMode, setIdentityMode] = useState<"keep" | "new" | "load" | null>(null);
  const [identityBody, setIdentityBody] = useState("");
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identitySaved, setIdentitySaved] = useState(false);
  const [identityConflict, setIdentityConflict] = useState(false);
  // I-1: 충돌 시 원격 본문을 여기 따로 담는다 — 사용자가 방금 쓴 초안(identityBody)은
  // 절대 말없이 덮어쓰지 않는다. 사용자가 명시적으로 "이 내용으로 바꾸기" 를 눌러야만
  // identityBody 로 옮겨간다.
  const [conflictRemoteBody, setConflictRemoteBody] = useState<string | null>(null);

  // --- Step ③ appearance ---
  // 외형은 DeskRPG 의 hermes_profiles 행에 산다 — 그 행의 id 와 현재 값을 목록에서 찾는다.
  const [appearanceTarget, setAppearanceTarget] = useState<{
    id: string;
    appearance: CharacterAppearance | null;
  } | null>(null);
  const [appearanceError, setAppearanceError] = useState("");
  const [appearanceSaved, setAppearanceSaved] = useState(false);

  // --- Step ④ config ---
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const [configLocked, setConfigLocked] = useState(false);
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  /**
   * 그 프로필이 실제로 요청을 보내는 주소(`model.base_url`). 제공자를 바꿔도 이 값은 남아
   * 이름표만 새 제공자이고 요청은 옛 엔드포인트로 간다(Hermes 런타임은 이 키만 읽는다).
   * 말없이 지우지 않는다 — 커스텀 엔드포인트를 쓰는 사람에게는 그 주소가 정상이다.
   */
  const [baseUrl, setBaseUrl] = useState("");
  const [clearBaseUrl, setClearBaseUrl] = useState(false);
  const [toolsetsText, setToolsetsText] = useState("");
  // 툴셋·스킬 체크리스트(플러그인 0.9.0+). null 이면 서버의 현재 상태가 기본값이다.
  // 사람이 건드렸을 때만 저장에 싣는다 — 안 건드린 채 저장해 현재 상태를 다시 쓰지 않는다.
  const [enabledToolsets, setEnabledToolsets] = useState<string[] | null>(null);
  const [disabledSkills, setDisabledSkills] = useState<string[] | null>(null);
  const [pickerDirty, setPickerDirty] = useState(false);
  const [pickerUnsupported, setPickerUnsupported] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [effort, setEffort] = useState("");
  /**
   * 모델·프로바이더·추론 강도 목록. 캐시하지 않는다 — Hermes 가 models.dev 를 20분
   * TTL 로 캐시하고 있어서, 여기서 또 들고 있으면 "매번 최신" 이 두 배로 늦어진다.
   */
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [catalogError, setCatalogError] = useState("");

  const profileBase = created
    ? `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(created.name)}`
    : null;

  const createdName = created?.name ?? null;
  useEffect(() => {
    if (current !== "appearance" || !createdName) return;
    if (appearanceTarget || appearanceError) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/gateways/${gatewayId}/profiles`);
        const data = (await res.json().catch(() => ({}))) as {
          profiles?: Array<{ id?: unknown; profileName?: unknown; appearance?: unknown }>;
        };
        const row = (data.profiles ?? []).find((p) => p.profileName === createdName);
        if (cancelled) return;
        if (!row || typeof row.id !== "string") {
          setAppearanceError(t("hermes.wizard.appearance.loadFailed"));
          return;
        }
        setAppearanceTarget({
          id: row.id,
          appearance: (row.appearance as CharacterAppearance | null) ?? null,
        });
      } catch {
        if (!cancelled) setAppearanceError(t("errors.connectionFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, createdName, gatewayId, appearanceTarget, appearanceError, t]);

  /**
   * 인격 응답 하나를 화면 상태로 옮긴다 — 저장과 **편집 모드 판정을 함께** 한다.
   *
   * ① 의 서빙 확인과 ② 의 조회가 같은 응답을 받는다. 예전에는 ① 쪽이 payload 만 저장하고
   * 모드를 정하지 않아, ② 가 (이미 payload 가 있으니) 다시 읽지 않은 채 모드 null 로 떨어져
   * 방금 만든 프로필에 "이미 작성된 인격이 있습니다" 를 물었다(2026-09-18 로컬 실측).
   */
  const applyIdentityPayload = useCallback((payload: IdentityPayload) => {
    setIdentityPayload(payload);
    const decision = identityDecision(payload);
    if (decision === "edit_fresh") {
      setIdentityMode("new");
      setIdentityBody("");
    } else if (decision === "ask_overwrite") {
      setIdentityMode(null);
      setIdentityBody(payload.body ?? "");
    } else {
      // blocked — 편집기를 열지 않는다.
      setIdentityMode(null);
    }
  }, []);

  // --- Step ① actions ---

  /**
   * 이미 등록된 프로필로 ②③ 을 진행한다.
   *
   * 새로 만들지 않으므로 키 발급·저장 관련 상태는 "이미 있는 것" 으로 채운다 —
   * `keyIssued`/`keyStored` 를 true 로 두는 것은 거짓이 아니라 **사실**이다:
   * 이 프로필은 `hermes_profiles` 에 토큰이 저장돼 있어야만 목록에 뜬다.
   * 다만 `resumed` 를 세워, 닫을 때 "방금 만든 프로필이 남습니다" 를 묻지 않게 한다 —
   * 우리가 만든 것이 아니므로 지울지 물으면 안 된다.
   */
  const handleResume = useCallback((profileName: string) => {
    setCreated({ name: profileName, keyIssued: true, keyStored: true });
    setResumed(true);
    setCreateError("");
  }, []);

  const handleCreate = useCallback(async () => {
    if (!nameValid) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/plugin/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameTrimmed,
          ...(cloneDefaultProfile ? { cloneFrom: "default" } : {}),
          ...(cloneDefaultProfile && copyAllApiKeys ? { cloneKeys: "api_keys" } : {}),
        }),
      });
      const data = withHeaderErrorCode(await parseJsonBody(res), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        setCreateError(getWizardErrorMessage(t, code));
        return;
      }
      if (!res.ok) {
        setCreateError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      const profile = data as ProvisionedProfile;
      setCreated(profile);
      // 바깥 목록은 마법사가 닫힐 때만 다시 읽었다 — 그동안 방금 만든 직원이 목록에서
      // 빠져 있어 "등록된 프로필이 없습니다" 가 그대로 남았다(실측 2026-09-17).
      onProfileCreated?.(profile.name);

      // keyStored 가 false 면 어느 쪽이든 프로필 토큰이 DeskRPG 에 없다 —
      // 인격·설정 단계는 그 토큰이 있어야 부를 수 있으므로 서빙 확인을 건너뛴다.
      if (!profile.keyStored) {
        setServing("idle");
        return;
      }

      setServing("checking");
      setServingError("");
      const idRes = await fetch(
        `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(profile.name)}/identity`,
      );
      const idData = withHeaderErrorCode(await idRes.json().catch(() => ({})), idRes.headers);
      const idCode = extractErrorCode(idData);
      // 판정 I: served_profiles 스냅샷을 쓰지 않는다 — 방금 만든 프로필을 실제로
      // 호출해 판정한다. 수정 라운드 1: 프록시가 이제 `upstreamStatus` 를 함께
      // 실어 보내므로, 401(키 문제)과 404(allowlist 로 서빙 안 함)를 가른다 —
      // 둘 다 `plugin_error` 로 뭉쳐지던 문제(리뷰 지적)를 여기서 고친다.
      const verdict = classifyServingCheck({
        errorCode: idCode,
        upstreamStatus: extractUpstreamStatus(idData),
      });
      if (verdict === "served") {
        setServing("served");
        applyIdentityPayload(idData as IdentityPayload);
      } else if (verdict === "key_rejected") {
        setServing("key_rejected");
      } else if (verdict === "not_served") {
        setServing("not_served");
      } else {
        setServing("error");
        setServingError(getWizardErrorMessage(t, idCode));
      }
    } catch {
      setCreateError(t("errors.connectionFailed"));
    } finally {
      setCreating(false);
    }
  }, [
    applyIdentityPayload,
    cloneDefaultProfile,
    copyAllApiKeys,
    gatewayId,
    nameTrimmed,
    nameValid,
    onProfileCreated,
    t,
  ]);

  const handleDeleteCreated = useCallback(async () => {
    if (!created) return;
    setDeleting(true);
    setDeleteError("");
    setDeleteShellCommand(null);
    try {
      const res = await fetch(
        `/api/gateways/${gatewayId}/plugin/profiles/${encodeURIComponent(created.name)}`,
        { method: "DELETE" },
      );
      const data = withHeaderErrorCode(await parseJsonBody(res), res.headers) as ProxyFailure;
      const code = extractErrorCode(data);
      if (code) {
        setDeleteError(getWizardErrorMessage(t, code));
        if (data.shellCommand) setDeleteShellCommand(data.shellCommand);
        return;
      }
      if (!res.ok) {
        setDeleteError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      // 지웠으니 처음부터 다시 — 마법사를 닫는다.
      setCreated(null);
      setShowCloseConfirm(false);
      onDone();
    } catch {
      setDeleteError(t("errors.connectionFailed"));
    } finally {
      setDeleting(false);
    }
  }, [created, gatewayId, onDone, t]);

  // --- Step ② actions ---

  const loadIdentity = useCallback(async () => {
    if (!profileBase) return;
    setIdentityLoading(true);
    setIdentityError("");
    setIdentityConflict(false);
    setConflictRemoteBody(null);
    setIdentitySaved(false);
    try {
      const res = await fetch(`${profileBase}/identity`);
      const data = withHeaderErrorCode(await parseJsonBody(res), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        setIdentityError(getWizardErrorMessage(t, code));
        setIdentityPayload(null);
        return;
      }
      applyIdentityPayload(data as IdentityPayload);
    } catch {
      setIdentityError(t("errors.connectionFailed"));
    } finally {
      setIdentityLoading(false);
    }
  }, [applyIdentityPayload, profileBase, t]);

  useEffect(() => {
    if (current === "identity" && !identityPayload && !identityLoading) {
      void loadIdentity();
    }
  }, [current, identityPayload, identityLoading, loadIdentity]);

  // I-1: `revision_conflict`/`revision_mismatch`(결함 8 — 플러그인이 실제로 내는 코드는
  // 후자다) 를 맞았을 때 **전용** 재조회. `loadIdentity` 를 재사용하지 않는다 — 그 함수는
  // 첫 줄에서 `identityConflict` 를 꺼버리고, `identityDecision` 결과에 따라
  // `identityMode`/`identityBody` 를 초기화한다. 같은 틱에 배너가 켜졌다 꺼지고,
  // 사용자가 방금 쓴 초안이 원격 본문으로 조용히 교체되는 사고가 여기서 났었다(리뷰
  // Important-1). 이 함수는 revision 만 최신화하고 사용자 초안·현재 모드는 건드리지 않는다.
  const refetchIdentityForConflict = useCallback(async () => {
    if (!profileBase) return;
    try {
      const res = await fetch(`${profileBase}/identity`);
      const data = withHeaderErrorCode(await parseJsonBody(res), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        // 재조회 자체가 실패했다 — 충돌 배너는 유지하되 원격 본문은 보여줄 수 없다.
        setIdentityError(getWizardErrorMessage(t, code));
        return;
      }
      const payload = data as IdentityPayload;
      setIdentityPayload((prev) => (prev ? { ...prev, revision: payload.revision } : payload));
      setConflictRemoteBody(payload.body ?? "");
    } catch {
      setIdentityError(t("errors.connectionFailed"));
    }
  }, [profileBase, t]);

  const handleSaveIdentity = useCallback(async () => {
    if (!profileBase || !identityPayload) return;
    setIdentitySaving(true);
    setIdentityError("");
    setIdentitySaved(false);
    try {
      const res = await fetch(`${profileBase}/identity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: identityBody, ifRevision: identityPayload.revision ?? "" }),
      });
      const data = withHeaderErrorCode(await parseJsonBody(res), res.headers);
      const code = extractErrorCode(data);
      // 결함 8: 플러그인이 실제로 내는 코드는 `revision_mismatch` 다(스펙은
      // `revision_conflict` 라고 적었지만 구현이 그렇게 안 됐다) — 둘 다 받는다.
      if (code === "revision_conflict" || code === "revision_mismatch") {
        setIdentityConflict(true);
        await refetchIdentityForConflict();
        return;
      }
      if (code) {
        setIdentityError(getWizardErrorMessage(t, code));
        return;
      }
      if (!res.ok) {
        setIdentityError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      const saved = data as { revision: string };
      setIdentityPayload((prev) => (prev ? { ...prev, revision: saved.revision } : prev));
      setIdentityConflict(false);
      setConflictRemoteBody(null);
      setIdentitySaved(true);
    } catch {
      setIdentityError(t("errors.connectionFailed"));
    } finally {
      setIdentitySaving(false);
    }
  }, [identityBody, identityPayload, profileBase, refetchIdentityForConflict, t]);

  // --- Step ③ actions ---

  const loadConfig = useCallback(async () => {
    if (!profileBase) return;
    setConfigLoading(true);
    setConfigError("");
    setConfigLocked(false);
    try {
      const res = await fetch(`${profileBase}/config`);
      const data = withHeaderErrorCode(await parseJsonBody(res), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        // "unreadable"(200 분기)·"config_unreadable"(409) 둘 다 폼을 잠근다 — 빈
        // 폼으로 저장하면 기존 설정을 지운다.
        if (code === "unreadable" || code === "config_unreadable") {
          setConfigLocked(true);
        }
        setConfigError(getWizardErrorMessage(t, code));
        return;
      }
      const record = data as Record<string, unknown>;
      setModel(typeof record.model === "string" ? record.model : "");
      setProvider(typeof record.provider === "string" ? record.provider : "");
      setBaseUrl(typeof record.baseUrl === "string" ? record.baseUrl : "");
      setClearBaseUrl(false);
      setEffort(typeof record.reasoning_effort === "string" ? record.reasoning_effort : "");
      const toolsets = record.toolsets;
      setToolsetsText(
        Array.isArray(toolsets) ? toolsets.filter((x) => typeof x === "string").join(", ") : "",
      );
    } catch {
      setConfigError(t("errors.connectionFailed"));
    } finally {
      setConfigLoading(false);
    }
  }, [profileBase, t]);

  useEffect(() => {
    if (
      current === "config" &&
      !configLoading &&
      !model &&
      !provider &&
      !toolsetsText &&
      !configError
    ) {
      void loadConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  /**
   * 모델·프로바이더 목록을 받아온다. 실패해도 ③단계를 막지 않는다 — 목록이 없으면
   * 직접 입력으로 떨어질 뿐이고, 그게 예전 동작이다. 드롭다운을 못 채웠다고 설정
   * 자체를 못 하게 하면 기능이 후퇴한다.
   */
  const loadCatalog = useCallback(async () => {
    if (!profileBase) return;
    setCatalogError("");
    try {
      const res = await fetch(`${profileBase}/catalog`);
      const data = withHeaderErrorCode(await parseJsonBody(res), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        setCatalogError(getWizardErrorMessage(t, code));
        setCatalog(null);
        return;
      }
      setCatalog(data as unknown as CatalogPayload);
    } catch {
      setCatalogError(t("errors.connectionFailed"));
      setCatalog(null);
    }
  }, [profileBase, t]);

  // ③ 에 들어오면 카탈로그를 한 번 받는다. 설정 로딩과 독립이라 별도 effect 다 —
  // 하나가 실패해도 다른 하나는 진행한다.
  useEffect(() => {
    if (current === "config" && profileBase && !catalog && !catalogError) {
      void loadCatalog();
    }
  }, [current, profileBase, catalog, catalogError, loadCatalog]);

  const handleSaveConfig = useCallback(async () => {
    if (!profileBase) return;
    setConfigSaving(true);
    setConfigError("");
    setConfigSaved(false);
    try {
      const patch: Record<string, unknown> = {};
      if (model.trim()) patch.model = model.trim();
      if (provider.trim()) patch.provider = provider.trim();
      if (!pickerUnsupported) {
        // 체크리스트는 대화에 실제로 반영되는 플랫폼별 툴셋을 쓴다. 최상위 `toolsets` 는
        // 대화에 반영되지 않으므로 함께 보내지 않는다(플러그인 0.9.0 계약).
        if (pickerDirty && enabledToolsets) patch.enabledToolsets = enabledToolsets;
        if (pickerDirty && disabledSkills) patch.disabledSkills = disabledSkills;
      } else {
        const toolsets = toolsetsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (toolsets.length > 0) patch.toolsets = toolsets;
      }
      // 빈 문자열도 보낸다 — "지정 안 함" 으로 되돌리는 유일한 방법이다.
      // 조건을 걸면 한 번 고른 effort 를 화면에서 해제할 수 없어진다.
      if (catalog) patch.reasoning_effort = effort;
      // 사용자가 확인한 경우에만 주소를 지운다(플러그인 0.10.1 의 신호).
      if (clearBaseUrl && baseUrl) patch.clearBaseUrl = true;

      const res = await fetch(`${profileBase}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = withHeaderErrorCode(await parseJsonBody(res), res.headers);
      const code = extractErrorCode(data);
      if (code) {
        setConfigError(getWizardErrorMessage(t, code));
        return;
      }
      if (!res.ok) {
        setConfigError(getLocalizedErrorMessage(t, data, "common.error"));
        return;
      }
      setConfigSaved(true);
      if (patch.clearBaseUrl) {
        setBaseUrl("");
        setClearBaseUrl(false);
      }
    } catch {
      setConfigError(t("errors.connectionFailed"));
    } finally {
      setConfigSaving(false);
    }
  }, [
    baseUrl,
    catalog,
    clearBaseUrl,
    disabledSkills,
    effort,
    enabledToolsets,
    model,
    pickerDirty,
    pickerUnsupported,
    profileBase,
    provider,
    t,
    toolsetsText,
  ]);

  // --- Navigation ---

  const goNext = useCallback(() => {
    const next = nextStep(current, steps);
    if (next) setCurrent(next);
  }, [current, steps]);

  const goBack = useCallback(() => {
    const previous = previousStep(current, steps);
    if (previous) setCurrent(previous);
  }, [current, steps]);

  const requestClose = useCallback(() => {
    // `resumed` 면 이 프로필은 **우리가 만든 것이 아니다** — 지울지 물으면 안 된다.
    // 확인 패널의 문구가 "방금 만든 프로필이 남습니다, 지울까요?" 이므로, 남의
    // 프로필에 그걸 띄우면 사용자를 실수로 유도한다.
    if (created && !resumed && !showCloseConfirm) {
      setShowCloseConfirm(true);
      return;
    }
    onDone();
  }, [created, resumed, onDone, showCloseConfirm]);

  // ---------------------------------------------------------------------------

  // I-2: 삭제 실패 표시를 한 조각으로 뽑아 두 자리(닫기-확인 패널 / ①의
  // keyIssued:false 박스 "지우고 다시 시도")가 같이 쓴다. 예전엔 이 상태를 렌더하는
  // 곳이 닫기-확인 패널뿐이라, keyIssued:false 쪽에서 `profile_has_service` 로
  // 거절되면 셸 명령이 통째로 버려지고 화면엔 아무것도 안 떴다.
  const deleteFailureBlock = (deleteError || deleteShellCommand) && (
    <div className="space-y-1">
      {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
      {deleteShellCommand && (
        <div className="space-y-1">
          <p className="text-xs text-text-muted">{t("hermes.wizard.deleteFailedShell")}</p>
          <pre className="overflow-x-auto rounded bg-bg px-3 py-2 text-xs text-text">
            {deleteShellCommand}
          </pre>
        </div>
      )}
    </div>
  );

  // 플러그인 0.9.0+ 는 카탈로그 행에 인증 방식(authType)을 싣는다 — 그러면 DeskRPG 안에서
  // 키를 넣거나 로그인할 수 있으니, 인증 안 된 프로바이더도 고를 수 있게 하고 아래 패널로 인증한다.
  const inAppAuth = Boolean(catalog?.providers.some((p) => p.authType));
  const selectedProviderRow = catalog?.providers.find((p) => p.id === provider) ?? null;
  // 목록을 받았는데 고른 프로바이더가 인증 전이면 모델을 고를 수 없다(목록이 오지 않는다).
  const providerAwaitingAuth = Boolean(selectedProviderRow && !selectedProviderRow.authenticated);
  const catalogModels = catalog?.models[provider] ?? [];
  // 저장돼 있던 모델이 목록에 없더라도 드롭다운이 그 값을 말없이 비우지 않게 앞에 둔다.
  const modelOptions =
    catalogModels.length > 0 && model && !catalogModels.includes(model)
      ? [model, ...catalogModels]
      : catalogModels;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title ?? t("hermes.wizard.title")}</h2>
        <button
          type="button"
          onClick={requestClose}
          className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
        >
          {t("hermes.wizard.close")}
        </button>
      </div>

      {/* 잠긴 단계도 회색으로 남긴다 — 사라지면 사용자는 그런 기능이 있는 줄도 모른다. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {steps.map((s) => (
          <button
            key={s.step}
            type="button"
            disabled={!s.enabled}
            onClick={() => s.enabled && setCurrent(s.step)}
            title={s.lockedReason ? t(s.lockedReason) : undefined}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              current === s.step
                ? "border-primary bg-primary/10 text-primary"
                : s.enabled
                  ? "border-border bg-surface-raised text-text hover:bg-surface-raised/80"
                  : "border-border/60 bg-surface-raised/40 text-text-muted"
            }`}
          >
            {t(`hermes.wizard.step.${s.step}`)}
          </button>
        ))}
      </div>
      {showCloseConfirm && created && (
        <div className="mb-4 space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
          <p className="text-sm font-semibold text-npc-dark">
            {t("hermes.wizard.closeConfirmTitle")}
          </p>
          <p className="text-sm text-text-muted">
            {t("hermes.wizard.closeConfirmBody", { name: created.name })}
          </p>
          {deleteFailureBlock}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDeleteCreated()}
              className="rounded bg-danger/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger disabled:opacity-60"
            >
              {deleting ? t("common.loading") : t("hermes.wizard.closeConfirmDelete")}
            </button>
            <button
              type="button"
              onClick={() => onDone()}
              className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
            >
              {t("hermes.wizard.closeConfirmKeep")}
            </button>
            <button
              type="button"
              onClick={() => setShowCloseConfirm(false)}
              className="rounded px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text"
            >
              {t("hermes.wizard.back")}
            </button>
          </div>
        </div>
      )}

      {!showCloseConfirm && current === "profile" && stepByName.profile?.enabled && (
        <div className="space-y-3">
          {pluginStatus !== "plugin_ready" ? (
            <p className="text-sm text-text-muted">{t("hermes.wizard.profile.needsPlugin")}</p>
          ) : !created ? (
            <>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("hermes.wizard.profile.namePlaceholder")}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
              />
              <p className="text-xs text-text-muted">{t("hermes.wizard.profile.nameHint")}</p>
              {existingProfiles.length > 0 && (
                <div className="space-y-1 border-t border-border pt-3">
                  <p className="text-xs text-text-muted">{t("hermes.wizard.profile.resumeHint")}</p>
                  <div className="flex flex-wrap gap-2">
                    {existingProfiles.map((profileName) => (
                      <button
                        key={profileName}
                        type="button"
                        onClick={() => handleResume(profileName)}
                        className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                      >
                        {profileName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {cloneDefaultProfile && (
                <label className="flex items-start gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={copyAllApiKeys}
                    onChange={(e) => setCopyAllApiKeys(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {t("hermes.wizard.profile.copyAllApiKeys")}
                    {/* 자세한 사정은 눌러야 보인다 — 체크박스 밑의 두 줄이 화면을 길게 만들었다. */}
                    <button
                      type="button"
                      aria-label={t("hermes.wizard.profile.copyAllApiKeysHint")}
                      aria-expanded={copyKeysHint}
                      data-hint="copy-all-api-keys"
                      className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs font-semibold text-text-muted hover:bg-surface-raised"
                      onClick={(e) => {
                        e.preventDefault();
                        setCopyKeysHint((open) => !open);
                      }}
                    >
                      ?
                    </button>
                    {copyKeysHint && (
                      <span className="mt-1 block text-xs text-text-muted">
                        {t("hermes.wizard.profile.copyAllApiKeysHint")}
                      </span>
                    )}
                  </span>
                </label>
              )}
              {nameTrimmed.length > 0 && !nameValid && (
                <p className="text-xs text-danger">{t("hermes.wizard.profile.nameInvalid")}</p>
              )}
              {createError && <p className="text-sm text-danger">{createError}</p>}
              <button
                type="button"
                disabled={!nameValid || creating}
                onClick={() => void handleCreate()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {creating ? t("hermes.wizard.profile.creating") : t("hermes.wizard.profile.create")}
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text">
                {t("hermes.wizard.profile.created", { name: created.name })}
              </p>
              {created.cloned && !created.cloneError && (
                <p className="text-xs text-text-muted">{t("hermes.wizard.profile.cloned")}</p>
              )}
              {created.cloneError && (
                // 프로필은 만들어졌다 — 모델을 ③ 에서 직접 고르면 된다. 막지 않고 알린다.
                <p className="text-xs text-npc-dark">{t("hermes.wizard.profile.cloneFailed")}</p>
              )}

              {!created.keyIssued && (
                <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
                  <p className="text-sm font-semibold text-npc-dark">
                    {t("hermes.wizard.profile.keyIssuedFalseTitle")}
                  </p>
                  {created.keyError && (
                    <p className="text-xs text-text-muted">{created.keyError}</p>
                  )}
                  {deleteFailureBlock}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDeleteCreated()}
                      className="rounded bg-danger/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger disabled:opacity-60"
                    >
                      {t("hermes.wizard.profile.deleteAndRetry")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDone()}
                      className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                    >
                      {t("hermes.wizard.profile.enterKeyInShell")}
                    </button>
                  </div>
                </div>
              )}

              {created.keyIssued && !created.keyStored && (
                <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-3">
                  <p className="text-sm font-semibold text-danger">
                    {t("hermes.wizard.profile.keyStoredFalseTitle")}
                  </p>
                  {created.keyStoredError && (
                    // 최종 리뷰 M-3: 이 값은 이제 한국어 문장이 아니라 코드다 —
                    // wizard-error-codes 사전으로 번역해야 en/ja/zh 사용자도 읽는다.
                    <p className="text-xs text-text-muted">
                      {getWizardErrorMessage(t, created.keyStoredError)}
                    </p>
                  )}
                </div>
              )}

              {created.keyStored && (
                <>
                  {serving === "checking" && (
                    <p className="text-sm text-text-muted">
                      {t("hermes.wizard.profile.verifying")}
                    </p>
                  )}
                  {serving === "served" && (
                    <p className="text-sm text-success">{t("hermes.wizard.profile.served")}</p>
                  )}
                  {serving === "key_rejected" && (
                    <p className="text-sm text-danger">{t("hermes.wizard.profile.keyRejected")}</p>
                  )}
                  {serving === "not_served" && (
                    <p className="text-sm text-danger">{t("hermes.wizard.profile.notServed")}</p>
                  )}
                  {serving === "error" && <p className="text-sm text-danger">{servingError}</p>}
                  {serving === "served" && (
                    <button
                      type="button"
                      onClick={goNext}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
                    >
                      {t("hermes.wizard.profile.continue")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!showCloseConfirm && current === "identity" && stepByName.identity?.enabled && (
        <div className="space-y-3">
          {identityLoading ? (
            <p className="text-sm text-text-muted">{t("hermes.wizard.identity.loading")}</p>
          ) : identityError ? (
            <p className="text-sm text-danger">{identityError}</p>
          ) : !identityPayload ? (
            // 조회 전 한 틱. 예전에는 여기서 null 을 "읽지 못함" 으로 접어, 조회가 시작되기도
            // 전에 "인격 파일을 읽을 수 없어…" 가 떴다.
            <p className="text-sm text-text-muted">{t("hermes.wizard.identity.loading")}</p>
          ) : identityPayload.unreadable || identityDecision(identityPayload) === "blocked" ? (
            <p className="text-sm text-danger">{t("hermes.wizard.identity.blocked")}</p>
          ) : identityMode === null && identityPayload ? (
            <div className="space-y-2">
              <p className="text-sm text-text">{t("hermes.wizard.identity.askOverwriteTitle")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIdentityMode("keep")}
                  className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.identity.keepExisting")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIdentityMode("new");
                    setIdentityBody("");
                  }}
                  className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.identity.writeNew")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIdentityMode("load");
                    setIdentityBody(identityPayload.body ?? "");
                  }}
                  className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.identity.loadForEdit")}
                </button>
              </div>
            </div>
          ) : identityMode === "keep" ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-muted">{t("hermes.wizard.identity.skip")}</p>
              <button
                type="button"
                onClick={goNext}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
              >
                {t("hermes.wizard.next")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {identityConflict && (
                // I-1: 배너가 자기 자신을 지우거나 사용자 초안을 말없이 덮어쓰지 않는다.
                // 아래 textarea 의 `identityBody` 는 이 블록과 무관하게 그대로 남는다 —
                // 사용자가 명시적으로 "이 내용으로 바꾸기" 를 눌러야만 교체된다.
                <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
                  <p className="text-sm font-semibold text-npc-dark">
                    {t("hermes.wizard.identity.conflict")}
                  </p>
                  {conflictRemoteBody !== null && (
                    <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-bg px-3 py-2 text-xs text-text-muted">
                      {conflictRemoteBody || t("hermes.wizard.identity.conflictRemoteEmpty")}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setIdentityConflict(false)}
                      className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                    >
                      {t("hermes.wizard.identity.conflictKeepDraft")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIdentityBody(conflictRemoteBody ?? "");
                        setIdentityConflict(false);
                        setConflictRemoteBody(null);
                      }}
                      className="rounded bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-raised/80"
                    >
                      {t("hermes.wizard.identity.conflictUseRemote")}
                    </button>
                  </div>
                </div>
              )}
              <textarea
                value={identityBody}
                onChange={(e) => {
                  setIdentityBody(e.target.value);
                  setIdentitySaved(false);
                }}
                placeholder={t("hermes.wizard.identity.placeholder")}
                rows={8}
                className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
              />
              {identitySaved && (
                <p className="text-xs text-success">{t("hermes.wizard.identity.saved")}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={identitySaving}
                  onClick={() => void handleSaveIdentity()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  {identitySaving
                    ? t("hermes.wizard.identity.saving")
                    : t("hermes.wizard.identity.save")}
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded bg-surface-raised px-4 py-2 text-sm font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.next")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!showCloseConfirm && current === "appearance" && stepByName.appearance?.enabled && (
        <div className="space-y-3">
          {appearanceError ? (
            <p className="text-sm text-danger">{appearanceError}</p>
          ) : !appearanceTarget ? (
            <p className="text-sm text-text-muted">{t("common.loading")}</p>
          ) : (
            <ProfileAppearanceEditor
              key={appearanceTarget.id}
              gatewayId={gatewayId}
              profileId={appearanceTarget.id}
              initialAppearance={appearanceTarget.appearance}
              onSaved={() => setAppearanceSaved(true)}
            />
          )}
          {appearanceSaved && (
            <p className="text-xs text-success">{t("hermes.wizard.appearance.saved")}</p>
          )}
          <button
            type="button"
            onClick={goNext}
            className="rounded bg-surface-raised px-4 py-2 text-sm font-semibold hover:bg-surface-raised/80"
          >
            {t("hermes.wizard.next")}
          </button>
        </div>
      )}

      {!showCloseConfirm && current === "config" && stepByName.config?.enabled && (
        <div className="space-y-3">
          {configLoading ? (
            <p className="text-sm text-text-muted">{t("hermes.wizard.config.loading")}</p>
          ) : configLocked ? (
            <p className="text-sm text-danger">{t("hermes.wizard.config.locked")}</p>
          ) : (
            <>
              {configError && !configLocked && <p className="text-sm text-danger">{configError}</p>}
              {catalogError && <p className="text-xs text-text-muted">{catalogError}</p>}
              {created && !inAppAuth && (
                // Hermes 는 NPC(프로필)마다 로그인한다 — default 로 로그인한 구독을 새 직원이
                // 물려받지 않는다(업스트림 #111724). 목록의 "인증 안 됨" 만으로는 어디서
                // 로그인해야 하는지 알 수 없어, 그 직원 프로필의 로그인 화면으로 바로 보낸다.
                <div className="space-y-2 rounded border border-border bg-surface-raised/40 p-3 text-xs text-text-muted">
                  <p>{t("hermes.wizard.config.loginHint", { name: created.name })}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {profileLoginUrl(dashboardUrl, created.name) ? (
                      <a
                        href={profileLoginUrl(dashboardUrl, created.name) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded bg-primary px-3 py-1.5 font-semibold text-white hover:bg-primary-hover"
                      >
                        {t("hermes.wizard.config.loginOpen", { name: created.name })}
                      </a>
                    ) : (
                      <span>
                        {t("hermes.wizard.config.loginNoDashboard", { name: created.name })}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadCatalog()}
                      className="rounded bg-surface-raised px-3 py-1.5 font-semibold text-text hover:bg-surface-raised/80"
                    >
                      {t("hermes.wizard.config.loginRecheck")}
                    </button>
                  </div>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {/* 프로바이더를 먼저 고른다 — 모델 목록이 거기서 나온다. 인증되지 않은
                    것도 목록에 남긴다(지우면 "왜 내 모델이 없지" 를 알 수 없다). 앱 안에서 인증할 수
                    있으면(0.9.0+ 이고 소유자) 골라서 아래 패널로 인증하고, 아니면 고를 수 없다.
                    목록을 못 받았으면 예전처럼 직접 입력으로 떨어진다. */}
                {catalog ? (
                  <select
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value);
                      // 프로바이더가 바뀌면 이전 모델은 그 프로바이더의 것이 아니다.
                      // 남겨 두면 저장 시점에야 실패한다.
                      setModel("");
                    }}
                    className="rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">{t("hermes.wizard.config.provider")}</option>
                    {catalog.providers.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        disabled={!p.authenticated && !(inAppAuth && canManageProviderAuth)}
                      >
                        {p.name}
                        {p.authenticated ? "" : ` — ${t("hermes.wizard.config.notAuthenticated")}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder={t("hermes.wizard.config.provider")}
                    className="rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
                  />
                )}

                {providerAwaitingAuth ? (
                  // 플러그인은 인증된 프로바이더의 모델만 준다. 인증 전에는 목록이 없어 예전엔
                  // 자유 입력으로 떨어졌다 — 고를 수 없음을 보이고, 로그인하면 목록을 다시 받는다.
                  <select
                    value={model}
                    disabled
                    title={t("hermes.wizard.config.modelAfterAuth")}
                    className="rounded border border-border bg-bg px-3 py-2 text-sm text-text-muted opacity-70"
                  >
                    <option value={model}>
                      {model || t("hermes.wizard.config.modelAfterAuth")}
                    </option>
                  </select>
                ) : modelOptions.length > 0 ? (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">{t("hermes.wizard.config.model")}</option>
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={t("hermes.wizard.config.model")}
                    className="rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
                  />
                )}
              </div>

              {selectedProviderRow?.authType &&
                (canManageProviderAuth ? (
                  <ProviderAuthPanel
                    profileBase={profileBase ?? ""}
                    provider={selectedProviderRow}
                    onAuthenticated={() => void loadCatalog()}
                    disabled={configSaving}
                  />
                ) : (
                  !selectedProviderRow.authenticated && (
                    <p className="text-xs text-text-muted">
                      {t("hermes.wizard.config.ownerMustAuthenticate")}
                    </p>
                  )
                ))}

              {catalog && catalog.reasoningEfforts.length > 0 && (
                <select
                  value={effort}
                  onChange={(e) => setEffort(e.target.value)}
                  className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
                >
                  <option value="">{t("hermes.wizard.config.effort")}</option>
                  {catalog.reasoningEfforts.map((e2) => (
                    <option key={e2} value={e2}>
                      {e2}
                    </option>
                  ))}
                </select>
              )}
              {/* 도구·스킬은 처음 쓰는 사람이 고를 것이 아니다 — 기본값으로 두고 접는다. */}
              <details className="rounded border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold text-text">
                  {t("hermes.wizard.config.advanced")}
                </summary>
                <div className="mt-2 space-y-1">
                  {profileBase && !pickerUnsupported ? (
                    <ToolsetSkillPicker
                      profileBase={profileBase}
                      enabledToolsets={enabledToolsets}
                      onEnabledToolsetsChange={(next) => {
                        setEnabledToolsets(next);
                        setPickerDirty(true);
                      }}
                      disabledSkills={disabledSkills}
                      onDisabledSkillsChange={(next) => {
                        setDisabledSkills(next);
                        setPickerDirty(true);
                      }}
                      onLoaded={(initial) => {
                        setEnabledToolsets(initial.enabledToolsets);
                        setDisabledSkills(initial.disabledSkills);
                      }}
                      onUnsupported={() => setPickerUnsupported(true)}
                      canManageToolProviders={canManageProviderAuth}
                      disabled={configSaving}
                    />
                  ) : (
                    // 구버전 플러그인(< 0.9.0)은 목록을 주지 않는다 — 예전처럼 이름을 적는다.
                    <>
                      <input
                        type="text"
                        value={toolsetsText}
                        onChange={(e) => setToolsetsText(e.target.value)}
                        placeholder={t("hermes.wizard.config.toolsets")}
                        className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:border-indigo-500"
                      />
                      <p className="text-xs text-text-muted">
                        {t("hermes.wizard.config.toolsetsHint")}
                      </p>
                    </>
                  )}
                </div>
              </details>
              {configSaved && (
                <p className="text-xs text-success">{t("hermes.wizard.config.saved")}</p>
              )}
              {/* 출근 결과 한 줄 — 붙은 채널이 없으면 "출근했다" 고 말하지 않는다. 이어서
                  편집하는 기존 직원(`attendedChannels` 없음)은 알 수 없으므로 말하지 않는다. */}
              {typeof created?.attendedChannels === "number" && (
                <p className="text-sm text-text-muted">
                  {created.attendedChannels === 0
                    ? t("hermes.wizard.result.noChannel", { name: created.name })
                    : t("hermes.wizard.result.attended", {
                        name: created.name,
                        count: String(created.attendedChannels),
                      })}
                </p>
              )}
              {created?.attendedChannels === 0 && (
                <Link
                  href={`/channels/create?gatewayId=${encodeURIComponent(gatewayId)}`}
                  className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
                >
                  {t("hermes.wizard.result.createOffice")}
                </Link>
              )}
              {/* 경고는 버튼 줄 밖에 둔다 — 같은 flex 줄에 넣으면 버튼이 눌려 글자가 세로로 꺾인다. */}
              {baseUrl && provider.trim() !== "custom" && (
                <div
                  className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
                  data-base-url-warning={baseUrl}
                >
                  <p className="text-text">
                    {t("hermes.wizard.config.baseUrlWarning", { url: baseUrl })}
                  </p>
                  <label className="flex items-start gap-2 text-text">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={clearBaseUrl}
                      onChange={(e) => setClearBaseUrl(e.target.checked)}
                    />
                    <span>{t("hermes.wizard.config.baseUrlClear")}</span>
                  </label>
                  <p className="text-text-muted">{t("hermes.wizard.config.baseUrlKeepHint")}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2" data-config-actions>
                <button
                  type="button"
                  disabled={configSaving}
                  onClick={() => void handleSaveConfig()}
                  className="shrink-0 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  {configSaving ? t("hermes.wizard.config.saving") : t("hermes.wizard.config.save")}
                </button>
                <button
                  type="button"
                  onClick={() => onDone(created ? { profileName: created.name } : undefined)}
                  className="shrink-0 whitespace-nowrap rounded bg-surface-raised px-4 py-2 text-sm font-semibold hover:bg-surface-raised/80"
                >
                  {t("hermes.wizard.finish")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 단계 이동은 아래 버튼으로 한다 — 잠긴 단계의 이유를 글로 늘어놓는 대신
          "다음" 을 눌러 자연스럽게 순서를 밟는다(2026-09-20 단테 결정). */}
      {!showCloseConfirm && (
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <button
            type="button"
            disabled={!previousStep(current, steps)}
            onClick={goBack}
            data-step-nav="back"
            className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-semibold hover:bg-surface-raised/80 disabled:opacity-40"
          >
            {t("hermes.wizard.back")}
          </button>
          <button
            type="button"
            disabled={!nextStep(current, steps)}
            onClick={goNext}
            data-step-nav="next"
            title={
              nextLockedReason(current, steps) ? t(nextLockedReason(current, steps)!) : undefined
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {t("hermes.wizard.next")}
          </button>
        </div>
      )}
    </div>
  );
}
