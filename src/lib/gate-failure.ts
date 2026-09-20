import { PLUGIN_INSTALL_COMMAND } from "@/lib/hermes/plugin-install-command";

/**
 * 게이트 실패를 화면 분기로 옮긴다.
 *
 * **판정하지 않는다.** 판정은 서버의 `automation-gate.ts` 하나이고, 그 결과를
 * `cron-access.ts` 의 `pluginGateResponse` 가 상태코드+코드로 옮긴다. 이 파일은 그 표를
 * 화면 쪽 이름으로 번역할 뿐이다 — 새 분기를 여기서 만들면 판정이 두 곳이 된다.
 *
 * 클라이언트 번들에 실린다: `node:*`·`@/db` 를 import 하지 않는다.
 */
export const GATE_FALLBACK_MIN_VERSION = "0.6.0";

export type GateBlocker =
  | { kind: "gateway_not_bound" }
  | { kind: "plugin_absent"; command: string }
  | { kind: "plugin_unauthorized" }
  | { kind: "plugin_upgrade_required"; minVersion: string; command: string }
  | { kind: "unreachable" }
  | { kind: "timeout" }
  | { kind: "other"; status: number; code: string; message: string };

export type GateFailure = {
  status: number;
  code: string;
  message?: string;
  minVersion?: string;
};

export function classifyGateFailure(failure: GateFailure): GateBlocker {
  switch (failure.code) {
    case "gateway_not_bound":
      return { kind: "gateway_not_bound" };
    case "plugin_absent":
      return { kind: "plugin_absent", command: PLUGIN_INSTALL_COMMAND };
    case "plugin_unauthorized":
      return { kind: "plugin_unauthorized" };
    case "plugin_upgrade_required":
      return {
        kind: "plugin_upgrade_required",
        minVersion: failure.minVersion || GATE_FALLBACK_MIN_VERSION,
        command: PLUGIN_INSTALL_COMMAND,
      };
    case "timeout":
      return { kind: "timeout" };
    case "unreachable":
    // 프로브가 왜 실패했는지 모르는 경우다. 사용자가 할 수 있는 일은 unreachable 과 같다.
    case "plugin_unknown":
      return { kind: "unreachable" };
    default:
      return {
        kind: "other",
        status: failure.status,
        code: failure.code,
        message: failure.message ?? "",
      };
  }
}

/** 체크리스트로 그릴 값인가 — 연결·서버 상태 문제는 단계로 표현하면 거짓말이 된다. */
export function isSetupBlocker(blocker: GateBlocker): boolean {
  return (
    blocker.kind === "gateway_not_bound" ||
    blocker.kind === "plugin_absent" ||
    blocker.kind === "plugin_unauthorized" ||
    blocker.kind === "plugin_upgrade_required"
  );
}
