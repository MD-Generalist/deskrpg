import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider, type Locale } from "@/lib/i18n";
import type { RoomMessage } from "@/lib/chat-rooms-policy";
import RoomNoticeMessage from "./RoomNoticeMessage";

// R29·R30: 알림 문장은 보는 사람의 로케일로 만든다. 네 로케일 모두 카드 제목·잡 이름이
// 들어가고, 모르는 kind 는 content 폴백, notice 가 없으면 이 컴포넌트를 타지 않는다.

function message(overrides: Partial<RoomMessage>): RoomMessage {
  return {
    id: "m1",
    roomId: "office",
    senderKind: "npc",
    senderId: "npc-a",
    senderName: "소피",
    content: "fallback content",
    createdAt: "2026-09-14T00:00:00Z",
    notice: null,
    ...overrides,
  };
}

async function render(
  node: React.ReactElement,
  locale: Locale,
): Promise<{ host: HTMLElement; cleanup: () => Promise<void> }> {
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

const LOCALES: Locale[] = ["ko", "en", "ja", "zh"];

// 로케일별로 문장이 실제로 달라야 한다 — 한 언어로 고정돼 있으면 잡는다.
const CARD_DONE_HINT: Record<Locale, string> = {
  ko: "완료했습니다",
  en: "Finished",
  ja: "完了",
  zh: "已完成",
};
const CARD_BLOCKED_HINT: Record<Locale, string> = {
  ko: "막혔습니다",
  en: "blocked",
  ja: "ブロック",
  zh: "阻塞",
};

test("card_done — 네 로케일 모두 카드 제목이 든 문장 + 카드 열기 링크 (R29)", async () => {
  for (const locale of LOCALES) {
    const opened: string[] = [];
    const { host, cleanup } = await render(
      <RoomNoticeMessage
        message={message({
          content: "소피: 주간 보고서",
          notice: {
            kind: "card_done",
            cardId: "card-1",
            cardTitle: "주간 보고서",
            boardSlug: "deskrpg-ch",
            npcName: "소피",
          },
        })}
        onOpenCard={(cardId, boardSlug) => opened.push(`${cardId}@${boardSlug}`)}
      />,
      locale,
    );
    const text = host.textContent ?? "";
    assert.ok(text.includes("주간 보고서"), `${locale}: 카드 제목이 문장에 없다`);
    assert.ok(text.includes(CARD_DONE_HINT[locale]), `${locale}: 로케일 문장이 아니다 — ${text}`);
    assert.ok(!text.includes("소피: 주간"), `${locale}: system 접두가 붙은 content 를 그대로 썼다`);
    const button = host.querySelector("button");
    assert.ok(button, `${locale}: 카드 열기 링크가 없다`);
    await act(async () => button!.click());
    assert.deepEqual(opened, ["card-1@deskrpg-ch"]);
    await cleanup();
  }
});

test("card_blocked — 네 로케일 모두 막힘 문장 (R29)", async () => {
  for (const locale of LOCALES) {
    const { host, cleanup } = await render(
      <RoomNoticeMessage
        message={message({
          notice: {
            kind: "card_blocked",
            cardId: "card-2",
            cardTitle: "Deploy",
            boardSlug: "b",
            npcName: "Sophie",
          },
        })}
      />,
      locale,
    );
    const text = host.textContent ?? "";
    assert.ok(text.includes("Deploy"), `${locale}: 카드 제목이 없다`);
    assert.ok(
      text.includes(CARD_BLOCKED_HINT[locale]),
      `${locale}: 로케일 문장이 아니다 — ${text}`,
    );
    assert.equal(host.querySelector("button"), null, "핸들러가 없으면 링크도 없다");
    assert.equal(
      host.querySelector("[data-room-notice]")?.getAttribute("data-room-notice"),
      "card_blocked",
    );
    await cleanup();
  }
});

test("cron_result — 헤더에 잡 이름, 본문은 content 그대로, error 면 실패 배지, 이력 열기 (R30)", async () => {
  for (const locale of LOCALES) {
    const opened: string[] = [];
    const { host, cleanup } = await render(
      <RoomNoticeMessage
        message={message({
          senderKind: "system",
          senderId: null,
          content: "결과 본문 라인",
          notice: {
            kind: "cron_result",
            jobId: "job-9",
            jobName: "아침 브리핑",
            npcName: "소피",
            status: "error",
          },
        })}
        onOpenCronJob={(jobId) => opened.push(jobId)}
      />,
      locale,
    );
    const text = host.textContent ?? "";
    assert.ok(text.includes("아침 브리핑"), `${locale}: 잡 이름이 헤더에 없다`);
    assert.ok(text.includes("결과 본문 라인"), `${locale}: 본문이 그대로 나오지 않는다`);
    assert.ok(
      host.querySelector('[data-testid="notice-cron-failed"]'),
      `${locale}: 실패 배지가 없다`,
    );
    const button = host.querySelector("button");
    assert.ok(button, `${locale}: 이력 열기 링크가 없다`);
    await act(async () => button!.click());
    assert.deepEqual(opened, ["job-9"]);
    await cleanup();
  }
});

test("cron_result ok — 실패 배지가 없다", async () => {
  const { host, cleanup } = await render(
    <RoomNoticeMessage
      message={message({
        content: "ok body",
        notice: { kind: "cron_result", jobId: "j", jobName: "n", npcName: "소피", status: "ok" },
      })}
    />,
    "ko",
  );
  assert.equal(host.querySelector('[data-testid="notice-cron-failed"]'), null);
  assert.ok((host.textContent ?? "").includes("ok body"));
  await cleanup();
});

test("알 수 없는 notice.kind — content 폴백, 링크 없음", async () => {
  const { host, cleanup } = await render(
    <RoomNoticeMessage
      message={message({
        content: "raw fallback",
        // 서버가 나중에 더한 kind 를 옛 클라이언트가 만나는 경우.
        notice: { kind: "something_new" } as unknown as RoomMessage["notice"],
      })}
      onOpenCard={() => assert.fail("호출되면 안 된다")}
      onOpenCronJob={() => assert.fail("호출되면 안 된다")}
    />,
    "en",
  );
  assert.ok((host.textContent ?? "").includes("raw fallback"));
  assert.equal(host.querySelector("button"), null);
  assert.equal(
    host.querySelector("[data-room-notice]")?.getAttribute("data-room-notice"),
    "unknown",
  );
  await cleanup();
});
