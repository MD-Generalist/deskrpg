import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../lib/i18n/context";
import GatewaySetupWizard from "./GatewaySetupWizard";
import { PLUGIN_PIN_SHORT, PLUGIN_VERSION } from "../../lib/hermes/setup/pin";
import type { SetupCandidate } from "../../lib/hermes/setup/types";

const capabilities = {
  local: true,
  ssh: true,
  hostLabel: "server",
  sshHosts: [{ id: "approved", label: "Approved server" }],
};
const candidate: SetupCandidate = {
  id: "candidate",
  label: "Hermes test",
  version: "1",
  service: "hermes-gateway",
  pluginInstalled: false,
  pluginEnabled: false,
  pluginVersion: null as string | null,
  port: 8642,
  hasToken: false,
  // 시간대가 이미 있는 호스트가 기본값이다 — 시간대 제안은 비어 있을 때만 나온다.
  timezone: "Asia/Seoul" as string | null,
};
async function fixture(
  handler: typeof fetch,
  props: { onSaved?: (gatewayId: string) => void } = {},
) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <GatewaySetupWizard onConnected={() => {}} onSaved={props.onSaved} />
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

test("URL 연결이 저장되면 플러그인이 없어도 onSaved 로 알린다 — 목록이 비어 보이면 사용자가 다시 등록한다", async () => {
  const saved: string[] = [];
  const f = await fixture(
    async (_url, init) =>
      init?.body
        ? response({ gatewayId: "gw-saved", pluginStatus: "plugin_absent" })
        : response(capabilities),
    { onSaved: (gatewayId) => saved.push(gatewayId) },
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
    assert.deepEqual(saved, ["gw-saved"]);
    // 안내는 그대로 남는다 — 저장 알림이 화면을 게이트웨이 상세로 넘기지 않는다.
    assert.match(f.host.textContent!, /API 연결은 저장되었지만/);
  } finally {
    await f.cleanup();
  }
});

test("URL 인증 실패는 저장되지 않았으므로 onSaved 를 부르지 않는다", async () => {
  const saved: string[] = [];
  const f = await fixture(
    async (_url, init) =>
      init?.body
        ? new Response(JSON.stringify({ errorCode: "gateway_unauthorized" }), { status: 401 })
        : response(capabilities),
    { onSaved: (gatewayId) => saved.push(gatewayId) },
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
    assert.deepEqual(saved, []);
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
    const boxes = Array.from(f.host.querySelectorAll<HTMLInputElement>('input[name="profile"]'));
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

const freshHost: SetupCandidate = { ...candidate, timezone: null };
async function reachReview(
  inspection: Record<string, unknown>,
  capture?: (body: Record<string, unknown>) => void,
  target = freshHost,
) {
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    if (body.action === "discover") return response({ candidates: [target] });
    if (body.action === "inspect") return response({ candidate: target, ...inspection });
    capture?.(body);
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  await act(async () =>
    Array.from(f.host.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("로컬 연결"))!
      .click(),
  );
  await f.click("연결하기");
  return f;
}

test("시간대가 비어 있는 호스트에만 브라우저 시간대를 제안하고 동의하면 prepare 에 싣는다", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await reachReview(
    { pluginStatus: "plugin_absent", changes: ["installing_plugin"] },
    (body) => {
      prepared = body;
    },
  );
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.match(f.host.textContent!, new RegExp(`게이트웨이 시간대를 ${zone} 으로 설정합니다`));
    assert.match(f.host.textContent!, /이 브라우저의 시간대를 게이트웨이에 넣기/);
    await f.click("설치 및 연결");
    assert.equal(prepared?.timezone, zone);
  } finally {
    await f.cleanup();
  }
});

test("시간대 동의를 끄면 prepare 본문에 timezone 을 넣지 않는다", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await reachReview(
    { pluginStatus: "plugin_absent", changes: [], profiles: [] },
    (body) => {
      prepared = body;
    },
  );
  try {
    const boxes = Array.from(f.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].checked, true, "기본은 켬이다");
    await act(async () => boxes[0].click());
    await f.click("설치 및 연결");
    assert.equal("timezone" in (prepared ?? {}), false);
  } finally {
    await f.cleanup();
  }
});

test("이미 시간대가 있는 호스트에는 시간대 항목을 보여주지 않는다", async () => {
  const f = await reachReview(
    { pluginStatus: "plugin_absent", changes: ["installing_plugin"] },
    undefined,
    candidate,
  );
  try {
    assert.doesNotMatch(f.host.textContent!, /이 브라우저의 시간대를 게이트웨이에 넣기/);
  } finally {
    await f.cleanup();
  }
});

test("브라우저가 시간대를 알려주지 못하면 시간대 항목 자체가 없다", async () => {
  const original = Intl.DateTimeFormat;
  // 일부 브라우저·잠긴 환경은 빈 시간대를 돌려준다 — 그때는 제안하지 않는다.
  Object.defineProperty(Intl, "DateTimeFormat", {
    configurable: true,
    writable: true,
    value: Object.assign(() => ({ resolvedOptions: () => ({ timeZone: "" }) }), original),
  });
  try {
    const f = await reachReview({ pluginStatus: "plugin_absent", changes: ["installing_plugin"] });
    try {
      assert.doesNotMatch(f.host.textContent!, /이 브라우저의 시간대를 게이트웨이에 넣기/);
      assert.doesNotMatch(f.host.textContent!, /시간대를 .* 으로 설정합니다/);
    } finally {
      await f.cleanup();
    }
  } finally {
    Object.defineProperty(Intl, "DateTimeFormat", {
      configurable: true,
      writable: true,
      value: original,
    });
  }
});

test("서비스 등록과 플러그인 갱신 변경을 결과가 보이는 한국어로 설명한다", async () => {
  const f = await reachReview({
    pluginStatus: "plugin_ready",
    changes: ["installing_service", "updating_plugin"],
  });
  try {
    assert.match(f.host.textContent!, /재부팅 후에도 계속 살아 있게 합니다/);
    assert.match(
      f.host.textContent!,
      new RegExp(`DeskRPG 플러그인을 ${PLUGIN_VERSION.replace(/\./g, "\\.")} 으로 올립니다`),
    );
    assert.doesNotMatch(f.host.textContent!, /installing_service|updating_plugin/);
  } finally {
    await f.cleanup();
  }
});

test("플러그인 버전이 있으면 후보 목록과 검토 화면이 커밋과 함께 보여준다", async () => {
  const f = await reachReview({ pluginStatus: "plugin_ready", changes: [] }, undefined, {
    ...candidate,
    pluginInstalled: true,
    pluginVersion: "0.5.2",
  });
  try {
    assert.match(f.host.textContent!, /플러그인 버전: 0\.5\.2/);
    assert.match(
      f.host.textContent!,
      new RegExp(
        `플러그인 고정 버전: ${PLUGIN_PIN_SHORT} \\(${PLUGIN_VERSION.replace(/\./g, "\\.")}\\)`,
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("새 잡 단계는 한국어 라벨로 나오고 원시 코드가 새지 않는다", async () => {
  const f = await fixture(async (url, init) => {
    if (String(url).includes("?job="))
      return response({
        job: {
          id: "j",
          status: "running",
          steps: ["installing_service", "updating_plugin", "setting_timezone"],
        },
      });
    if (!init?.body) return response(capabilities);
    const { action } = JSON.parse(String(init.body));
    if (action === "discover") return response({ candidates: [candidate] });
    if (action === "inspect")
      return response({ candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] });
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    await f.click("설치 및 연결");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
    assert.match(f.host.textContent!, /게이트웨이 서비스 등록/);
    assert.match(f.host.textContent!, /DeskRPG 플러그인 갱신/);
    assert.match(f.host.textContent!, /게이트웨이 시간대 설정/);
    assert.doesNotMatch(f.host.textContent!, /setting_timezone/);
  } finally {
    await f.cleanup();
  }
});

for (const [code, expected] of [
  ["hermes_version_unsupported", /0\.21\.1 이상이 필요합니다[\s\S]*hermes update/],
  ["plugin_update_failed", /갱신하지 못했습니다[\s\S]*권한을 확인/],
  ["service_install_failed", /서비스로 등록하지 못했습니다[\s\S]*hermes gateway install/],
  ["timezone_invalid", /IANA 형식이 아닙니다[\s\S]*Asia\/Seoul/],
  ["timezone_write_failed", /시간대를 쓰지 못했습니다[\s\S]*쓰기 권한/],
] as const) {
  test(`실패한 잡의 ${code} 는 원인과 다음 행동을 담은 안내로 바뀐다`, async () => {
    const f = await fixture(async (_url, init) => {
      if (!init?.body) return response(capabilities);
      const { action } = JSON.parse(String(init.body));
      if (action === "discover") return response({ candidates: [candidate] });
      if (action === "inspect")
        return response({
          candidate,
          pluginStatus: "plugin_absent",
          changes: ["installing_plugin"],
        });
      return response({ job: { id: "j", status: "failed", steps: [], error: code } });
    });
    try {
      await act(async () =>
        Array.from(f.host.querySelectorAll("button"))
          .find((b) => b.textContent?.includes("로컬 연결"))!
          .click(),
      );
      await f.click("연결하기");
      await f.click("설치 및 연결");
      const alerts = Array.from(f.host.querySelectorAll('[role="alert"]'))
        .map((node) => node.textContent ?? "")
        .join("\n");
      assert.match(alerts, expected);
      assert.doesNotMatch(alerts, new RegExp(code));
    } finally {
      await f.cleanup();
    }
  });
}

// ── 계약 2: 프로필 생성·키 발급, 로컬 Hermes 설치 ─────────────────────────────

function typeInto(node: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

async function reachEmptyDiscovery(
  caps: Record<string, unknown>,
  sent?: string[],
  bodies?: Record<string, unknown>[],
) {
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response({ ...capabilities, ...caps });
    const body = JSON.parse(String(init.body));
    const { action } = body;
    sent?.push(action);
    bodies?.push(body);
    if (action === "discover") return response({ candidates: [] });
    return response({ job: { id: "j", status: "running", steps: ["installing_hermes"] } });
  });
  await act(async () =>
    Array.from(f.host.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("로컬 연결"))!
      .click(),
  );
  return f;
}

test("설치 게이트가 꺼져 있으면 설치 제안 대신 켜는 명령을 보여준다", async () => {
  const f = await reachEmptyDiscovery({ canInstallHermes: false });
  try {
    // 설정 파일을 손으로 고치라고 하지 않는다 — 붙여넣을 명령을 그대로 보여준다.
    assert.match(f.host.textContent!, /deskrpg host-setup on --with-install/);
    assert.doesNotMatch(f.host.textContent!, /이 서버에 Hermes 를 설치할까요\?/);
    assert.equal(f.host.querySelector('input[name="install-consent"]'), null);
  } finally {
    await f.cleanup();
  }
});

test("설치 게이트가 켜지면 동의 체크박스가 기본 꺼짐으로 나온다", async () => {
  const f = await reachEmptyDiscovery({ canInstallHermes: true });
  try {
    assert.match(f.host.textContent!, /이 서버에 Hermes 를 설치할까요\?/);
    const consent = f.host.querySelector<HTMLInputElement>('input[name="install-consent"]')!;
    assert.equal(consent.checked, false, "시간대 제안과 달리 기본은 꺼짐이다");
    assert.match(f.host.textContent!, /hermes model/);
  } finally {
    await f.cleanup();
  }
});

test("동의하지 않으면 설치가 시작되지 않고, 동의해야 설치 요청이 나간다", async () => {
  const sent: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const f = await reachEmptyDiscovery({ canInstallHermes: true }, sent, bodies);
  try {
    const start = Array.from(f.host.querySelectorAll("button")).find(
      (b) => b.textContent === "Hermes 설치 시작",
    )!;
    assert.equal(start.disabled, true);
    await act(async () => start.click());
    assert.deepEqual(sent, ["discover"]);
    await act(async () =>
      f.host.querySelector<HTMLInputElement>('input[name="install-consent"]')!.click(),
    );
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent === "Hermes 설치 시작")!
        .click(),
    );
    // 라우트가 아는 액션이어야 한다. 예전에는 install-hermes 를 보내 setup_invalid_request 로
    // 떨어졌고, 그래서 설치 버튼이 아무 일도 하지 않았다(실측).
    assert.equal(sent.at(-1), "prepare");
    assert.equal(bodies.at(-1)?.installHermes, true);
    assert.match(f.host.textContent!, /Hermes 설치/);
  } finally {
    await f.cleanup();
  }
});

test("설치 스크립트 지문이 오면 감사용으로 화면에 남는다", async () => {
  const digest = "a".repeat(64);
  const f = await fixture(async (url, init) => {
    if (String(url).includes("?job="))
      return response({
        job: { id: "j", status: "running", steps: ["installing_hermes"], installerDigest: digest },
      });
    if (!init?.body) return response({ ...capabilities, canInstallHermes: true });
    const { action } = JSON.parse(String(init.body));
    if (action === "discover") return response({ candidates: [] });
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await act(async () =>
      f.host.querySelector<HTMLInputElement>('input[name="install-consent"]')!.click(),
    );
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent === "Hermes 설치 시작")!
        .click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
    assert.match(f.host.textContent!, new RegExp(`설치 스크립트 지문 ${digest}`));
  } finally {
    await f.cleanup();
  }
});

const provisionInspection = {
  pluginStatus: "plugin_absent",
  changes: ["installing_plugin"],
  profiles: [
    { name: "sophie", hasToken: true },
    { name: "keyless", hasToken: false, canProvision: true },
  ],
};

test("키 발급 체크는 가져오기와 따로 움직이고 prepare 본문의 provisionKeys 로 나간다", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await reachReview(
    provisionInspection,
    (body) => {
      prepared = body;
    },
    candidate,
  );
  try {
    const provision = Array.from(
      f.host.querySelectorAll<HTMLInputElement>('input[name="provision"]'),
    );
    assert.equal(provision.length, 1, "키가 없는 프로필에만 붙는다");
    assert.equal(provision[0].checked, false, "키 발급은 명시적으로 켜야 한다");
    assert.match(f.host.textContent!, /인증 키가 없는 프로필에만 켤 수 있습니다/);
    await act(async () => provision[0].click());
    await f.click("설치 및 연결");
    assert.deepEqual(prepared?.provisionKeys, ["keyless"]);
    assert.deepEqual(prepared?.profiles, ["sophie", "keyless"]);
  } finally {
    await f.cleanup();
  }
});

test("키 발급을 켜지 않으면 prepare 본문에 provisionKeys 자체가 없다", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await reachReview(
    provisionInspection,
    (body) => {
      prepared = body;
    },
    candidate,
  );
  try {
    await f.click("설치 및 연결");
    assert.equal("provisionKeys" in (prepared ?? {}), false);
  } finally {
    await f.cleanup();
  }
});

test("프로필 이름이 비어 있으면 createProfile 을 보내지 않는다", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await reachReview(
    provisionInspection,
    (body) => {
      prepared = body;
    },
    candidate,
  );
  try {
    assert.match(f.host.textContent!, /새 프로필 만들기/);
    assert.match(f.host.textContent!, /칸반이 역할을 보고 일을 배분할 때 씁니다/);
    assert.ok(f.host.querySelector('input[name="new-profile-name"]'));
    await f.click("설치 및 연결");
    assert.equal("createProfile" in (prepared ?? {}), false);
  } finally {
    await f.cleanup();
  }
});

test("프로필 이름과 설명을 채우면 createProfile 로 실린다", async () => {
  let prepared: Record<string, unknown> | undefined;
  const f = await reachReview(
    provisionInspection,
    (body) => {
      prepared = body;
    },
    candidate,
  );
  try {
    await act(async () => {
      typeInto(f.host.querySelector<HTMLInputElement>('input[name="new-profile-name"]')!, " noah ");
      typeInto(
        f.host.querySelector<HTMLInputElement>('input[name="new-profile-description"]')!,
        "리서치 담당",
      );
    });
    await f.click("설치 및 연결");
    assert.deepEqual(prepared?.createProfile, { name: "noah", description: "리서치 담당" });
  } finally {
    await f.cleanup();
  }
});

test("규칙에 어긋난 프로필 이름은 안내를 띄우고 prepare 를 막는다", async () => {
  let prepares = 0;
  const f = await reachReview(
    provisionInspection,
    () => {
      prepares++;
    },
    candidate,
  );
  try {
    await act(async () => {
      typeInto(f.host.querySelector<HTMLInputElement>('input[name="new-profile-name"]')!, "Noah!");
    });
    assert.match(f.host.textContent!, /소문자·숫자·하이픈·밑줄만 쓰고 64자 이하/);
    const prepare = Array.from(f.host.querySelectorAll("button")).find(
      (b) => b.textContent === "설치 및 연결",
    )!;
    assert.equal(prepare.disabled, true);
    await act(async () => prepare.click());
    assert.equal(prepares, 0);
  } finally {
    await f.cleanup();
  }
});

test("profile_not_served 와 model_provider_required 는 실패가 아니라 경고로 그린다", async () => {
  const f = await fixture(async (url, init) => {
    if (String(url).includes("?job="))
      return response({
        job: {
          id: "j",
          status: "succeeded",
          steps: ["provisioning_keys"],
          gatewayId: "g",
          warnings: ["profile_not_served", "model_provider_required"],
        },
      });
    if (!init?.body) return response(capabilities);
    const { action } = JSON.parse(String(init.body));
    if (action === "discover") return response({ candidates: [candidate] });
    if (action === "inspect")
      return response({ candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] });
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    await f.click("설치 및 연결");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
    assert.match(f.host.textContent!, /게이트웨이가 연결되었습니다/);
    assert.match(f.host.textContent!, /multiplex 프로필 허용 목록/);
    assert.match(f.host.textContent!, /서버에서 hermes model 을 실행/);
    assert.equal(f.host.querySelector('[role="alert"]'), null, "경고는 실패로 그리지 않는다");
    assert.doesNotMatch(f.host.textContent!, /profile_not_served|model_provider_required/);
    assert.doesNotMatch(f.host.textContent!, /연결을 완료하지 못했습니다/);
  } finally {
    await f.cleanup();
  }
});

test("새 진행 단계 세 가지는 한국어 라벨로 나오고 원시 코드가 새지 않는다", async () => {
  const f = await fixture(async (url, init) => {
    if (String(url).includes("?job="))
      return response({
        job: {
          id: "j",
          status: "running",
          steps: ["installing_hermes", "creating_profile", "provisioning_keys"],
        },
      });
    if (!init?.body) return response(capabilities);
    const { action } = JSON.parse(String(init.body));
    if (action === "discover") return response({ candidates: [candidate] });
    if (action === "inspect")
      return response({ candidate, pluginStatus: "plugin_absent", changes: ["installing_plugin"] });
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await f.click("연결하기");
    await f.click("설치 및 연결");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
    assert.match(f.host.textContent!, /Hermes 설치/);
    assert.match(f.host.textContent!, /새 프로필 만들기/);
    assert.match(f.host.textContent!, /프로필 인증 키 발급/);
    assert.doesNotMatch(f.host.textContent!, /installing_hermes|creating_profile/);
  } finally {
    await f.cleanup();
  }
});

for (const [code, expected] of [
  ["profile_name_invalid", /소문자·숫자·하이픈·밑줄만 쓰고 64자 이하/],
  ["profile_exists", /같은 이름의 프로필이 이미 있습니다/],
  ["profile_create_failed", /Hermes 홈 디렉터리 쓰기 권한/],
  ["profile_key_failed", /기존 키는 덮어쓰지 않습니다/],
  ["profile_provision_forbidden", /리스너 소유자 프로필이 아니거나/],
  ["profile_verify_failed", /프로필 허용 목록을 확인/],
  ["hermes_already_installed", /이미 Hermes 가 설치돼 있습니다/],
  ["hermes_install_forbidden", /DESKRPG_HERMES_INSTALL_ENABLED/],
  ["hermes_install_failed", /설치 스크립트를 직접 실행/],
  ["hermes_installer_unavailable", /네트워크와 프록시 설정/],
] as const) {
  test(`실패한 잡의 ${code} 는 원인과 다음 행동을 담은 안내로 바뀐다 (계약 2)`, async () => {
    const f = await fixture(async (_url, init) => {
      if (!init?.body) return response(capabilities);
      const { action } = JSON.parse(String(init.body));
      if (action === "discover") return response({ candidates: [candidate] });
      if (action === "inspect")
        return response({
          candidate,
          pluginStatus: "plugin_absent",
          changes: ["installing_plugin"],
        });
      return response({ job: { id: "j", status: "failed", steps: [], error: code } });
    });
    try {
      await act(async () =>
        Array.from(f.host.querySelectorAll("button"))
          .find((b) => b.textContent?.includes("로컬 연결"))!
          .click(),
      );
      await f.click("연결하기");
      await f.click("설치 및 연결");
      const alerts = Array.from(f.host.querySelectorAll('[role="alert"]'))
        .map((node) => node.textContent ?? "")
        .join("\n");
      assert.match(alerts, expected);
      assert.doesNotMatch(alerts, new RegExp(code));
    } finally {
      await f.cleanup();
    }
  });
}

test("설치만 끝난 잡은 실패로 그리지 않고 다시 찾기로 이어 간다", async () => {
  const sent: string[] = [];
  const f = await fixture(async (url, init) => {
    if (String(url).includes("?job="))
      return response({ job: { id: "j", status: "succeeded", steps: ["installing_hermes"] } });
    if (!init?.body) return response({ ...capabilities, canInstallHermes: true });
    const { action } = JSON.parse(String(init.body));
    sent.push(action);
    if (action === "discover") return response({ candidates: [] });
    return response({ job: { id: "j", status: "running", steps: [] } });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await act(async () =>
      f.host.querySelector<HTMLInputElement>('input[name="install-consent"]')!.click(),
    );
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent === "Hermes 설치 시작")!
        .click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
    assert.match(f.host.textContent!, /Hermes 설치가 끝났습니다/);
    assert.doesNotMatch(f.host.textContent!, /연결을 완료하지 못했습니다/);
    await f.click("다시 확인");
    assert.equal(sent.at(-1), "discover");
  } finally {
    await f.cleanup();
  }
});

/** 후보 검색 → 검토 → "설치 및 연결" 까지 한 번에 가는 공통 경로. */
async function prepareFlow(
  handler: (action: string, body: Record<string, unknown>) => Response | undefined,
) {
  const f = await fixture(async (url, init) => {
    if (String(url).includes("?job="))
      return response({ job: { id: "j", status: "running", steps: [] } });
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    if (body.action === "discover") return response({ candidates: [candidate] });
    if (body.action === "inspect")
      return response({
        candidate,
        pluginStatus: "plugin_absent",
        changes: ["installing_plugin"],
      });
    const handled = handler(body.action, body);
    assert.ok(handled, `unhandled ${body.action}`);
    return handled;
  });
  await act(async () =>
    Array.from(f.host.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("로컬 연결"))!
      .click(),
  );
  await f.click("연결하기");
  await f.click("설치 및 연결");
  return f;
}

test("모델 다시 확인이 ready 면 모델 경고를 지운다", async () => {
  const f = await prepareFlow((action) => {
    if (action === "prepare")
      return response({
        job: {
          id: "j",
          status: "succeeded",
          steps: ["installing_plugin"],
          gatewayId: "g",
          warnings: ["model_provider_required"],
        },
      });
    if (action === "check-model") return response({ model: "ready" });
    return undefined;
  });
  try {
    assert.match(f.host.textContent!, /모델 제공자가 아직 없습니다/);
    await f.click("모델 다시 확인");
    assert.doesNotMatch(f.host.textContent!, /모델 제공자가 아직 없습니다/);
    assert.match(f.host.textContent!, /모델 로그인이 확인되었습니다/);
  } finally {
    await f.cleanup();
  }
});

test("모델 다시 확인이 missing 이면 모델 경고를 유지한다", async () => {
  const f = await prepareFlow((action) => {
    if (action === "prepare")
      return response({
        job: { id: "j", status: "succeeded", steps: ["installing_plugin"], gatewayId: "g" },
      });
    if (action === "check-model") return response({ model: "missing" });
    return undefined;
  });
  try {
    assert.doesNotMatch(f.host.textContent!, /모델 제공자가 아직 없습니다/);
    await f.click("모델 다시 확인");
    assert.match(f.host.textContent!, /모델 제공자가 아직 없습니다/);
  } finally {
    await f.cleanup();
  }
});

test("모델 확인 unknown 은 실패로 그리지 않고 중립적으로 알린다", async () => {
  const f = await prepareFlow((action) => {
    if (action === "prepare")
      return response({
        job: { id: "j", status: "succeeded", steps: ["installing_plugin"], gatewayId: "g" },
      });
    if (action === "check-model") return response({ model: "unknown" });
    return undefined;
  });
  try {
    await f.click("모델 다시 확인");
    assert.match(f.host.textContent!, /확인하지 못했습니다/);
    assert.equal(f.host.querySelectorAll('[role="alert"]').length, 0);
    assert.doesNotMatch(f.host.textContent!, /연결을 완료하지 못했습니다/);
  } finally {
    await f.cleanup();
  }
});

test("모르는 설치 진행 코드는 아무것도 그리지 않고 아는 코드만 문구로 그린다", async () => {
  const f = await prepareFlow((action) => {
    if (action === "prepare")
      return response({
        job: {
          id: "j",
          status: "failed",
          steps: ["installing_plugin"],
          error: "hermes_install_failed",
          progress: "totally_unknown_code",
        },
      });
    return undefined;
  });
  try {
    assert.doesNotMatch(f.host.textContent!, /totally_unknown_code/);
  } finally {
    await f.cleanup();
  }
  const g = await prepareFlow((action) => {
    if (action === "prepare")
      return response({
        job: {
          id: "j",
          status: "failed",
          steps: ["installing_plugin"],
          error: "hermes_install_failed",
          progress: "venv",
        },
      });
    return undefined;
  });
  try {
    assert.match(g.host.textContent!, /파이썬 가상 환경/);
  } finally {
    await g.cleanup();
  }
});

test("설치가 도는 동안 경과 시간이 올라간다", async () => {
  const running = { id: "j", status: "running", steps: ["installing_hermes"] };
  const f = await fixture(async (url, init) => {
    if (String(url).includes("?job=")) return response({ job: running });
    if (!init?.body) return response({ ...capabilities, canInstallHermes: true });
    const { action } = JSON.parse(String(init.body));
    if (action === "discover") return response({ candidates: [] });
    return response({ job: running });
  });
  try {
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("로컬 연결"))!
        .click(),
    );
    await act(async () =>
      f.host.querySelector<HTMLInputElement>('input[name="install-consent"]')!.click(),
    );
    await act(async () =>
      Array.from(f.host.querySelectorAll("button"))
        .find((b) => b.textContent === "Hermes 설치 시작")!
        .click(),
    );
    assert.match(f.host.textContent!, /0초 경과/);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1200)));
    assert.match(f.host.textContent!, /1초 경과/);
  } finally {
    await f.cleanup();
  }
});

test("실패한 잡에 이어서 실행 버튼이 뜨고 resumeFrom 이 실려 나간다", async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = await prepareFlow((action, body) => {
    if (action !== "prepare") return undefined;
    bodies.push(body);
    return response(
      bodies.length === 1
        ? {
            job: {
              id: "failed-job",
              status: "failed",
              steps: ["installing_plugin", "restarting_gateway"],
              error: "gateway_restart_failed",
              completed: ["installing_plugin"],
            },
          }
        : {
            job: {
              id: "resumed",
              status: "running",
              steps: ["installing_plugin", "restarting_gateway"],
            },
          },
    );
  });
  try {
    assert.match(f.host.textContent!, /여기까지 끝났습니다/);
    await f.click("이어서 실행");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].resumeFrom, "failed-job");
    assert.equal(bodies[1].candidateId, bodies[0].candidateId);
    // 이미 끝난 단계는 다시 돌지 않았다는 사실을 화면에 남긴다.
    assert.match(f.host.textContent!, /DeskRPG 플러그인 설치 \(건너뜀\)/);
  } finally {
    await f.cleanup();
  }
});

test("성공한 잡에는 이어서 실행 버튼이 뜨지 않는다", async () => {
  const f = await prepareFlow((action) =>
    action === "prepare"
      ? response({
          job: {
            id: "j",
            status: "succeeded",
            steps: ["installing_plugin"],
            completed: ["installing_plugin"],
          },
        })
      : undefined,
  );
  try {
    assert.doesNotMatch(f.host.textContent!, /이어서 실행/);
    assert.doesNotMatch(f.host.textContent!, /여기까지 끝났습니다/);
  } finally {
    await f.cleanup();
  }
});

test("resume_unavailable 은 다시 시작 경로를 알려 주는 안내로 바뀐다", async () => {
  const f = await prepareFlow((action) =>
    action === "prepare"
      ? response({ job: { id: "j", status: "failed", steps: [], error: "resume_unavailable" } })
      : undefined,
  );
  try {
    const alerts = Array.from(f.host.querySelectorAll('[role="alert"]'))
      .map((node) => node.textContent ?? "")
      .join("\n");
    assert.match(alerts, /설치 찾기부터 다시 시작/);
    assert.doesNotMatch(alerts, /resume_unavailable/);
  } finally {
    await f.cleanup();
  }
});

/** 카드 버튼은 라벨과 설명을 함께 담는다 — 포함으로 찾는다. */
async function clickIncluding(host: HTMLElement, text: string) {
  const button = Array.from(host.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );
  assert.ok(button, text);
  await act(async () => button.click());
}

test("포트 충돌 제안은 동의 버튼을 눌러야 setPort 로 올라간다", async () => {
  const sent: Record<string, unknown>[] = [];
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    sent.push(body);
    if (body.action === "discover") return response({ candidates: [candidate] });
    if (body.action === "inspect")
      return new Response(
        JSON.stringify({
          error: "port_conflict",
          errorCode: "port_conflict",
          suggestedPort: 8643,
        }),
        { status: 400 },
      );
    return response({ job: { id: "job", status: "running", steps: ["setting_port"] } });
  });
  try {
    await clickIncluding(f.host, "로컬 연결");
    await clickIncluding(f.host, "연결하기");
    // 제안은 보이지만 아직 아무것도 보내지 않았다.
    assert.match(f.host.textContent!, /8643/);
    assert.deepEqual(
      sent.map((body) => body.action),
      ["discover", "inspect"],
    );
    await clickIncluding(f.host, "바꾸고 계속");
    const prepare = sent.at(-1)!;
    assert.equal(prepare.action, "prepare");
    assert.equal(prepare.setPort, 8643);
    assert.equal(prepare.candidateId, candidate.id);
  } finally {
    await f.cleanup();
  }
});
test("제안이 없는 포트 충돌은 오류만 보여 주고 흐름을 막지 않는다", async () => {
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    if (body.action === "discover") return response({ candidates: [candidate] });
    return new Response(JSON.stringify({ error: "port_conflict", errorCode: "port_conflict" }), {
      status: 400,
    });
  });
  try {
    await clickIncluding(f.host, "로컬 연결");
    await clickIncluding(f.host, "연결하기");
    assert.match(f.host.textContent!, /포트/);
    assert.doesNotMatch(f.host.textContent!, /바꾸고 계속/);
    assert.ok(
      Array.from(f.host.querySelectorAll("button")).some((b) =>
        b.textContent?.includes("다시 확인"),
      ),
    );
  } finally {
    await f.cleanup();
  }
});
test("범위 밖 제안 포트는 화면이 버린다", async () => {
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    if (body.action === "discover") return response({ candidates: [candidate] });
    return new Response(
      JSON.stringify({ error: "port_conflict", errorCode: "port_conflict", suggestedPort: 22 }),
      { status: 400 },
    );
  });
  try {
    await clickIncluding(f.host, "로컬 연결");
    await clickIncluding(f.host, "연결하기");
    assert.doesNotMatch(f.host.textContent!, /바꾸고 계속/);
  } finally {
    await f.cleanup();
  }
});
test("포트 쓰기 실패는 안전한 안내로만 나온다", async () => {
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response(capabilities);
    const body = JSON.parse(String(init.body));
    if (body.action === "discover") return response({ candidates: [candidate] });
    if (body.action === "inspect")
      return new Response(
        JSON.stringify({
          error: "port_conflict",
          errorCode: "port_conflict",
          suggestedPort: 8643,
        }),
        { status: 400 },
      );
    return new Response(
      JSON.stringify({ error: "port_write_failed", errorCode: "port_write_failed" }),
      { status: 409 },
    );
  });
  try {
    await clickIncluding(f.host, "로컬 연결");
    await clickIncluding(f.host, "연결하기");
    await clickIncluding(f.host, "바꾸고 계속");
    assert.match(f.host.textContent!, /\.env/);
    assert.doesNotMatch(f.host.textContent!, /port_write_failed/);
  } finally {
    await f.cleanup();
  }
});

/** 카드 버튼은 제목과 설명을 함께 담는다 — 제목이 들어 있는 버튼을 누른다. */
async function clickContaining(host: HTMLElement, label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );
  assert.ok(button, label);
  await act(async () => button.click());
}

test("로컬을 못 쓰면 막힌 이유를 그대로 보여 준다 — 컨테이너 안 Hermes 없음", async () => {
  const f = await fixture(async () =>
    response({
      ...capabilities,
      local: false,
      localReason: "container_without_hermes",
      canInstallHermes: false,
    }),
  );
  try {
    assert.match(
      f.host.textContent!,
      /Docker 컨테이너 환경에서는 로컬 Hermes 설치를 지원하지 않습니다/,
    );
    assert.equal(/호스트 접근이 허용되지 않습니다/.test(f.host.textContent!), false);
  } finally {
    await f.cleanup();
  }
});

test("SSH 를 못 쓰면 원격 화면에 그 이유를 보여 준다", async () => {
  const f = await fixture(async () =>
    response({ ...capabilities, ssh: false, sshHosts: [], sshReason: "ssh_missing" }),
  );
  try {
    await clickContaining(f.host, "원격 연결");
    assert.match(f.host.textContent!, /ssh 명령이 없어/);
  } finally {
    await f.cleanup();
  }
});

test("등록한 SSH 호스트가 없으면 SSH 화면이 곧바로 등록 패널을 연다", async () => {
  const f = await fixture(async (_url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.action === "ssh-public-key")
      return response({ publicKey: "ssh-ed25519 AAAAPUB deskrpg@server" });
    return response({ ...capabilities, sshHosts: [] });
  });
  try {
    await clickContaining(f.host, "원격 연결");
    await clickContaining(f.host, "SSH로 연결");
    assert.ok(f.host.querySelector("[data-ssh-registration]"), "등록 패널이 열리지 않았다");
    assert.match(f.host.textContent!, /authorized_keys/);
    assert.match(f.host.textContent!, /AAAAPUB/);
  } finally {
    await f.cleanup();
  }
});

test("SSH 탐색이 인증 실패로 끝나면 설치를 권하지 않고 공개키 등록을 확인하라고 말한다", async () => {
  const f = await fixture(async (_url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.action === "discover")
      return new Response(JSON.stringify({ errorCode: "ssh_auth_failed" }), { status: 400 });
    return response(capabilities);
  });
  try {
    await clickContaining(f.host, "원격 연결");
    await clickContaining(f.host, "SSH로 연결");
    const select = f.host.querySelector("select")!;
    await act(async () => {
      select.value = "approved";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await f.click("설치 찾기");
    const text = f.host.textContent!;
    assert.match(text, /DeskRPG 키가 거절됐습니다/);
    assert.equal(/Hermes 를 설치할까요/.test(text), false, "인증 실패인데 설치를 권한다");
    assert.equal(/설치를 찾지 못했습니다/.test(text), false, "인증 실패인데 Hermes 가 없다고 한다");
  } finally {
    await f.cleanup();
  }
});

test("컨테이너 이유는 한 줄로 보이고, 자세한 사정은 ? 버튼을 눌러야 나온다", async () => {
  const f = await fixture(async () =>
    response({ ...capabilities, local: false, localReason: "container_without_hermes" }),
  );
  try {
    assert.match(
      f.host.textContent!,
      /Docker 컨테이너 환경에서는 로컬 Hermes 설치를 지원하지 않습니다/,
    );
    assert.ok(!f.host.textContent!.includes("host.docker.internal"));
    const more = f.host.querySelector<HTMLButtonElement>(
      '[data-reason-detail="container_without_hermes"]',
    );
    assert.ok(more);
    await act(async () => more.click());
    assert.match(f.host.textContent!, /host\.docker\.internal/);
  } finally {
    await f.cleanup();
  }
});
