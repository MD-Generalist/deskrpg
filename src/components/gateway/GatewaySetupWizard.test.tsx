import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../lib/i18n/context";
import GatewaySetupWizard from "./GatewaySetupWizard";

const capabilities = {
  local: true,
  ssh: true,
  hostLabel: "server",
  sshHosts: [{ id: "approved", label: "Approved server" }],
};
const candidate = {
  id: "candidate",
  label: "Hermes test",
  version: "1",
  service: "hermes-gateway",
  pluginInstalled: false,
  pluginEnabled: false,
  port: 8642,
  hasToken: false,
};
async function fixture(handler: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <GatewaySetupWizard onConnected={() => {}} />
      </I18nProvider>,
    ),
  );
  const click = async (label: string) => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === label,
    );
    assert.ok(button, label);
    await act(async () => button.click());
  };
  return {
    host,
    click,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
      globalThis.fetch = original;
    },
  };
}
const response = (data: unknown) => new Response(JSON.stringify(data));
test("first choice is local/remote and remote reveals SSH/URL without discovery", async () => {
  const actions: unknown[] = [];
  const f = await fixture(async (_url, init) => {
    if (init?.body) actions.push(init.body);
    return response(capabilities);
  });
  try {
    assert.match(f.host.textContent!, /로컬 연결/);
    assert.match(f.host.textContent!, /원격 연결/);
    assert.doesNotMatch(f.host.textContent!, /API 인증 키/);
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("원격 연결"))!
        .click(),
    );
    assert.match(f.host.textContent!, /SSH로 연결/);
    assert.match(f.host.textContent!, /게이트웨이 주소로 연결/);
    assert.equal(actions.length, 0);
  } finally {
    await f.cleanup();
  }
});
test("unavailable local is disabled and explains server-host boundary", async () => {
  const f = await fixture(async () => response({ ...capabilities, local: false }));
  try {
    assert.equal(
      Array.from(f.host.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("로컬 연결"),
      )!.disabled,
      true,
    );
    assert.match(f.host.textContent!, /DeskRPG 서버/);
  } finally {
    await f.cleanup();
  }
});
test("late discovery cannot change a newer screen", async () => {
  let finish!: (value: Response) => void;
  const f = await fixture(async (_url, init) =>
    init?.body
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : response(capabilities),
  );
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("뒤로");
    await act(async () => finish(response({ candidates: [candidate] })));
    assert.doesNotMatch(f.host.textContent!, /Hermes test/);
  } finally {
    await f.cleanup();
  }
});
test("review requires explicit preparation; failed jobs show safe error and retry discovery", async () => {
  const actions: string[] = [];
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const { action } = JSON.parse(String(init.body));
    actions.push(action);
    if (action === "discover") return response({ candidates: [candidate] });
    if (action === "inspect")
      return response({
        candidate,
        pluginStatus: "plugin_absent",
        changes: ["installing_plugin", "restarting_gateway"],
      });
    return response({
      job: { id: "j", status: "failed", steps: ["installing_plugin"], error: "secret raw output" },
    });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    assert.deepEqual(actions, ["discover", "inspect"]);
    assert.match(f.host.textContent!, /hermes-gateway/);
    await f.click("설치 및 연결");
    assert.match(f.host.textContent!, /연결을 완료하지 못했습니다/);
    assert.doesNotMatch(f.host.textContent!, /secret raw output/);
    await f.click("다시 확인");
    assert.equal(actions.at(-1), "discover");
  } finally {
    await f.cleanup();
  }
});

test("URL success with absent plugin offers installation and never claims ready", async () => {
  const f = await fixture(async (_url, init) =>
    init?.body
      ? response({ gatewayId: "g", pluginStatus: "plugin_absent" })
      : response(capabilities),
  );
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("원격 연결"))!
        .click(),
    );
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("게이트웨이 주소로 연결"))!
        .click(),
    );
    await act(async () =>
      f.host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    assert.match(f.host.textContent!, /API 연결은 저장되었지만/);
    assert.match(f.host.textContent!, /SSH로 설치하기/);
    assert.doesNotMatch(f.host.textContent!, /게이트웨이가 연결되었습니다/);
    assert.equal(f.host.querySelector('a[href^="/profiles"]'), null);
  } finally {
    await f.cleanup();
  }
});

test("URL unauthorized stays in credentials form without missing-plugin claim", async () => {
  const f = await fixture(async (_url, init) =>
    init?.body
      ? new Response(
          JSON.stringify({ errorCode: "gateway_unauthorized", error: "private details" }),
          { status: 401 },
        )
      : response(capabilities),
  );
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("원격 연결"))!
        .click(),
    );
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("게이트웨이 주소로 연결"))!
        .click(),
    );
    await act(async () =>
      f.host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    assert.match(f.host.querySelector('[role="alert"]')!.textContent!, /인증 키를 확인하세요/);
    assert.ok(f.host.querySelector('input[type="password"]'));
    assert.doesNotMatch(f.host.textContent!, /private details|API 연결은 저장되었지만/);
  } finally {
    await f.cleanup();
  }
});

test("running jobs poll to verified success and expose gateway-scoped profiles", async () => {
  const f = await fixture(async (url, init) => {
    if (String(url).includes("?job="))
      return response({
        job: { id: "j", status: "succeeded", steps: ["verifying_gateway"], gatewayId: "gateway a" },
      });
    if (!init?.body) return response(capabilities);
    const { action } = JSON.parse(String(init.body));
    if (action === "discover") return response({ candidates: [candidate] });
    if (action === "inspect")
      return response({ candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] });
    return response({ job: { id: "j", status: "running", steps: ["installing_plugin"] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    await f.click("설치 및 연결");
    assert.match(f.host.textContent!, /게이트웨이 준비 중/);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
    assert.equal(
      f.host.querySelector('a[href^="/profiles"]')?.getAttribute("href"),
      "/profiles?gateway=gateway%20a",
    );
  } finally {
    await f.cleanup();
  }
});

test("cancel targets the current job and permits a fresh discovery", async () => {
  const actions: Record<string, string>[] = [];
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    actions.push(body);
    if (body.action === "discover") return response({ candidates: [candidate] });
    if (body.action === "inspect")
      return response({ candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] });
    return response({
      job: { id: "j", status: body.action === "cancel" ? "cancelled" : "running", steps: [] },
    });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    await f.click("설치 및 연결");
    await f.click("취소");
    assert.deepEqual(actions.at(-1), { action: "cancel", jobId: "j" });
    assert.match(f.host.textContent!, /설정 작업을 중단했습니다/);
    await f.click("다시 확인");
    assert.equal(actions.at(-1)?.action, "discover");
  } finally {
    await f.cleanup();
  }
});

for (const warning of [
  "multiplex_conflict",
  "external_secret_provider",
  "port_conflict",
  "service_identity_ambiguous",
]) {
  test(`review blocks preparation for ${warning} and explains remediation`, async () => {
    let prepares = 0;
    const f = await fixture(async (_url, init) => {
      if (!init?.body) return response(capabilities);
      const { action } = JSON.parse(String(init.body));
      if (action === "discover") return response({ candidates: [candidate] });
      if (action === "inspect")
        return response({
          candidate: { ...candidate, warning },
          pluginStatus: "unknown",
          changes: ["installing_plugin"],
        });
      prepares++;
      return response({});
    });
    try {
      await act(async () =>
        Array.from(f.host.querySelectorAll("button"))
          .find((b) => b.textContent?.includes("로컬 연결"))!
          .click(),
      );
      await f.click("연결하기");
      const prepare = Array.from(f.host.querySelectorAll("button")).find(
        (b) => b.textContent === "설치 및 연결",
      )!;
      assert.equal(prepare.disabled, true);
      assert.match(f.host.querySelector('[role="alert"]')!.textContent!, /관리자|비밀 관리자/);
      assert.doesNotMatch(
        f.host.querySelector('[role="alert"]')!.textContent!,
        new RegExp(warning),
      );
      await act(async () => prepare.click());
      assert.equal(prepares, 0);
    } finally {
      await f.cleanup();
    }
  });
}

test("an unreachable stopped gateway remains eligible for explicit preparation", async () => {
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const { action } = JSON.parse(String(init.body));
    if (action === "discover") return response({ candidates: [candidate] });
    return response({
      candidate: { ...candidate, warning: "gateway_unreachable" },
      pluginStatus: "unknown",
      changes: ["restarting_gateway"],
    });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    assert.equal(
      Array.from(f.host.querySelectorAll("button")).find((b) => b.textContent === "설치 및 연결")!
        .disabled,
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("review defaults credentialed profiles on and sends only checked profiles", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    if (body.action === "discover") return response({ candidates: [candidate] });
    if (body.action === "inspect")
      return response({
        candidate,
        pluginStatus: "plugin_absent",
        changes: ["installing_plugin"],
        profiles: [
          { name: "sophie", hasToken: true },
          { name: "alex", hasToken: true },
          { name: "needs-key", hasToken: false },
        ],
      });
    prepared = body;
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    const boxes = Array.from(f.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    assert.equal(boxes.length, 3);
    assert.deepEqual(
      boxes.map((box) => [box.checked, box.disabled]),
      [
        [true, false],
        [true, false],
        [false, true],
      ],
    );
    assert.match(f.host.textContent!, /API 인증 키를 먼저 설정/);
    assert.match(f.host.textContent!, /선택한 프로필: 2/);
    await act(async () => boxes[1].click());
    assert.match(f.host.textContent!, /선택한 프로필: 1/);
    await f.click("설치 및 연결");
    assert.deepEqual(prepared?.profiles, ["sophie"]);
  } finally {
    await f.cleanup();
  }
});

test("empty profile selection explicitly explains later registration and sends an empty list", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    if (body.action === "discover") return response({ candidates: [candidate] });
    if (body.action === "inspect")
      return response({
        candidate,
        pluginStatus: "plugin_absent",
        changes: ["installing_plugin"],
        profiles: [{ name: "sophie", hasToken: true }],
      });
    prepared = body;
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    await act(async () =>
      f.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    assert.match(f.host.textContent!, /프로필은 연결 후 별도로 등록/);
    await f.click("설치 및 연결");
    assert.deepEqual(prepared?.profiles, []);
    assert.match(f.host.textContent!, /현재 작업이 안전하게 끝난 뒤 다음 단계를 중단/);
  } finally {
    await f.cleanup();
  }
});

test("fresh owner eligible for credential provisioning is selected and posted", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    if (body.action === "discover") return response({ candidates: [candidate] });
    if (body.action === "inspect")
      return response({
        candidate,
        pluginStatus: "plugin_absent",
        changes: ["configuring_api"],
        profiles: [
          { name: "fresh-owner", hasToken: false, canProvision: true },
          { name: "other", hasToken: false },
        ],
      });
    prepared = body;
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    const boxes = Array.from(f.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    assert.deepEqual(
      boxes.map((box) => [box.checked, box.disabled]),
      [
        [true, false],
        [false, true],
      ],
    );
    assert.match(f.host.textContent!, /연결 중 인증 키를 생성합니다/);
    assert.match(f.host.textContent!, /API 인증 키를 먼저 설정/);
    await f.click("설치 및 연결");
    assert.deepEqual(prepared?.profiles, ["fresh-owner"]);
  } finally {
    await f.cleanup();
  }
});
