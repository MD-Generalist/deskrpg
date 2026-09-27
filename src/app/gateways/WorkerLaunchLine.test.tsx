import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider, type Locale } from "@/lib/i18n";
import WorkerLaunchLine from "./WorkerLaunchLine";

const LOCALES: Locale[] = ["ko", "en", "ja", "zh"];
const LAUNCHER = "/home/u/.hermes/hermes-agent/.hermes/bin/hermes";
const UNSET = { reason: "hermes_bin_unset" as const, launcher: LAUNCHER, hermesBin: null };

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

test("no line without a warning, and none for someone who does not own the gateway", async () => {
  for (const node of [
    <WorkerLaunchLine key="a" warning={null} isOwner />,
    <WorkerLaunchLine key="b" warning={UNSET} isOwner={false} />,
  ]) {
    const { host, cleanup } = await render(node);
    assert.ok(!host.querySelector("[data-worker-launch]"));
    await cleanup();
  }
});

for (const locale of LOCALES) {
  test(`[${locale}] the owner sees what is wrong and the command that fixes it`, async () => {
    const { host, cleanup } = await render(<WorkerLaunchLine warning={UNSET} isOwner />, locale);
    const line = host.querySelector("[data-worker-launch='hermes_bin_unset']");
    assert.ok(line);
    const text = line.textContent ?? "";
    assert.match(text, /HERMES_BIN/);
    assert.match(text, /hermes-bin\.conf/);
    assert.ok(text.includes(LAUNCHER), "the command names the launcher");
    assert.ok(text.includes("systemctl --user restart hermes-gateway"));
    await cleanup();
  });
}

test("a broken HERMES_BIN is named", async () => {
  const { host, cleanup } = await render(
    <WorkerLaunchLine
      warning={{ reason: "hermes_bin_missing", launcher: LAUNCHER, hermesBin: "/gone/hermes" }}
      isOwner
    />,
  );
  assert.match(host.textContent ?? "", /\/gone\/hermes/);
  await cleanup();
});

test("without a launcher to suggest it says what to set instead of a command", async () => {
  const { host, cleanup } = await render(
    <WorkerLaunchLine warning={{ ...UNSET, launcher: null }} isOwner />,
  );
  assert.ok(!(host.textContent ?? "").includes("systemctl"));
  assert.match(host.textContent ?? "", /HERMES_BIN/);
  await cleanup();
});

test("[다시 확인] rechecks the gateway", async () => {
  let rechecked = 0;
  const { host, cleanup } = await render(
    <WorkerLaunchLine warning={UNSET} isOwner onRecheck={() => void (rechecked += 1)} />,
  );
  const button = host.querySelector<HTMLButtonElement>("[data-action='worker-launch-recheck']");
  assert.ok(button);
  await act(async () => button.click());
  assert.equal(rechecked, 1);
  await cleanup();
});
