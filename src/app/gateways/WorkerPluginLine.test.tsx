import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider, type Locale } from "@/lib/i18n";
import WorkerPluginLine, { type WorkerPluginApplyResponse } from "./WorkerPluginLine";

const LOCALES: Locale[] = ["ko", "en", "ja", "zh"];
const WARN = { fixable: ["sophie", "oliver"], disabledByOperator: [] as string[] };

async function render(node: React.ReactElement, locale: Locale = "ko") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<I18nProvider initialLocale={locale}>{node}</I18nProvider>);
  });
  return {
    host,
    root,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const noop = async (): Promise<WorkerPluginApplyResponse> => ({ ok: true, results: [] });

test("경고가 없으면 줄 자체가 없다", async () => {
  const { host, cleanup } = await render(
    <WorkerPluginLine warning={null} isOwner apply={noop} onApplied={() => {}} />,
  );
  assert.equal(host.querySelector("[data-worker-plugin-line]"), null);
  await cleanup();
});

for (const locale of LOCALES) {
  test(`[${locale}] 직원 수와 이름, 소유자에게 버튼과 무엇이 바뀌는지를 보인다`, async () => {
    const { host, cleanup } = await render(
      <WorkerPluginLine warning={WARN} isOwner apply={noop} onApplied={() => {}} />,
      locale,
    );
    const text = host.textContent ?? "";
    assert.match(text, /2/);
    assert.match(text, /sophie, oliver/);
    assert.equal(host.querySelectorAll("button").length, 1);
    // 번역 키가 그대로 새지 않는다.
    assert.doesNotMatch(text, /gateways\.workerPlugin/);
    await cleanup();
  });
}

test("소유자가 아니면 버튼이 없다", async () => {
  const { host, cleanup } = await render(
    <WorkerPluginLine warning={WARN} isOwner={false} apply={noop} onApplied={() => {}} />,
  );
  assert.equal(host.querySelectorAll("button").length, 0);
  assert.match(host.textContent ?? "", /sophie/);
  await cleanup();
});

test("운영자가 끈 직원은 따로 말한다", async () => {
  const { host, cleanup } = await render(
    <WorkerPluginLine
      warning={{ fixable: ["sophie"], disabledByOperator: ["mia"] }}
      isOwner
      apply={noop}
      onApplied={() => {}}
    />,
  );
  assert.match(host.textContent ?? "", /mia/);
  await cleanup();
});

test("적용하면 목록을 다시 부르고, 경고가 사라진 뒤에도 결과 안내가 남는다", async () => {
  let reloaded = 0;
  const { host, root, cleanup } = await render(
    <WorkerPluginLine
      warning={WARN}
      isOwner
      apply={async () => ({
        ok: true,
        results: [
          { profile: "sophie", link: "created", enabled: "added" },
          { profile: "oliver", error: "config_unreadable" },
        ],
      })}
      onApplied={() => {
        reloaded += 1;
      }}
    />,
  );
  await act(async () => {
    host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  assert.equal(reloaded, 1);
  assert.ok(host.querySelector('[data-worker-plugin-result="applied"]'));
  assert.ok(host.querySelector('[data-worker-plugin-failure="oliver"]'));
  assert.equal(host.querySelector('[data-worker-plugin-failure="sophie"]'), null);

  // 목록을 다시 불러와 경고가 사라진 상태 — 크론 재시작 안내를 사용자가 읽어야 하므로 결과는 남는다.
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="ko">
        <WorkerPluginLine warning={null} isOwner apply={noop} onApplied={() => {}} />
      </I18nProvider>,
    );
  });
  assert.ok(host.querySelector('[data-worker-plugin-result="applied"]'));
  await cleanup();
});

test("요청이 실패하면 코드를 보이고 목록을 다시 부르지 않는다", async () => {
  let reloaded = 0;
  const { host, cleanup } = await render(
    <WorkerPluginLine
      warning={WARN}
      isOwner
      apply={async () => ({ ok: false, errorCode: "plugin_unreachable" })}
      onApplied={() => {
        reloaded += 1;
      }}
    />,
  );
  await act(async () => {
    host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  assert.equal(reloaded, 0);
  assert.ok(host.querySelector('[data-worker-plugin-result="error"]'));
  assert.match(host.textContent ?? "", /plugin_unreachable/);
  await cleanup();
});
