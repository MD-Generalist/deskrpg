/**
 * "이 게이트웨이에 깔린 플러그인이 앱이 요구하는 버전인가" 를 화면 문구로 옮기기 전의 판정.
 *
 * 앱은 핀(`setup/pin.ts` 의 `PLUGIN_VERSION`)으로 플러그인을 설치하는데, 정작 **지금 깔린
 * 버전이 무엇인지 화면 어디에도 없었다**(2026-09-21 실측: 진단 화면조차 `plugin_ready` 만
 * 말해서, 버전을 보려면 `automation/status` API 를 직접 읽어야 했다).
 *
 * 순수 함수다 — 클라이언트 번들에 실리므로 `node:*`·`@/db` 를 import 하지 않는다.
 */
import { compareSemver } from "@/lib/hermes/plugin-capability";
import { PLUGIN_VERSION } from "@/lib/hermes/setup/pin";

export type PluginVersionState = "unknown" | "current" | "outdated" | "ahead";

export type PluginVersionView = {
  state: PluginVersionState;
  /** 캐시가 말하는 설치본. 모르면 null 이다 — 화면이 "확인되지 않음" 을 그린다. */
  installed: string | null;
  /** 이 앱이 설치하는 버전. */
  pinned: string;
};

export function describePluginVersion(input: {
  installed: string | null | undefined;
  pluginStatus: string | null | undefined;
}): PluginVersionView {
  const installed = (input.installed ?? "").trim() || null;
  const pinned = PLUGIN_VERSION;

  // 플러그인이 준비 상태가 아닐 때의 버전은 판정 재료가 아니다 — 404·401 로 막힌
  // 게이트웨이에 "뒤처짐" 이라고 말하면 사용자가 고칠 곳을 잘못 짚는다.
  if (input.pluginStatus !== "plugin_ready" || !installed) {
    return { state: "unknown", installed, pinned };
  }

  const order = compareSemver(installed, pinned);
  if (order === null) return { state: "unknown", installed, pinned };
  if (order < 0) return { state: "outdated", installed, pinned };
  if (order > 0) return { state: "ahead", installed, pinned };
  return { state: "current", installed, pinned };
}
