import assert from "node:assert/strict";
import test from "node:test";

import type { PluginInfo } from "./deskrpg-plugin-types";
import {
  KANBAN_VIEWS_MIN_VERSION,
  kanbanViewsGate,
  supportsKanbanViews,
} from "./plugin-capability";

function info(capabilities: string[], version = "0.11.0"): PluginInfo {
  return {
    plugin: "deskrpg",
    version,
    routes: [],
    capabilities,
    timezone: null,
    kanban: { dispatcher_present: true, attachments: true },
  } as PluginInfo;
}

test("capability 가 가용성의 정본이다 — 버전을 보지 않는다", () => {
  // 버전으로 판단하면 "0.11.0 인데 404" 라는 진단 불가능한 상태가 생긴다.
  assert.equal(supportsKanbanViews(info(["kanban", "kanban_views"], "0.9.0")), true);
  assert.equal(supportsKanbanViews(info(["kanban"], "9.9.9")), false);
});

test("info 가 없으면 no_info, capability 만 없으면 missing_capability", () => {
  assert.deepEqual(kanbanViewsGate(null), {
    ok: false,
    minVersion: KANBAN_VIEWS_MIN_VERSION,
    reason: "no_info",
    missing: ["kanban_views"],
  });
  assert.deepEqual(kanbanViewsGate(info(["kanban"])), {
    ok: false,
    minVersion: KANBAN_VIEWS_MIN_VERSION,
    reason: "missing_capability",
    missing: ["kanban_views"],
  });
});

test("있으면 통과한다", () => {
  assert.deepEqual(kanbanViewsGate(info(["kanban", "kanban_views"])), { ok: true });
});

test("자동화 최소 버전과 따로 둔다 — 없다고 칸반이 통째로 잠기지 않는다", async () => {
  const { AUTOMATION_MIN_VERSION, meetsAutomationContract } = await import("./plugin-capability");
  const withoutViews = info(["kanban", "cron", "events"], AUTOMATION_MIN_VERSION);
  assert.equal(meetsAutomationContract(withoutViews).ok, true, "칸반은 계속 돌아야 한다");
  assert.equal(supportsKanbanViews(withoutViews), false);
});
