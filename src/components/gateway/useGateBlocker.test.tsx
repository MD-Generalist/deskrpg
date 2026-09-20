import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { useGateBlocker } from "./useGateBlocker";

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useGateBlocker>) => void }) {
  const api = useGateBlocker();
  onReady(api);
  return <span>{api.blocker?.kind ?? "none"}</span>;
}

test("실패를 넘기면 분류해 담고, 지우면 비운다", async () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  let api!: ReturnType<typeof useGateBlocker>;

  await act(async () => {
    root.render(<Probe onReady={(next) => (api = next)} />);
  });
  assert.equal(el.textContent, "none");

  await act(async () => api.show({ status: 404, code: "plugin_absent" }));
  assert.equal(el.textContent, "plugin_absent");

  await act(async () => api.clear());
  assert.equal(el.textContent, "none");

  await act(async () => root.unmount());
  el.remove();
});

test("status·code 를 가진 오류 객체도 받는다", async () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  let api!: ReturnType<typeof useGateBlocker>;

  await act(async () => {
    root.render(<Probe onReady={(next) => (api = next)} />);
  });

  await act(async () => api.showFromError({ status: 409, code: "gateway_not_bound" }));
  assert.equal(el.textContent, "gateway_not_bound");

  // 모양이 다른 오류는 other 로 떨어지되 던지지 않는다.
  await act(async () => api.showFromError(new Error("그냥 오류")));
  assert.equal(el.textContent, "other");

  await act(async () => root.unmount());
  el.remove();
});
