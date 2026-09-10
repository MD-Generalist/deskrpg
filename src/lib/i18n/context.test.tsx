import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { hydrateRoot, createRoot } from "react-dom/client";
import { I18nProvider, useT } from "./context";
import { LOCALE_STORAGE_KEY } from "./constants";

function Checking() {
  const t = useT();
  return <span>{t("auth.checkingAuth")}</span>;
}

test("server-selected Korean hydrates without being replaced by stale English storage", async () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  const host = document.createElement("div");
  host.innerHTML = "<span>인증 확인 중...</span>";
  document.body.append(host);
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(
      host,
      <I18nProvider initialLocale="ko">
        <Checking />
      </I18nProvider>,
      { onRecoverableError: (error) => errors.push(error) },
    );
  });
  try {
    assert.equal(host.textContent, "인증 확인 중...");
    assert.equal(errors.length, 0);
    assert.equal(localStorage.getItem(LOCALE_STORAGE_KEY), "ko");
  } finally {
    await act(async () => root!.unmount());
    host.remove();
    localStorage.clear();
  }
});

test("blocked optional locale storage does not break the authenticated application shell", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Storage disabled");
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <Checking />
        </I18nProvider>,
      ),
    );
    assert.equal(host.textContent, "인증 확인 중...");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.defineProperty(globalThis, "localStorage", original);
  }
});
