import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider, type Locale } from "@/lib/i18n";
import WorkerPropagationInheritedNotice, {
  disableWorkerPropagationRequest,
} from "./WorkerPropagationInheritedNotice";

async function render(node: React.ReactElement, locale: Locale = "ko") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<I18nProvider initialLocale={locale}>{node}</I18nProvider>);
  });
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

for (const locale of ["ko", "en", "ja", "zh"] as Locale[]) {
  test(`[${locale}] 이어받았다는 안내와 끄기 버튼 하나를 보인다`, async () => {
    const { host, cleanup } = await render(
      <WorkerPropagationInheritedNotice
        turnOff={async () => ({ ok: true })}
        onChanged={() => {}}
      />,
      locale,
    );
    assert.ok(host.querySelector("[data-worker-propagation-inherited]"));
    assert.ok((host.textContent ?? "").length > 10);
    assert.equal(host.querySelectorAll("button").length, 1);
    await cleanup();
  });
}

test("끄기를 누르면 요청하고, 끈 뒤에는 버튼 대신 결과 문구를 보이고 목록을 다시 읽게 한다", async () => {
  let calls = 0;
  let changed = 0;
  const { host, cleanup } = await render(
    <WorkerPropagationInheritedNotice
      turnOff={async () => {
        calls++;
        return { ok: true };
      }}
      onChanged={() => {
        changed++;
      }}
    />,
  );
  await act(async () => host.querySelector("button")!.click());
  assert.equal(calls, 1);
  assert.equal(changed, 1);
  assert.equal(host.querySelectorAll("button").length, 0);
  assert.match(host.textContent!, /워커 적용을 껐습니다/);
  await cleanup();
});

test("끄기에 실패하면 코드를 보이고 버튼을 남긴다", async () => {
  const { host, cleanup } = await render(
    <WorkerPropagationInheritedNotice
      turnOff={async () => ({ ok: false, errorCode: "setup_busy" })}
      onChanged={() => {}}
    />,
  );
  await act(async () => host.querySelector("button")!.click());
  assert.match(host.textContent!, /setup_busy/);
  assert.equal(host.querySelectorAll("button").length, 1);
  await cleanup();
});

test("끄기 요청은 enabled:false 를 보내고, 끄였다고 말하지 않으면 실패로 본다", async () => {
  const seen: { url: string; body: string }[] = [];
  const reply = (status: number, body: unknown) =>
    (async (url: string, init?: RequestInit) => {
      seen.push({ url, body: String(init?.body) });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  assert.deepEqual(
    await disableWorkerPropagationRequest("g 1", reply(200, { propagation: "disabled" })),
    { ok: true },
  );
  assert.equal(seen[0].url, "/api/gateways/g%201/plugin/worker-propagation");
  assert.deepEqual(JSON.parse(seen[0].body), { enabled: false });
  // .env 변수가 켜 두어 여전히 enabled 면 끄지 못한 것이다.
  assert.deepEqual(
    await disableWorkerPropagationRequest("g", reply(200, { propagation: "enabled" })),
    { ok: false, errorCode: "propagation_still_enabled" },
  );
  assert.deepEqual(
    await disableWorkerPropagationRequest("g", reply(409, { errorCode: "setup_busy" })),
    { ok: false, errorCode: "setup_busy" },
  );
});
