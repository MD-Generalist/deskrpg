import "../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import type { RoomState } from "@/app/game/room-state";
import type { RoomSummary } from "@/lib/chat-rooms-policy";
import type { ReportItem } from "@/game/report-queue";
import ChatPanel from "./ChatPanel";
import ReportBadge from "./report/ReportBadge";
import { tabFor } from "./chat/npc-tab-state";
import { openCardTarget } from "./kanban/open-card-target";

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
function panel(roomState: RoomState, props: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  return (
    <I18nProvider initialLocale="ko">
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
        {...props}
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

// R29·R30: `notice` 가 있는 줄만 알림 렌더러로 가고, 없는 줄은 예전 그대로다(system 줄 포함).
test("방 메시지 — notice 가 있으면 알림 렌더러, 없으면 기존 렌더 그대로", async () => {
  const opened: string[] = [];
  const state: RoomState = {
    ...listState(),
    view: "room",
    messages: {
      g1: [
        {
          id: "plain-npc",
          roomId: "g1",
          senderKind: "npc",
          senderId: "n1",
          senderName: "Sophie",
          content: "plain npc line",
          createdAt: "2026-09-10T00:00:00Z",
        },
        {
          id: "plain-system",
          roomId: "g1",
          senderKind: "system",
          senderId: null,
          senderName: "",
          content: JSON.stringify({ kind: "left", name: "Other" }),
          createdAt: "2026-09-10T00:00:01Z",
        },
        {
          id: "notice-card",
          roomId: "g1",
          senderKind: "system",
          senderId: null,
          senderName: "Sophie",
          content: "Sophie: 주간 보고서",
          createdAt: "2026-09-10T00:00:02Z",
          notice: {
            kind: "card_done",
            cardId: "card-1",
            cardTitle: "주간 보고서",
            boardSlug: "b",
            npcName: "Sophie",
          },
        },
      ],
    },
  };
  const el = await mount(
    <I18nProvider initialLocale="ko">
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
        onOpenNoticeCard={(cardId) => opened.push(cardId)}
      />
    </I18nProvider>,
  );
  // notice 없는 NPC 줄은 말풍선 그대로.
  assert.ok(
    Array.from(el.querySelectorAll('[data-chat-bubble="npc"]')).some((b) =>
      (b.textContent ?? "").includes("plain npc line"),
    ),
    "일반 NPC 줄이 말풍선으로 남아야 한다",
  );
  // notice 없는 system 줄은 기존 시스템 문장.
  assert.match(el.textContent ?? "", /Other 님이 나갔습니다/);
  // notice 줄은 알림 렌더러 — content 의 접두가 아니라 로케일 문장.
  const notice = el.querySelector('[data-room-notice="card_done"]');
  assert.ok(notice, "알림 렌더러가 그리지 않았다");
  assert.match(notice!.textContent ?? "", /카드를 완료했습니다: 주간 보고서/);
  assert.doesNotMatch(el.textContent ?? "", /Sophie: 주간 보고서/);
  await click(buttonByText(el, "카드 열기"));
  assert.deepEqual(opened, ["card-1"]);
});

function npcDialog(props: {
  npcArtifactChips?: Array<{ artifactId: string; title: string }>;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  return (
    <I18nProvider initialLocale="ko">
      <ChatPanel
        dialogNpc={{ npcId: "npc-a", npcName: "소피" }}
        npcMessages={[
          { id: "m1", role: "player", content: "대시보드 만들어 줘" },
          { id: "m2", role: "npc", content: "만들었습니다" },
        ]}
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
        {...props}
      />
    </I18nProvider>
  );
}

test("대화 중 NPC 의 결과물 칩을 마지막 NPC 답변 아래에 그리고 누르면 onOpenArtifact", async () => {
  const opened: string[] = [];
  const el = await mount(
    npcDialog({
      npcArtifactChips: [{ artifactId: "a1", title: "대시보드" }],
      onOpenArtifact: (id) => void opened.push(id),
    }),
  );
  const chip = buttonByText(el, "결과물 저장됨: 대시보드");
  // 마지막 NPC 답변 뒤에 온다.
  const answer = Array.from(el.querySelectorAll("*")).find(
    (node) => node.children.length === 0 && node.textContent === "만들었습니다",
  );
  assert.ok(answer);
  assert.ok(answer.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING);
  await click(chip);
  assert.deepEqual(opened, ["a1"]);
});

test("칩이 없거나 onOpenArtifact 가 없으면 칩을 그리지 않는다", async () => {
  const el = await mount(
    npcDialog({ npcArtifactChips: [{ artifactId: "a1", title: "대시보드" }] }),
  );
  assert.equal(
    Array.from(el.querySelectorAll("button")).some((b) =>
      (b.textContent ?? "").startsWith("결과물 저장됨"),
    ),
    false,
  );
});

// ── 아바타 ────────────────────────────────────────────────────────────────────

function avatarPanel(roomState: RoomState, extra: Record<string, unknown> = {}) {
  const asked: Array<{ kind: string; id?: string | null; name: string }> = [];
  const node = (
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
        channelChatOpen
        currentPlayerName="단테"
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
        avatarFor={(who) => {
          asked.push(who);
          return null;
        }}
        {...extra}
      />
    </I18nProvider>
  );
  return { node, asked };
}

function roomMessage(id: string, kind: "user" | "npc", senderId: string, senderName: string) {
  return {
    id,
    roomId: "g1",
    senderKind: kind,
    senderId,
    senderName,
    content: `${senderName} 의 말 ${id}`,
    createdAt: "2026-09-20T00:00:00.000Z",
  };
}

test("방 말풍선 — 상대에게만 아바타, 같은 발화자가 이어 말하면 자리만 남긴다", async () => {
  const state: RoomState = {
    rooms: [room("g1", "group", "기획팀")],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "room",
    messages: {
      g1: [
        roomMessage("m1", "npc", "npc-noah", "noah"),
        roomMessage("m2", "npc", "npc-noah", "noah"),
        roomMessage("m3", "user", "u1", "단테"),
        roomMessage("m4", "npc", "npc-sophie", "sophie"),
      ],
    },
  };
  const { node, asked } = avatarPanel(state);
  const el = await mount(node);
  const slots = [...el.querySelectorAll("[data-chat-avatar]")].map((n) =>
    n.getAttribute("data-chat-avatar"),
  );
  assert.deepEqual(
    slots,
    ["shown", "spacer", "shown"],
    "noah·(noah 이어서)·sophie — 내 말에는 없다",
  );
  assert.ok(
    asked.some((who) => who.kind === "npc" && who.id === "npc-noah"),
    "발화자 id 로 외형을 묻는다",
  );
});

test("NPC DM — 헤더 이름 앞과 상대 말풍선에 아바타가 붙는다", async () => {
  const state: RoomState = {
    rooms: [room("office", "office", "오피스")],
    viewerUserId: "u1",
    currentRoomId: "office",
    view: "room",
    messages: {},
  };
  const { node, asked } = avatarPanel(state, {
    dialogNpc: { npcId: "npc-noah", npcName: "noah" },
    npcMessages: [
      { id: "a", role: "player", content: "안녕" },
      { id: "b", role: "npc", content: "안녕하세요" },
      { id: "c", role: "npc", content: "무엇을 도울까요" },
    ],
  });
  const el = await mount(node);
  assert.ok(el.querySelector("[data-chat-header-avatar]"), "DM 헤더에 아바타가 없다");
  const slots = [...el.querySelectorAll("[data-chat-avatar]")].map((n) =>
    n.getAttribute("data-chat-avatar"),
  );
  assert.deepEqual(slots, ["shown", "spacer"]);
  assert.ok(asked.every((who) => who.id === "npc-noah"));
});

test("방 헤더 — 참여자를 최대 5명까지 겹쳐 쌓고 나머지는 +N", async () => {
  const members = Array.from({ length: 7 }, (_, i) => ({
    kind: "npc" as const,
    id: `npc-${i}`,
    name: `직원${i}`,
  }));
  const state: RoomState = {
    rooms: [{ ...room("g1", "group", "기획팀"), members }],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "room",
    messages: {},
  };
  const { node } = avatarPanel(state);
  const el = await mount(node);
  const stack = el.querySelector("[data-room-avatars]");
  assert.ok(stack, "방 헤더에 아바타 묶음이 없다");
  assert.equal(stack.querySelectorAll("[data-room-avatar]").length, 5);
  assert.equal(stack.querySelector("[data-room-avatar-more]")?.textContent, "+2");
});

test("avatarFor 가 없으면 아바타를 그리지 않는다 — 기존 화면 그대로", async () => {
  const state: RoomState = {
    rooms: [room("g1", "group", "기획팀")],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "room",
    messages: { g1: [roomMessage("m1", "npc", "npc-noah", "noah")] },
  };
  const { node } = avatarPanel(state, { avatarFor: undefined });
  const el = await mount(node);
  assert.equal(el.querySelector("[data-chat-avatar]"), null);
  assert.equal(el.querySelector("[data-room-avatars]"), null);
});

// ---------------------------------------------------------------------------
// T6 — 카드 탭 배선과 배지
// ---------------------------------------------------------------------------

function cardsPanel(
  extra: Partial<React.ComponentProps<typeof ChatPanel>> = {},
): React.ReactElement {
  return (
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
        {...extra}
      />
    </I18nProvider>
  );
}

/** 이 블록의 테스트는 탭 줄만 본다 — 탭을 열면 나가는 조회는 빈 응답으로 막는다. */
async function withStubbedFetch<T>(run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ columns: [], npcs: [], jobs: [] }), {
      status: 200,
    })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("탭이 셋이다", async () => {
  const el = await mount(cardsPanel());
  assert.equal(el.querySelectorAll('[data-testid="npc-dialog-tabs"] [role="tab"]').length, 3);
});

test("미확인 개수가 배지로 보이고 0 이면 배지가 없다", async () => {
  const el = await mount(cardsPanel({ badges: { cards: 3, cron: 0 } }));
  assert.equal(el.querySelector('[data-badge="cards"]')?.textContent, "3");
  assert.equal(el.querySelector('[data-badge="cron"]'), null);
});

test("탭을 열면 그 탭의 열람이 기록된다 — 대화 탭은 기록하지 않는다", async () => {
  await withStubbedFetch(async () => {
    const posted: string[] = [];
    const el = await mount(cardsPanel({ onMarkSeen: (tab) => posted.push(tab) }));
    await click(el.querySelector('[role="tab"][data-tab="cards"]')!);
    assert.deepEqual(posted, ["cards"]);
    await click(el.querySelector('[role="tab"][data-tab="chat"]')!);
    assert.deepEqual(posted, ["cards"]);
  });
});

test("카드 탭은 보드를 조회해 담당 카드를 그리고, 누르면 그 카드를 지목한다", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input.toString());
    return new Response(
      JSON.stringify({
        columns: [
          {
            status: "todo",
            tasks: [
              { id: "t1", title: "주간 보고서", status: "todo", assignee: "sophie" },
              { id: "t2", title: "남의 것", status: "todo", assignee: "noah" },
            ],
          },
        ],
        npcs: [{ npcId: "npc-a", npcName: "소피", profileName: "sophie", active: true }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const opened: string[] = [];
    const el = await mount(cardsPanel({ onOpenAssignedCard: (taskId) => opened.push(taskId) }));
    await click(el.querySelector('[role="tab"][data-tab="cards"]')!);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(urls, ["/api/channels/ch1/kanban/board"]);
    const cards = el.querySelectorAll('[data-testid="npc-cards-tab"] [data-card-id]');
    assert.equal(cards.length, 1, "담당 카드만 보여야 한다");
    await click(cards[0]);
    assert.deepEqual(opened, ["t1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("보드 조회가 막히면 서버가 준 코드를 그대로 카드 탭에 넘긴다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: "board_unavailable", message: "not ready" }), {
      status: 503,
    })) as typeof fetch;
  try {
    const el = await mount(cardsPanel());
    await click(el.querySelector('[role="tab"][data-tab="cards"]')!);
    await act(async () => {
      await Promise.resolve();
    });
    const alert = el.querySelector('[data-testid="cards-error"]');
    assert.ok(alert, "게이트 안내가 보이지 않는다");
    // `board_unavailable` 전용 문구 — 일반 폴백("알 수 없는 오류")으로 떨어지면 안 된다.
    assert.match(alert.textContent ?? "", /보드/);
    assert.equal(el.querySelector('[data-testid="cards-empty"]'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("직원을 바꾸면 탭이 chat 으로 돌아간다", () => {
  // 기존 동작(탭 선택이 npcId 로 묶여 있다)을 깨지 않는다.
  assert.equal(tabFor({ npcId: "n1", tab: "cards" }, "n2"), "chat");
  assert.equal(tabFor({ npcId: "n1", tab: "cards" }, "n1"), "cards");
});

test("닫힌 보드는 initialTaskId, 열린 보드는 focusRequest 로 지목한다", () => {
  const closed = openCardTarget({ boardOpen: false, taskId: "t1" });
  assert.equal(closed.initialTaskId, "t1");
  assert.equal(closed.focusRequest, null);
  const open = openCardTarget({ boardOpen: true, taskId: "t1", prev: closed });
  assert.equal(open.initialTaskId, null);
  assert.equal(open.focusRequest?.taskId, "t1");
  // 같은 카드를 다시 눌러도 새 요청이다 — seq 가 오른다.
  assert.equal(openCardTarget({ boardOpen: true, taskId: "t1", prev: open }).focusRequest?.seq, 2);
});

// ---------------------------------------------------------------------------
// 카드 제안 해소 배선 (T7)
// ---------------------------------------------------------------------------

function proposalState(): RoomState {
  return {
    ...listState(),
    view: "room",
    messages: {
      g1: [
        {
          id: "notice-proposal",
          roomId: "g1",
          senderKind: "npc",
          senderId: "n1",
          senderName: "소피",
          content: "청구서 정리",
          createdAt: "2026-09-21T00:00:00Z",
          notice: {
            kind: "card_proposal",
            proposalId: "cp_1",
            title: "청구서 정리",
            summary: "세 단계짜리 일입니다",
            npcId: "n1",
            npcName: "소피",
          },
        },
      ],
    },
  };
}

function proposalPanel(opts: { onRoomSend?: (message: string) => void } = {}) {
  return (
    <I18nProvider initialLocale="ko">
      <ChatPanel
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={proposalState()}
        channelChatOpen
        onRoomSend={opts.onRoomSend ?? (() => {})}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
        cron={{ channelId: "ch-1" }}
      />
    </I18nProvider>
  );
}

test("제안 알림 — 등록 버튼이 해소 라우트를 부르고 성공하면 결정이 보인다", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ choice: "card", taskId: "t-9", assigneeDropped: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const el = await mount(proposalPanel());
    const register = buttonByText(el, "이슈카드등록");
    assert.equal(register.disabled, false);
    await click(register);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/channels/ch-1/kanban/proposals/cp_1/resolve");
    assert.deepEqual(JSON.parse(calls[0].body), { choice: "card" });
    // 결정이 보이고 버튼은 사라진다 — 카드 번호까지.
    assert.equal(el.querySelectorAll("[data-testid='card-proposal'] button").length, 0);
    assert.match(el.querySelector("[data-testid='card-proposal-resolved']")!.textContent!, /t-9/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("제안 알림 — 여기서 처리는 같은 방에 그 직원을 지명한 후속 메시지를 보낸다", async () => {
  const originalFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choice: "inline" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const el = await mount(proposalPanel({ onRoomSend: (message) => sent.push(message) }));
    await click(buttonByText(el, "여기서 처리"));
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^@\[소피\] /);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("제안 알림 — 서버가 409 로 거절하면 안내를 보이고 버튼을 남긴다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: "already_resolved", message: "already" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const el = await mount(proposalPanel());
    await click(buttonByText(el, "이슈카드등록"));
    const error = el.querySelector("[data-testid='card-proposal-error']");
    assert.ok(error);
    assert.doesNotMatch(error.textContent!, /already_resolved/);
    // 버튼이 남아 다시 고를 수 있다.
    assert.equal(el.querySelectorAll("[data-testid='card-proposal'] button").length, 2);
    assert.equal(buttonByText(el, "이슈카드등록").disabled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 카드 탭 목록이 `kanban:event` 로 갱신된다 — 배지만 오르고 목록이 낡는 상태를 없앤다.
// ---------------------------------------------------------------------------

/** prop 을 바꿔 다시 그릴 수 있는 mount. 배선이 올려 주는 tick 을 흉내낸다. */
async function mountRerender(
  node: React.ReactElement,
): Promise<{ el: HTMLElement; render: (next: React.ReactElement) => Promise<void> }> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(node);
  });
  return {
    el,
    render: async (next) => {
      await act(async () => {
        root.render(next);
      });
    },
  };
}

/** 디바운스가 지나고 그 뒤 조회까지 끝나기를 기다린다. */
async function settle(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** 담당 카드 `titles` 를 가진 보드를 돌려주는 fetch. 호출된 URL 을 모은다. */
function boardFetch(titlesByCall: string[][]): { urls: string[]; fetch: typeof fetch } {
  const urls: string[] = [];
  let call = 0;
  const impl = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input.toString());
    const titles = titlesByCall[Math.min(call, titlesByCall.length - 1)] ?? [];
    call += 1;
    return new Response(
      JSON.stringify({
        columns: [
          {
            status: "todo",
            tasks: titles.map((title, i) => ({
              id: `t${i + 1}`,
              title,
              status: "todo",
              assignee: "sophie",
            })),
          },
        ],
        npcs: [{ npcId: "npc-a", npcName: "소피", profileName: "sophie", active: true }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { urls, fetch: impl };
}

function cardTitles(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('[data-testid="npc-cards-tab"] [data-card-id]')).map(
    (node) => (node.textContent ?? "").trim(),
  );
}

test("카드 탭을 열어 둔 채 kanban:event 가 오면 목록이 다시 읽힌다", async () => {
  const originalFetch = globalThis.fetch;
  const server = boardFetch([["주간 보고서"], ["주간 보고서", "새로 배정된 카드"]]);
  globalThis.fetch = server.fetch;
  try {
    const view = await mountRerender(cardsPanel({ cardsRefreshTick: 0, cardsDebounceMs: 5 }));
    await click(view.el.querySelector('[role="tab"][data-tab="cards"]')!);
    await settle(20);
    assert.equal(cardTitles(view.el).length, 1);

    await view.render(cardsPanel({ cardsRefreshTick: 1, cardsDebounceMs: 5 }));
    await settle(30);
    assert.equal(
      cardTitles(view.el).length,
      2,
      "사건이 왔는데 목록이 그대로다 — 배지만 오르고 목록이 낡는다",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("사건이 몰아쳐도 보드 조회는 묶여서 한 번만 나간다", async () => {
  const originalFetch = globalThis.fetch;
  const server = boardFetch([["주간 보고서"]]);
  globalThis.fetch = server.fetch;
  try {
    const view = await mountRerender(cardsPanel({ cardsRefreshTick: 0, cardsDebounceMs: 30 }));
    await click(view.el.querySelector('[role="tab"][data-tab="cards"]')!);
    await settle(10);
    const afterOpen = server.urls.length;

    for (const tick of [1, 2, 3, 4]) {
      await view.render(cardsPanel({ cardsRefreshTick: tick, cardsDebounceMs: 30 }));
    }
    await settle(60);
    assert.equal(
      server.urls.length - afterOpen,
      1,
      "사건 수만큼 보드를 읽고 있다 — 이 조회는 서버에서 Hermes 를 부른다",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("카드 탭을 열지 않았으면 사건이 와도 보드를 읽지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  const server = boardFetch([[]]);
  globalThis.fetch = server.fetch;
  try {
    const view = await mountRerender(cardsPanel({ cardsRefreshTick: 0, cardsDebounceMs: 5 }));
    await view.render(cardsPanel({ cardsRefreshTick: 1, cardsDebounceMs: 5 }));
    await settle(20);
    assert.deepEqual(server.urls, [], "닫힌 탭이 보드를 읽고 있다");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("다시 읽는 동안에도 이전 목록이 남는다 — 빈 목록으로 단정하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  // 둘째 조회를 붙잡아 둘 문. 콜백 안에서 대입하면 TS 가 `never` 로 좁히므로 미리 만든다.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input.toString());
    const body = JSON.stringify({
      columns: [
        {
          status: "todo",
          tasks: [{ id: "t1", title: "주간 보고서", status: "todo", assignee: "sophie" }],
        },
      ],
      npcs: [{ npcId: "npc-a", npcName: "소피", profileName: "sophie", active: true }],
    });
    // 둘째 조회는 붙잡아 둔다 — 그 사이 화면이 어떻게 보이는지가 이 테스트의 전부다.
    if (urls.length === 2) await held;
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  try {
    const view = await mountRerender(cardsPanel({ cardsRefreshTick: 0, cardsDebounceMs: 5 }));
    await click(view.el.querySelector('[role="tab"][data-tab="cards"]')!);
    await settle(20);
    assert.equal(cardTitles(view.el).length, 1);

    await view.render(cardsPanel({ cardsRefreshTick: 1, cardsDebounceMs: 5 }));
    await settle(20);
    assert.equal(urls.length, 2, "둘째 조회가 나가야 한다");
    assert.equal(cardTitles(view.el).length, 1, "재조회 중에 목록이 비었다");
    assert.equal(view.el.querySelector('[data-testid="cards-empty"]'), null);
    release();
    await settle(10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("사건이 없으면 탭을 열어 둔 채 시간이 흘러도 보드를 다시 읽지 않는다 — 폴링하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  const server = boardFetch([["주간 보고서"]]);
  globalThis.fetch = server.fetch;
  try {
    const view = await mountRerender(cardsPanel({ cardsRefreshTick: 0, cardsDebounceMs: 5 }));
    await click(view.el.querySelector('[role="tab"][data-tab="cards"]')!);
    await settle(20);
    const afterOpen = server.urls.length;
    await settle(60);
    assert.equal(server.urls.length, afterOpen, "이 조회는 서버에서 Hermes 보드를 읽는다");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("탭을 닫아 둔 사이 사건이 지나가도, 같은 직원의 탭을 다시 열 때 보드는 한 번만 읽는다", async () => {
  const originalFetch = globalThis.fetch;
  const server = boardFetch([["주간 보고서"], ["주간 보고서"], ["주간 보고서"]]);
  globalThis.fetch = server.fetch;
  try {
    const view = await mountRerender(cardsPanel({ cardsRefreshTick: 1, cardsDebounceMs: 5 }));
    await click(view.el.querySelector('[role="tab"][data-tab="cards"]')!);
    await settle(30);
    assert.equal(server.urls.length, 1);

    // 대화 탭으로 돌아간 사이 사건이 지나간다 — 닫힌 탭은 읽지 않는다.
    await click(view.el.querySelector('[role="tab"][data-tab="chat"]')!);
    await view.render(cardsPanel({ cardsRefreshTick: 2, cardsDebounceMs: 5 }));
    await settle(30);
    assert.equal(server.urls.length, 1, "닫힌 탭이 보드를 읽었다");

    // 다시 열면 그 순간이 최신이다 — 열기 조회 하나로 끝나야 한다.
    await click(view.el.querySelector('[role="tab"][data-tab="cards"]')!);
    await settle(30);
    assert.equal(server.urls.length, 2, "다시 여는 것만으로 보드를 두 번 읽는다");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("사건이 이미 지나간 뒤 탭을 열어도 보드는 한 번만 읽는다 — 그 뒤 새 사건에는 반응한다", async () => {
  const originalFetch = globalThis.fetch;
  const server = boardFetch([["주간 보고서"]]);
  globalThis.fetch = server.fetch;
  try {
    // 대화창을 열기 전에 사건이 세 번 지나갔다 — tick 은 세션 동안 오르기만 한다.
    const view = await mountRerender(cardsPanel({ cardsRefreshTick: 3, cardsDebounceMs: 5 }));
    await click(view.el.querySelector('[role="tab"][data-tab="cards"]')!);
    await settle(30);
    assert.equal(
      server.urls.length,
      1,
      "탭을 여는 것만으로 보드를 두 번 읽는다 — 새 사건은 없었다",
    );

    await view.render(cardsPanel({ cardsRefreshTick: 4, cardsDebounceMs: 5 }));
    await settle(30);
    assert.equal(server.urls.length, 2, "탭을 연 뒤의 새 사건에는 반응해야 한다");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("보고하러 온 직원의 대화창은 맨 위에 그 보고의 요약과 열기 링크를 보여 준다", async () => {
  const opened: [string, string][] = [];
  const report = {
    messageId: "m1",
    npcId: "sophie",
    npcName: "소피",
    kind: "card_review" as const,
    cardId: "card-1",
    boardSlug: "board-1",
    jobId: null,
    cardTitle: "목차 초안",
    summary: "목차 7개 장을 정리했습니다",
    createdAt: "2026-09-21T01:00:00Z",
  };
  const withDialog = (dialogReport: typeof report | null) => (
    <I18nProvider>
      <ChatPanel
        dialogNpc={{ npcId: "sophie", npcName: "소피" }}
        dialogReport={dialogReport}
        onOpenNoticeCard={(cardId, boardSlug) => opened.push([cardId, boardSlug])}
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
    </I18nProvider>
  );
  const el = await mount(withDialog(report));
  const summary = el.querySelector('[data-testid="dialog-report-summary"]');
  assert.ok(summary, "보고 요약이 보여야 한다");
  assert.match(summary.textContent ?? "", /목차 초안/);
  assert.match(summary.textContent ?? "", /목차 7개 장을 정리했습니다/);
  await click(el.querySelector('[data-testid="dialog-report-open"]')!);
  assert.deepEqual(opened, [["card-1", "board-1"]]);

  const plain = await mount(withDialog(null));
  assert.equal(plain.querySelector('[data-testid="dialog-report-summary"]'), null);
});

test("모달이 떠 있으면 Esc 는 모달만 닫고 뒤의 직원 대화창은 닫지 않는다", async () => {
  let closed = 0;
  const node = (
    <I18nProvider>
      <ChatPanel
        dialogNpc={{ npcId: "sophie", npcName: "소피" }}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {
          closed += 1;
        }}
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
    </I18nProvider>
  );
  await mount(node);
  const modal = document.createElement("div");
  modal.setAttribute("aria-modal", "true");
  document.body.appendChild(modal);
  const esc = () =>
    act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
  await esc();
  assert.equal(closed, 0, "모달이 있으면 대화창은 그대로다");
  modal.remove();
  await esc();
  assert.equal(closed, 1, "모달이 없으면 Esc 가 대화창을 닫는다");
});

test("보고 목록 팝오버가 열려 있으면 Esc 는 목록만 닫고 대화창은 남는다", async () => {
  let closed = 0;
  const item: ReportItem = {
    messageId: "m1",
    npcId: "oliver",
    npcName: "올리버",
    kind: "card_done",
    cardId: "c-1",
    boardSlug: "b",
    jobId: null,
    cardTitle: "본문 초안",
    summary: "",
    createdAt: "2026-09-21T01:00:00Z",
  };
  const el = await mount(
    <I18nProvider>
      <ReportBadge
        queue={[item]}
        current={null}
        dismissedIds={new Set()}
        onOpen={() => {}}
        onRecall={() => {}}
      />
      <ChatPanel
        dialogNpc={{ npcId: "sophie", npcName: "소피" }}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {
          closed += 1;
        }}
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
  await act(async () => {
    el.querySelector('[data-testid="report-badge"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  assert.ok(el.querySelector('[data-testid="report-list"]'), "배지를 누르면 목록이 열린다");

  // 실제 브라우저처럼 한 이벤트가 본문에서 올라가 document 와 window 를 차례로 지난다.
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  assert.equal(
    el.querySelector('[data-testid="report-list"]'),
    null,
    "가장 위 레이어인 목록이 닫힌다",
  );
  assert.equal(closed, 0, "목록을 닫는 Esc 가 뒤의 대화창까지 닫으면 안 된다");

  // 실제 브라우저에서는 목록이 DOM 에서 사라진 뒤에 대화창 리스너가 돈다(2026-09-21 스테이징
  // 실측). 그때도 닫히지 않아야 하므로, 레이어가 Esc 를 소비한 상태를 그대로 세워 본다.
  const consume = (event: KeyboardEvent) => event.preventDefault();
  document.addEventListener("keydown", consume);
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  document.removeEventListener("keydown", consume);
  assert.equal(closed, 0, "레이어가 소비한 Esc 로는 대화창이 닫히지 않는다");

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert.equal(closed, 1, "목록이 닫힌 뒤에는 Esc 가 대화창을 닫는다");
});

test("완성된 답변의 카드 등록 버튼은 직전 요청과 답변을 확인 화면으로 넘긴다", async () => {
  let draft: { title: string; body: string; assigneeNpcId: string } | undefined;
  const el = await mount(
    panel(listState(), {
      dialogNpc: { npcId: "n1", npcName: "직원" },
      npcMessages: [
        { id: "original", role: "player", content: "주간 안내를 작성해 주세요" },
        {
          responseRequestId: "reply",
          role: "npc",
          content: "완료한 일과 다음 주 계획을 알려 주세요.",
        },
      ],
      npcResponses: [
        {
          requestId: "reply",
          sourceMessageId: "original",
          npcId: "n1",
          npcName: "직원",
          status: "complete",
          content: "완료한 일과 다음 주 계획을 알려 주세요.",
          updatedAt: 1,
        },
      ],
      onCreateTaskFromChat: (next) => {
        draft = next;
      },
    }),
  );
  await click(buttonByText(el, "카드로 등록"));
  assert.equal(draft?.title, "주간 안내를 작성해 주세요");
  assert.equal(draft?.assigneeNpcId, "n1");
  assert.match(draft?.body ?? "", /주간 안내를 작성해 주세요/);
  assert.match(draft?.body ?? "", /완료한 일과 다음 주 계획/);
});

test("스트리밍 중 답변에는 카드 등록 버튼을 보이지 않는다", async () => {
  const el = await mount(
    panel(listState(), {
      dialogNpc: { npcId: "n1", npcName: "직원" },
      npcMessages: [{ role: "npc", content: "작성 중" }],
      isNpcStreaming: true,
      onCreateTaskFromChat: () => {
        throw new Error("등록하면 안 된다");
      },
    }),
  );
  assert.equal(
    Array.from(el.querySelectorAll("button")).some((b) => b.textContent === "카드로 등록"),
    false,
  );
});

test("연속 요청 이력 A,B,답변A는 요청 식별자로 A에 연결한다", async () => {
  let draft: { title: string; body: string; assigneeNpcId: string } | undefined;
  const el = await mount(
    panel(listState(), {
      dialogNpc: { npcId: "n1", npcName: "직원" },
      npcMessages: [
        { id: "a", role: "player", content: "요청 A" },
        { id: "b", role: "player", content: "요청 B" },
        { id: "ra", responseRequestId: "r1", role: "npc", content: "A의 답변" },
      ],
      npcResponses: [
        {
          requestId: "r1",
          sourceMessageId: "a",
          npcId: "n1",
          npcName: "직원",
          status: "complete",
          content: "A의 답변",
          updatedAt: 1,
        },
      ],
      onCreateTaskFromChat: (next) => {
        draft = next;
      },
    }),
  );
  await click(buttonByText(el, "카드로 등록"));
  assert.equal(draft?.title, "요청 A");
  assert.doesNotMatch(draft?.body ?? "", /요청 B/);
});

test("연결 정보 없는 과거 답변은 인접 요청을 원문으로 단정하지 않는다", async () => {
  let body = "";
  const el = await mount(
    panel(listState(), {
      dialogNpc: { npcId: "n1", npcName: "직원" },
      npcMessages: [
        { role: "player", content: "다른 요청" },
        { role: "npc", content: "과거 답변" },
      ],
      onCreateTaskFromChat: (draft) => {
        body = draft.body;
      },
    }),
  );
  await click(buttonByText(el, "카드로 등록"));
  assert.doesNotMatch(body, /다른 요청/);
  assert.match(body, /원래 요청을 확인할 수 없습니다/);
  assert.match(body, /과거 답변/);
});
