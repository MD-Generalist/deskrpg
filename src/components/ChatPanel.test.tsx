import "../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import type { RoomState } from "@/app/game/room-state";
import type { RoomSummary } from "@/lib/chat-rooms-policy";
import ChatPanel from "./ChatPanel";

function room(id: string, kind: RoomSummary["kind"], name: string): RoomSummary {
  return {
    id,
    kind,
    name,
    replyPolicy: kind === "office" ? "mention" : "members",
    createdBy: "u1",
    lastMessageAt: null,
    members: [],
  };
}

function listState(): RoomState {
  return {
    rooms: [room("office", "office", "사무실"), room("g1", "group", "기획팀")],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "list",
    messages: {},
  };
}

// 필수 prop 만 채운 뼈대. 목록 뷰의 닫기 동작만 검증한다.
function panel(roomState: RoomState) {
  return (
    <I18nProvider>
      <ChatPanel
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={roomState}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
      />
    </I18nProvider>
  );
}

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(node);
  });
  return el;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  assert.ok(btn, `button "${text}" 를 찾지 못했다`);
  return btn as HTMLButtonElement;
}

async function click(node: Element) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const OPEN = "▶"; // ▶ 다시 열기
const BACK = "◀"; // ◀ 뒤로

test("방이 여러 개인 목록 뷰에서 ◀ 는 패널을 접는다 (I-2)", async () => {
  const el = await mount(panel(listState()));

  // 처음엔 닫혀 있고 다시 열기 버튼만 보인다.
  await click(buttonByText(el, OPEN));

  // 패널이 열리며 목록 헤더의 ◀ 가 나타난다.
  const back = buttonByText(el, BACK);
  await click(back);

  // 방이 2개여도 목록의 ◀ 는 패널을 닫아야 한다 — 다시 열기 버튼만 남는다.
  const reopen = Array.from(el.querySelectorAll("button")).filter(
    (b) => (b.textContent ?? "").trim() === OPEN,
  );
  assert.equal(reopen.length, 1, "패널이 접혀 다시 열기 버튼만 남아야 한다");
  assert.equal(
    Array.from(el.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === BACK),
    false,
    "접힌 패널에는 ◀ 가 없어야 한다",
  );
});

test("shared room shows responder receipt under another user's source message", async () => {
  const state: RoomState = {
    ...listState(),
    view: "room",
    messages: {
      g1: [
        {
          id: "source-other",
          roomId: "g1",
          senderKind: "user",
          senderId: "u2",
          senderName: "Other",
          content: "@Sophie help",
          createdAt: "2026-09-10T00:00:00Z",
        },
      ],
    },
  };
  const el = await mount(
    <I18nProvider>
      <ChatPanel
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={state}
        channelChatOpen
        roomResponses={[
          {
            requestId: "reply",
            sourceMessageId: "source-other",
            npcId: "n1",
            npcName: "Sophie",
            status: "thinking",
            content: "",
            updatedAt: 1,
          },
        ]}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
        currentPlayerName="Me"
      />
    </I18nProvider>,
  );
  assert.match(el.textContent ?? "", /👌 Sophie/);
});

test("workspace presentation stays open and renders as an embedded conversation surface", async () => {
  const el = await mount(
    <I18nProvider>
      <ChatPanel
        presentation="workspace"
        width={388}
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={listState()}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
      />
    </I18nProvider>,
  );

  const panel = el.querySelector<HTMLElement>("[data-chat-panel='workspace']");
  assert.ok(panel);
  assert.equal(panel.style.width, "388px");
  assert.doesNotMatch(panel.className, /fixed/);
  assert.equal(
    [...el.querySelectorAll("button")].some((node) => node.textContent?.trim() === OPEN),
    false,
  );
});

// ---------------------------------------------------------------------------
// T9 — NPC DM 의 크론 탭
// ---------------------------------------------------------------------------

function dmState(): RoomState {
  return { ...listState(), view: "room" };
}

test("cron 컨텍스트가 없으면 NPC DM 에 탭이 없다 (배선 전 동작 그대로)", async () => {
  const el = await mount(
    <I18nProvider initialLocale="ko">
      <ChatPanel
        dialogNpc={{ npcId: "npc-a", npcName: "소피" }}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={dmState()}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
      />
    </I18nProvider>,
  );
  assert.equal(el.querySelector('[data-testid="npc-dialog-tabs"]'), null);
  assert.equal(el.querySelector('[data-testid="cron-panel"]'), null);
});

test("cron 컨텍스트가 있으면 '크론' 탭이 그 NPC 것만 단일 모드로 연다 (R15)", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input.toString());
    return new Response(JSON.stringify({ jobs: [], timezone: "Asia/Seoul" }), { status: 200 });
  }) as typeof fetch;
  try {
    const el = await mount(
      <I18nProvider initialLocale="ko">
        <ChatPanel
          dialogNpc={{ npcId: "npc-a", npcName: "소피" }}
          npcMessages={[]}
          isNpcStreaming={false}
          onSend={() => {}}
          onClose={() => {}}
          npcSelectList={null}
          onSelectNpc={() => {}}
          roomState={dmState()}
          onRoomSend={() => {}}
          onRoomAction={() => {}}
          onRoomCreate={() => {}}
          onRoomInvite={() => {}}
          onRoomLeave={() => {}}
          onRoomRename={() => {}}
          onRoomDelete={() => {}}
          mentionCandidatesFor={() => []}
          onlinePlayers={[]}
          cron={{ channelId: "ch1" }}
        />
      </I18nProvider>,
    );
    const tabs = el.querySelector('[data-testid="npc-dialog-tabs"]');
    assert.ok(tabs, "탭 바가 있어야 한다");
    // 기본은 대화 탭 — 크론은 아직 조회하지 않는다.
    assert.equal(el.querySelector('[data-testid="cron-panel"]'), null);
    assert.equal(urls.length, 0);

    await click(buttonByText(el, "크론"));
    await act(async () => {
      await Promise.resolve();
    });
    assert.ok(el.querySelector('[data-testid="cron-panel"]'));
    assert.equal(
      el.querySelector('[data-testid="cron-filter-npc"]'),
      null,
      "단일 모드는 필터 없음",
    );
    assert.deepEqual(urls, ["/api/channels/ch1/cron/jobs?npcId=npc-a"]);

    // 대화 탭으로 돌아오면 입력창이 다시 보인다.
    await click(buttonByText(el, "대화"));
    assert.equal(el.querySelector('[data-testid="cron-panel"]'), null);
    assert.ok(el.querySelector("textarea"), "대화 입력창");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
