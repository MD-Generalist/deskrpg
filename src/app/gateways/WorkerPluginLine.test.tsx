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

// --- 0.16.0 워커 전파 옵트인 -------------------------------------------------

const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const buttonText = (host: HTMLElement, text: RegExp) =>
  [...host.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""));

for (const locale of LOCALES) {
  test(`[${locale}] 전파가 꺼져 있으면 빠진 직원이 없어도 설명과 켜는 명령을 보인다`, async () => {
    const { host, cleanup } = await render(
      <WorkerPluginLine
        warning={null}
        propagation="disabled"
        isOwner
        apply={noop}
        onApplied={() => {}}
        onRecheck={() => {}}
      />,
      locale,
    );
    const text = host.textContent ?? "";
    assert.ok(host.querySelector('[data-worker-propagation="disabled"]'));
    assert.match(text, /hermes config set plugins\.entries\.deskrpg\.worker_propagation true/);
    assert.match(text, /DESKRPG_WORKER_PROPAGATION/);
    assert.doesNotMatch(text, /gateways\.workerPlugin/);
    assert.doesNotMatch(text, /worker_propagation_disabled/);
    await cleanup();
  });
}

test("전파가 꺼져 있으면 [적용] 은 숨기고, [다시 확인] 은 onRecheck 를 부른다", async () => {
  let rechecked = 0;
  const { host, cleanup } = await render(
    <WorkerPluginLine
      warning={WARN}
      propagation="disabled"
      isOwner
      apply={noop}
      onApplied={() => {}}
      onRecheck={() => {
        rechecked += 1;
      }}
    />,
  );
  assert.equal(buttonText(host, /^적용$/), undefined);
  assert.match(host.textContent ?? "", /sophie, oliver/);
  await click(host.querySelector('[data-action="worker-propagation-recheck"]')!);
  assert.equal(rechecked, 1);
  await cleanup();
});

test("켜기 진입점이 있으면 [설정에서 켜기] 로 켜고 목록을 다시 부른다 — 명령은 처음엔 없다", async () => {
  let calls = 0;
  let reloaded = 0;
  const { host, cleanup } = await render(
    <WorkerPluginLine
      warning={null}
      propagation="disabled"
      isOwner
      apply={noop}
      onApplied={() => {
        reloaded += 1;
      }}
      enablePropagation={async () => {
        calls += 1;
        return { ok: true, results: [{ profile: "sophie", link: "created", enabled: "added" }] };
      }}
    />,
  );
  assert.doesNotMatch(host.textContent ?? "", /hermes config set/);
  await click(host.querySelector('[data-action="worker-propagation-enable"]')!);
  assert.equal(calls, 1);
  assert.equal(reloaded, 1);
  assert.ok(host.querySelector('[data-worker-propagation-result="enabled"]'));
  await cleanup();
});

test("명령을 돌릴 수 없는 호스트(plugin_update_unsupported_host)면 명령 복사로 떨어진다", async () => {
  let reloaded = 0;
  const { host, cleanup } = await render(
    <WorkerPluginLine
      warning={null}
      propagation="disabled"
      isOwner
      apply={noop}
      onApplied={() => {
        reloaded += 1;
      }}
      enablePropagation={async () => ({ ok: false, errorCode: "plugin_update_unsupported_host" })}
    />,
  );
  await click(host.querySelector('[data-action="worker-propagation-enable"]')!);
  const text = host.textContent ?? "";
  assert.equal(reloaded, 0);
  assert.match(text, /hermes config set/);
  assert.doesNotMatch(text, /plugin_update_unsupported_host/);
  await cleanup();
});

test("켰지만 적용 단계가 실패하면 그 사실을 알리고 목록을 다시 부른다([적용] 이 다시 나온다)", async () => {
  let reloaded = 0;
  const { host, cleanup } = await render(
    <WorkerPluginLine
      warning={null}
      propagation="disabled"
      isOwner
      apply={noop}
      onApplied={() => {
        reloaded += 1;
      }}
      enablePropagation={async () => ({ ok: true, applyErrorCode: "plugin_unreachable" })}
    />,
  );
  await click(host.querySelector('[data-action="worker-propagation-enable"]')!);
  assert.equal(reloaded, 1);
  assert.ok(host.querySelector('[data-worker-propagation-result="apply-failed"]'));
  assert.match(host.textContent ?? "", /plugin_unreachable/);
  await cleanup();
});

test("적용 요청이 409 worker_propagation_disabled 면 날것의 코드 대신 설명과 켜는 방법", async () => {
  let reloaded = 0;
  const { host, cleanup } = await render(
    <WorkerPluginLine
      warning={WARN}
      isOwner
      apply={async () => ({ ok: false, errorCode: "worker_propagation_disabled" })}
      onApplied={() => {
        reloaded += 1;
      }}
      onRecheck={() => {}}
    />,
  );
  await click(buttonText(host, /^적용$/)!);
  const text = host.textContent ?? "";
  assert.equal(reloaded, 0);
  assert.equal(host.querySelector('[data-worker-plugin-result="error"]'), null);
  assert.ok(host.querySelector('[data-worker-propagation="disabled"]'));
  assert.doesNotMatch(text, /worker_propagation_disabled/);
  assert.match(text, /hermes config set/);
  await cleanup();
});

test("소유자가 아니면 설명만 — 명령·버튼 없음", async () => {
  const { host, cleanup } = await render(
    <WorkerPluginLine
      warning={null}
      propagation="disabled"
      isOwner={false}
      apply={noop}
      onApplied={() => {}}
      onRecheck={() => {}}
    />,
  );
  assert.ok(host.querySelector('[data-worker-propagation="disabled"]'));
  assert.equal(host.querySelectorAll("button").length, 0);
  assert.doesNotMatch(host.textContent ?? "", /hermes config set/);
  await cleanup();
});

test("전파가 켜져 있거나 모르면(옛 플러그인) 지금과 같다", async () => {
  for (const propagation of ["enabled", null, undefined] as const) {
    const { host, cleanup } = await render(
      <WorkerPluginLine
        warning={null}
        propagation={propagation}
        isOwner
        apply={noop}
        onApplied={() => {}}
      />,
    );
    assert.equal(host.querySelector("[data-worker-plugin-line]"), null);
    await cleanup();
  }
});
