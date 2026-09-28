import assert from "node:assert/strict";
import test from "node:test";

import {
  $,
  cleanup,
  click,
  container,
  mockFetch,
  render,
  text,
} from "../skills/skills-test-harness";
import HermesProfileImport from "./HermesProfileImport";

const GW = "gw-1";
const LIST = `GET /api/gateways/${GW}/plugin/profiles/importable`;
const IMPORT = `POST /api/gateways/${GW}/plugin/profiles/vps-sam/import`;
const imported = {
  status: 201,
  json: { profile: { profileName: "vps-sam" }, attendedChannels: 1, rotated: false },
};

test.afterEach(cleanup);

test("lists the gateway's profiles that are not employees yet, with how the key is handled", async () => {
  mockFetch({ [LIST]: { profiles: [{ name: "vps-sam", description: "리서치 담당" }] } });
  await render(<HermesProfileImport gatewayId={GW} onImported={() => {}} />);
  assert.match(text(), /Hermes 에 있는 직원 가져오기/);
  assert.match(text(), /vps-sam/);
  assert.match(text(), /리서치 담당/);
  assert.ok($("[data-import-key-note]"), "says an existing key is only replaced after asking");
  assert.ok($("[data-import-key-details]"), "where the key is written lives under more details");
  assert.ok(!container.querySelector("[data-import-failure]"));
  assert.ok(!container.querySelector("[data-import-empty]"));
});

test("an empty list says there is nothing to import instead of vanishing", async () => {
  mockFetch({ [LIST]: { profiles: [] } });
  await render(<HermesProfileImport gatewayId={GW} onImported={() => {}} />);
  assert.ok($("[data-import-empty]"));
  assert.ok(!container.querySelector("[data-import-profile]"));
  assert.ok(!container.querySelector("[data-import-failure]"));
});

for (const [errorCode, kind] of [
  ["gateway_auth_failed", "owner-key"],
  ["plugin_update_required", "plugin"],
  ["malformed_response", "plugin"],
  ["unreachable", "offline"],
  ["timeout", "offline"],
  ["upstream_error", "other"],
] as const) {
  test(`a failed list (${errorCode}) explains why and offers a reload`, async () => {
    const routes: Record<string, unknown> = { [LIST]: { errorCode, error: errorCode } };
    const log = mockFetch(routes as never);
    await render(<HermesProfileImport gatewayId={GW} onImported={() => {}} />);
    assert.equal($("[data-import-failure]")?.getAttribute("data-import-failure"), kind);
    assert.equal($("[data-import-failure-code]")?.textContent?.includes(errorCode), true);
    assert.ok(!container.querySelector("[data-import-empty]"));

    routes[LIST] = { profiles: [{ name: "vps-sam", description: "" }] };
    await click("[data-import-reload]");
    assert.equal(log.calls.filter((c) => c === LIST).length, 2);
    assert.ok(!container.querySelector("[data-import-failure]"));
    assert.ok($("[data-import-profile=vps-sam]"));
  });
}

test("a list request that never reaches the server is explained too", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;
  await render(<HermesProfileImport gatewayId={GW} onImported={() => {}} />);
  assert.equal($("[data-import-failure]")?.getAttribute("data-import-failure"), "other");
});

test("importing reports the new employee, points at its settings, and refreshes the list", async () => {
  const log = mockFetch({
    [LIST]: { profiles: [{ name: "vps-sam", description: "" }] },
    [IMPORT]: imported,
  });
  let refreshed = 0;
  await render(<HermesProfileImport gatewayId={GW} onImported={() => (refreshed += 1)} />);
  await click("[data-import-profile=vps-sam]");
  assert.deepEqual(log.bodies[IMPORT], {});
  assert.equal(refreshed, 1);
  assert.match(text(), /vps-sam.*가져왔습니다/);
  assert.ok(container.querySelector(`a[href*="vps-sam"]`), "a link to the new employee's settings");
});

test("a profile that already has a key asks before replacing it, then imports with rotate", async () => {
  const routes: Record<string, unknown> = {
    [LIST]: { profiles: [{ name: "vps-sam", description: "" }] },
    [IMPORT]: { status: 200, json: { errorCode: "key_exists", error: "key_exists" } },
  };
  const log = mockFetch(routes as never);
  await render(<HermesProfileImport gatewayId={GW} onImported={() => {}} />);
  await click("[data-import-profile=vps-sam]");
  assert.match(text(), /이미 API 키가 있습니다/);
  assert.ok($("[data-import-rotate=vps-sam]"));

  routes[IMPORT] = imported;
  await click("[data-import-rotate=vps-sam]");
  assert.deepEqual(log.bodies[IMPORT], { rotate: true });
  assert.match(text(), /가져왔습니다/);
});

test("an older plugin points at manual registration instead", async () => {
  mockFetch({
    [LIST]: { profiles: [{ name: "vps-sam", description: "" }] },
    [IMPORT]: {
      status: 428,
      json: { errorCode: "plugin_update_required", error: "plugin_update_required" },
    },
  });
  await render(<HermesProfileImport gatewayId={GW} onImported={() => {}} />);
  await click("[data-import-profile=vps-sam]");
  assert.match(text(), /플러그인을 업데이트해야 합니다/);
  assert.ok(!container.querySelector("[data-import-rotate]"));
});
