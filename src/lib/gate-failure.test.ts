import assert from "node:assert/strict";
import test from "node:test";

import { PLUGIN_INSTALL_COMMAND } from "@/lib/hermes/plugin-install-command";
import { classifyGateFailure, isSetupBlocker } from "./gate-failure";

test("서버 매핑 표를 그대로 옮긴다", () => {
  assert.deepEqual(classifyGateFailure({ status: 409, code: "gateway_not_bound" }), {
    kind: "gateway_not_bound",
  });
  assert.deepEqual(classifyGateFailure({ status: 404, code: "plugin_absent" }), {
    kind: "plugin_absent",
    command: PLUGIN_INSTALL_COMMAND,
  });
  assert.deepEqual(classifyGateFailure({ status: 401, code: "plugin_unauthorized" }), {
    kind: "plugin_unauthorized",
  });
  assert.deepEqual(classifyGateFailure({ status: 504, code: "timeout" }), { kind: "timeout" });
  assert.deepEqual(classifyGateFailure({ status: 503, code: "unreachable" }), {
    kind: "unreachable",
  });
  // plugin_unknown 은 사용자에게 unreachable 과 같은 뜻이다 — 단계로 나눌 정보가 없다.
  assert.deepEqual(classifyGateFailure({ status: 503, code: "plugin_unknown" }), {
    kind: "unreachable",
  });
});

test("업그레이드는 서버가 준 최소 버전을 쓰고, 없으면 기본값으로 떨어진다", () => {
  assert.deepEqual(
    classifyGateFailure({ status: 428, code: "plugin_upgrade_required", minVersion: "0.9.0" }),
    { kind: "plugin_upgrade_required", minVersion: "0.9.0", command: PLUGIN_INSTALL_COMMAND },
  );
  assert.deepEqual(classifyGateFailure({ status: 428, code: "plugin_upgrade_required" }), {
    kind: "plugin_upgrade_required",
    minVersion: "0.6.0",
    command: PLUGIN_INSTALL_COMMAND,
  });
});

test("코드가 먼저다 — 상태코드만으로 판정하지 않는다", () => {
  // 같은 503 이라도 코드가 다르면 다른 결과다.
  assert.equal(classifyGateFailure({ status: 503, code: "board_unavailable" }).kind, "other");
  // 표에 없는 코드는 상태코드와 함께 그대로 싣는다.
  assert.deepEqual(classifyGateFailure({ status: 500, code: "boom", message: "터졌다" }), {
    kind: "other",
    status: 500,
    code: "boom",
    message: "터졌다",
  });
  assert.deepEqual(classifyGateFailure({ status: 0, code: "unknown" }), {
    kind: "other",
    status: 0,
    code: "unknown",
    message: "",
  });
});

test("체크리스트를 그릴 값과 아닌 값을 가른다", () => {
  for (const failure of [
    { status: 409, code: "gateway_not_bound" },
    { status: 404, code: "plugin_absent" },
    { status: 401, code: "plugin_unauthorized" },
    { status: 428, code: "plugin_upgrade_required" },
  ]) {
    assert.equal(isSetupBlocker(classifyGateFailure(failure)), true, failure.code);
  }
  for (const failure of [
    { status: 503, code: "unreachable" },
    { status: 504, code: "timeout" },
    { status: 500, code: "boom" },
  ]) {
    assert.equal(isSetupBlocker(classifyGateFailure(failure)), false, failure.code);
  }
});
