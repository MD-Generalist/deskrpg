import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../../lib/i18n/context";
import { WebglGate } from "./webgl-gate";

// `next/link` 는 마운트 시 `self.requestIdleCallback` 을 만진다 — happy-dom 창을 그대로 붙인다.
Object.defineProperty(globalThis, "self", {
  value: globalThis.window,
  writable: true,
  configurable: true,
});

/**
 * 관문의 계약을 고정한다 — 검사가 실패하면 워크스페이스는 **마운트조차 되지 않는다**
 * (소켓 접속·데이터 로드가 그 안에서 일어나므로 "렌더는 하되 숨긴다" 로는 부족하다).
 */
async function mount(options: { detect: () => boolean; onRetry?: () => void }) {
  const mounts: number[] = [];
  const fatalRef: { current: (() => void) | null } = { current: null };

  function Workspace({ onFatal }: { onFatal: () => void }) {
    // 렌더가 아니라 커밋에서 센다 — "실제로 마운트됐는가" 가 이 관문의 계약이다.
    useEffect(() => {
      mounts.push(1);
      fatalRef.current = onFatal;
    }, [onFatal]);
    return <div data-testid="workspace">workspace</div>;
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="ko">
        <WebglGate
          detect={options.detect}
          onRetry={options.onRetry}
          renderWorkspace={(onFatal) => <Workspace onFatal={onFatal} />}
          renderChecking={() => <div data-testid="checking">checking</div>}
        />
      </I18nProvider>,
    );
  });

  return {
    host,
    mountCount: () => mounts.length,
    async fireFatal() {
      assert.ok(fatalRef.current, "워크스페이스가 마운트되지 않아 onFatal 을 받지 못했다");
      await act(async () => fatalRef.current!());
    },
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("WebGL 검사가 실패하면 워크스페이스를 마운트하지 않고 안내를 띄운다", async () => {
  const f = await mount({ detect: () => false });
  try {
    assert.equal(f.mountCount(), 0);
    assert.equal(f.host.querySelector('[data-testid="workspace"]'), null);
    assert.equal(f.host.querySelector('[data-testid="checking"]'), null);
    assert.match(f.host.textContent!, /3D 오피스를 시작할 수 없습니다/);
  } finally {
    await f.cleanup();
  }
});

test("검사를 통과하면 워크스페이스가 정상적으로 마운트된다", async () => {
  const f = await mount({ detect: () => true });
  try {
    assert.equal(f.mountCount(), 1);
    assert.ok(f.host.querySelector('[data-testid="workspace"]'));
    assert.doesNotMatch(f.host.textContent!, /3D 오피스를 시작할 수 없습니다/);
  } finally {
    await f.cleanup();
  }
});

test("세션 중 치명적 실패가 오면 워크스페이스를 내리고 안내로 바꾼다", async () => {
  const f = await mount({ detect: () => true });
  try {
    await f.fireFatal();
    assert.equal(f.host.querySelector('[data-testid="workspace"]'), null);
    assert.match(f.host.textContent!, /3D 오피스를 시작할 수 없습니다/);
  } finally {
    await f.cleanup();
  }
});

test("다시 시도 버튼은 전체 페이지를 다시 검사하게 한다", async () => {
  let retried = 0;
  const f = await mount({ detect: () => false, onRetry: () => (retried += 1) });
  try {
    const button = f.host.querySelector("button");
    assert.ok(button, "다시 시도 버튼이 있어야 한다");
    await act(async () => {
      button!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(retried, 1);
  } finally {
    await f.cleanup();
  }
});

test("안내에는 채널 목록으로 돌아가는 링크가 있다", async () => {
  const f = await mount({ detect: () => false });
  try {
    const link = f.host.querySelector('a[href="/channels"]');
    assert.ok(link, "채널 목록 링크가 있어야 한다");
  } finally {
    await f.cleanup();
  }
});
