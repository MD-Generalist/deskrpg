import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../lib/i18n/context";
import GatewaySetupWizard from "./GatewaySetupWizard";
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
    assert.match(f.host.textContent!, /DeskRPG 플러그인을 0\.6\.0 으로 올립니다/);
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
    assert.match(f.host.textContent!, /플러그인 고정 버전: 539ae43c0b5a \(0\.6\.0\)/);
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

async function reachEmptyDiscovery(caps: Record<string, unknown>, sent?: string[]) {
  const f = await fixture(async (_url, init) => {
    if (!init?.body) return response({ ...capabilities, ...caps });
    const { action } = JSON.parse(String(init.body));
    sent?.push(action);
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

test("설치 게이트가 꺼져 있으면 설치 제안 대신 운영자 안내를 보여준다", async () => {
  const f = await reachEmptyDiscovery({ canInstallHermes: false });
  try {
    assert.match(f.host.textContent!, /DESKRPG_HERMES_INSTALL_ENABLED/);
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

test("동의하지 않으면 설치가 시작되지 않고, 동의해야 install-hermes 가 나간다", async () => {
  const sent: string[] = [];
  const f = await reachEmptyDiscovery({ canInstallHermes: true }, sent);
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
    assert.equal(sent.at(-1), "install-hermes");
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
