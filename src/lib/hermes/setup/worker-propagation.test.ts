import test from "node:test";
import assert from "node:assert/strict";

import {
  inheritedWorkerPropagation,
  runWorkerPropagation,
  setupWorkerPluginApplies,
} from "./worker-propagation";

test("갱신은 링크가 남았는데 설정이 꺼진 게이트웨이만 켜 둔 채 이어받는다", () => {
  assert.equal(
    inheritedWorkerPropagation({ workerLinked: true, workerPropagation: "disabled" }),
    true,
  );
  // 이미 켜져 있으면 쓸 것이 없다. 링크가 없으면 운영자가 켠 적이 없다 — 기본 꺼짐을 지킨다.
  assert.equal(
    inheritedWorkerPropagation({ workerLinked: true, workerPropagation: "enabled" }),
    false,
  );
  assert.equal(
    inheritedWorkerPropagation({ workerLinked: false, workerPropagation: "disabled" }),
    false,
  );
  // 옛 헬퍼 응답처럼 모르면 건드리지 않는다.
  assert.equal(inheritedWorkerPropagation({}), false);
});

function deps(propagation: "enabled" | "disabled", ensureOk = true) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      setFlag: async (enabled: boolean) => {
        calls.push(`set:${enabled}`);
        return propagation;
      },
      ensure: async () => {
        calls.push("ensure");
        return ensureOk
          ? {
              ok: true as const,
              data: { results: [{ profile: "sophie", link: "created", enabled: "added" }] },
            }
          : { ok: false as const, status: 409, failure: { code: "worker_propagation_disabled" } };
      },
      refreshCache: async () => {
        calls.push("refresh");
      },
    },
  };
}

test("켜기는 플래그를 쓴 뒤 기존 적용을 부르고 캐시를 다시 채운다", async () => {
  const { calls, deps: d } = deps("enabled");
  const res = await runWorkerPropagation(true, d);
  assert.deepEqual(calls, ["set:true", "ensure", "refresh"]);
  assert.deepEqual(res, {
    propagation: "enabled",
    results: [{ profile: "sophie", link: "created", enabled: "added" }],
  });
});

test("적용이 실패해도 플래그 상태는 알리고 플러그인 코드를 그대로 싣는다", async () => {
  const { deps: d } = deps("enabled", false);
  assert.deepEqual(await runWorkerPropagation(true, d), {
    propagation: "enabled",
    errorCode: "worker_propagation_disabled",
  });
});

test("끄기는 적용을 부르지 않고 캐시만 다시 채운다 — 이미 있는 링크는 플러그인이 지우지 않는다", async () => {
  const { calls, deps: d } = deps("disabled");
  assert.deepEqual(await runWorkerPropagation(false, d), { propagation: "disabled" });
  assert.deepEqual(calls, ["set:false", "refresh"]);
});

test("캐시 갱신 실패는 결과를 가리지 않는다", async () => {
  const { deps: d } = deps("disabled");
  const res = await runWorkerPropagation(false, {
    ...d,
    refreshCache: async () => {
      throw new Error("probe failed");
    },
  });
  assert.deepEqual(res, { propagation: "disabled" });
});

test("마법사의 적용은 켜기를 골랐고 실제로 켜졌고 플러그인이 적용을 지원할 때만 돈다", () => {
  const info = { capabilities: ["kanban", "worker_plugin"] };
  assert.equal(setupWorkerPluginApplies(true, "enabled", info), true);
  assert.equal(setupWorkerPluginApplies(undefined, "enabled", info), false);
  assert.equal(setupWorkerPluginApplies(false, "enabled", info), false);
  assert.equal(setupWorkerPluginApplies(true, "disabled", info), false);
  assert.equal(setupWorkerPluginApplies(true, "enabled", { capabilities: ["kanban"] }), false);
  assert.equal(setupWorkerPluginApplies(true, "enabled", null), false);
});
