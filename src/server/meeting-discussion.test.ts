import assert from "node:assert/strict";
import test from "node:test";

import { AdapterRegistry } from "../lib/adapters/types";
import { createMeetingSpatialCoordinator } from "./meeting-spatial-coordinator";
import {
  defaultCreateMeetingBroker,
  meetingSessionScope,
  meetingSummarySessionScope,
  registerMeetingDiscussionHandlers,
  resolveNpcAdapter,
  type MeetingBrokerLike,
} from "./meeting-discussion";

type RecordedCall = {
  type: "emit";
  target: string;
  event: string;
  payload: unknown;
};

for (const stage of ["entry", "summary", "persist", "run-error"] as const) {
  test(`이전 브로커의 ${stage} 완료는 맵 교체 후 새 회의를 종료하지 않는다`, async () => {
    const calls: RecordedCall[] = [];
    const socket = createFakeSocket("socket-1", calls);
    const activeBrokers = new Map<string, MeetingBrokerLike>();
    const discussionInitiators = new Map<string, string>();
    const registry = new AdapterRegistry();
    registry.register(recordingAdapter(["ok"]));
    type Factory = NonNullable<
      Parameters<typeof registerMeetingDiscussionHandlers>[0]["deps"]["createMeetingBroker"]
    >;
    const callbacks: Parameters<Factory>[1][] = [];
    let resume!: () => void;
    const gate = new Promise<void>((r) => {
      resume = r;
    });
    let entered!: () => void;
    const waiting = new Promise<void>((r) => {
      entered = r;
    });
    let rejectRun!: (error: Error) => void;
    let persisted = 0;
    let cancelled = 0;
    const deps: Parameters<typeof registerMeetingDiscussionHandlers>[0]["deps"] = {
      activeBrokers,
      discussionInitiators,
      meetingRooms: new Map([["a", { participants: new Set(["socket-1"]), messages: [] }]]),
      players: new Map(),
      user: { userId: "u1" },
      adapterRegistry: registry,
      canControlMeeting: () => true,
      getNpcConfigsForChannel: async () => [npcConfig({ adapterType: "cli" })],
      createMeetingBroker: (_config, cb) => {
        callbacks.push(cb);
        const old = callbacks.length === 1;
        return {
          config: { participants: [{ npcId: "npc-1", displayName: "NPC" }] },
          turns: [],
          isRunning: () => true,
          stop: () => {},
          run: () =>
            old && stage === "run-error"
              ? new Promise<void>((_r, reject) => {
                  rejectRun = reject;
                })
              : Promise.resolve(),
        } as unknown as MeetingBrokerLike;
      },
      generateMeetingSummary: async () => {
        if (stage === "summary") {
          entered();
          await gate;
        }
        return { keyTopics: [], conclusions: null };
      },
      persistMeetingMinutes: async () => {
        persisted++;
        if (stage === "persist") {
          entered();
          await gate;
        }
        return null;
      },
    };
    registerMeetingDiscussionHandlers({ io: createFakeIo(calls), socket, deps });
    await socket.trigger("meeting:start-discussion", { channelId: "a", topic: "old" });
    let completion: void | Promise<void>;
    if (stage === "summary" || stage === "persist") {
      await socket.trigger("meeting:stop", { channelId: "a" });
      completion = callbacks[0].onMeetingEnd!("old transcript", 1);
      await waiting;
    }
    activeBrokers.delete("a");
    discussionInitiators.delete("a");
    await socket.trigger("meeting:start-discussion", { channelId: "a", topic: "fresh" });
    const fresh = activeBrokers.get("a");
    deps.spatial = {
      cancel: async () => {
        cancelled++;
      },
    } as unknown as ReturnType<typeof createMeetingSpatialCoordinator>;
    if (stage === "entry") await callbacks[0].onMeetingEnd!("old transcript", 1);
    else if (stage === "run-error") {
      rejectRun(new Error("old run failed"));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    } else {
      resume();
      await completion!;
    }
    assert.equal(activeBrokers.get("a"), fresh);
    assert.equal(discussionInitiators.get("a"), "u1");
    assert.equal(cancelled, 0);
    assert.equal(persisted, stage === "persist" ? 1 : 0);
    assert.equal(
      calls.filter((call) => ["meeting:end", "meeting:error"].includes(call.event)).length,
      0,
    );
    if (stage === "entry") {
      await socket.trigger("meeting:stop", { channelId: "a" });
      assert.equal(
        activeBrokers.get("a"),
        fresh,
        "정상 stop은 완료 콜백까지 현재 브로커를 유지한다",
      );
      await callbacks[1].onMeetingEnd!("fresh transcript", 2);
      assert.equal(activeBrokers.has("a"), false);
      assert.equal(calls.filter((call) => call.event === "meeting:end").length, 1);
      assert.equal(cancelled, 2);
    }
  });
}

function createFakeSocket(id: string, calls: RecordedCall[]) {
  const handlers = new Map<string, (payload: unknown) => unknown>();

  return {
    id,
    on(event: string, handler: (payload: unknown) => unknown) {
      handlers.set(event, handler);
    },
    emit(event: string, payload: unknown) {
      calls.push({ type: "emit", target: "self", event, payload });
    },
    async trigger(event: string, payload: unknown) {
      const handler = handlers.get(event);
      assert.ok(handler, `missing handler for ${event}`);
      await handler(payload);
    },
  };
}

function createFakeIo(calls: RecordedCall[]) {
  return {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          calls.push({ type: "emit", target: room, event, payload });
        },
      };
    },
  };
}

test("실제 집결 전 브로커를 만들지 않고 전원 도착 뒤 정확히 한 번 시작한다", async () => {
  const calls: RecordedCall[] = [];
  const socket = createFakeSocket("socket-1", calls);
  const spatial = createMeetingSpatialCoordinator({
    layout: async () => ({ spaceId: "meeting", targets: [{ x: 80, y: 80, seatId: "80:80" }] }),
    capture: async () => ({ x: 16, y: 16, seatId: null }),
    reserve: async () => true,
    move: async () => true,
    release: async () => {},
    returnTarget: async (_c, _a, p) => p,
    publish: () => {},
  });
  let created = 0,
    ran = 0;
  registerMeetingDiscussionHandlers({
    io: createFakeIo(calls),
    socket,
    deps: {
      activeBrokers: new Map(),
      discussionInitiators: new Map(),
      meetingRooms: new Map([["a", { participants: new Set(["socket-1"]), messages: [] }]]),
      players: new Map(),
      user: { userId: "u1" },
      adapterRegistry: new AdapterRegistry(),
      spatial,
      canStartMeeting: () => true,
      canControlMeeting: () => true,
      getNpcConfigsForChannel: async () => [
        { id: "n1", name: "NPC", agentId: null, sessionKeyPrefix: "a" },
      ],
      createMeetingBroker: () => {
        created++;
        return {
          config: { participants: [{ npcId: "n1", displayName: "NPC" }] },
          turns: [],
          run: async () => {
            ran++;
          },
          isRunning: () => true,
          stop: () => {},
        } as unknown as MeetingBrokerLike;
      },
      generateMeetingSummary: async () => ({ keyTopics: [], conclusions: null }),
      persistMeetingMinutes: async () => null,
    },
  });
  const pending = socket.trigger("meeting:start-discussion", {
    channelId: "a",
    topic: "topic",
    selectedNpcIds: ["n1"],
  });
  // 파일 I/O·실제 서버 없이 async 집결 예약의 마이크로태스크를 모두 진행한다.
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(created, 0);
  assert.equal(spatial.snapshot("a")?.phase, "assembling");
  await socket.trigger("meeting:start-discussion", {
    channelId: "a",
    topic: "duplicate",
    selectedNpcIds: ["n1"],
  });
  assert.equal(created, 0);
  spatial.arrived("a", "n1", spatial.snapshot("a")!.generation);
  await pending;
  assert.equal(created, 1);
  assert.equal(ran, 1);
});

test("registerMeetingDiscussionHandlers starts a broker and emits mode change", async () => {
  const calls: RecordedCall[] = [];
  const activeBrokers = new Map<string, MeetingBrokerLike>();
  const discussionInitiators = new Map<string, string>();
  const meetingRooms = new Map([
    [
      "channel-1",
      {
        participants: new Set(["socket-1"]),
        messages: [],
      },
    ],
  ]);
  const players = new Map([
    [
      "socket-1",
      {
        characterName: "Dante",
      },
    ],
  ]);

  let runCalled = false;
  let nextTurnCalls = 0;
  let directedCalls = 0;
  let allowedControl = true;
  let callbacks: Parameters<
    NonNullable<
      Parameters<typeof registerMeetingDiscussionHandlers>[0]["deps"]["createMeetingBroker"]
    >
  >[1];
  const socket = createFakeSocket("socket-1", calls);

  registerMeetingDiscussionHandlers({
    io: createFakeIo(calls),
    socket,
    deps: {
      activeBrokers,
      discussionInitiators,
      meetingRooms,
      players,
      user: { userId: "user-1", nickname: "Dante" },
      adapterRegistry: new AdapterRegistry(),
      getNpcConfigsForChannel: async () => [
        {
          id: "npc-1",
          name: "Analyst",
          agentId: "agent-1",
          sessionKeyPrefix: "sess-1",
          adapterType: "openclaw",
          hermesProfileId: null,
          role: "Participant",
          passPolicy: null,
        },
      ],
      canControlMeeting: async () => allowedControl,
      createMeetingBroker: (_config, registeredCallbacks) => {
        callbacks = registeredCallbacks;
        return {
          config: {
            participants: [
              {
                npcId: "npc-1",
                displayName: "Analyst",
                role: "Participant",
                passPolicy: null,
                openclawAgentId: "agent-1",
              },
            ],
            sessionKeyPrefix: "sess-1",
            meetingId: "meet-1",
          },
          turns: [],
          isRunning: () => true,
          run: async () => {
            runCalled = true;
          },
          stop: () => {},
          setMode: () => {},
          nextTurn: () => {
            nextTurnCalls++;
          },
          directSpeak: () => {
            directedCalls++;
          },
          abortCurrentTurn: () => {},
          addUserMessage: () => {},
        };
      },
      generateMeetingSummary: async () => ({ keyTopics: [], conclusions: null }),
      persistMeetingMinutes: async () => null,
    },
  });

  await socket.trigger("meeting:start-discussion", {
    channelId: "channel-1",
    topic: "Roadmap sync",
    settings: { initialMode: "auto", maxTotalTurns: 6 },
  });

  assert.equal(runCalled, true);
  assert.ok(activeBrokers.has("channel-1"));
  assert.equal(discussionInitiators.get("channel-1"), "user-1");
  assert.deepEqual(activeBrokers.get("channel-1")?.discussionState?.npcs, [
    { id: "npc-1", name: "Analyst" },
  ]);
  const live = activeBrokers.get("channel-1")!.discussionState!;
  callbacks!.onWaitingInput?.(null);
  assert.equal(live.isWaitingInput, true);
  callbacks!.onTurnStart?.(activeBrokers.get("channel-1")!.config.participants[0]);
  assert.equal(live.isWaitingInput, false);
  assert.deepEqual(live.currentSpeaker, { npcId: "npc-1", npcName: "Analyst" });
  callbacks!.onTurnChunk?.("npc-1", "Hello ");
  callbacks!.onTurnChunk?.("npc-1", "world");
  assert.deepEqual(live.rawStreams, { "npc-1": "Hello world" });
  callbacks!.onTurnEnd?.("npc-1", "Hello world");
  assert.equal(live.currentSpeaker, null);
  assert.deepEqual(live.rawStreams, {});
  assert.equal(
    (meetingRooms.get("channel-1")!.messages as Array<{ content: string }>)[0].content,
    "Hello world",
  );
  callbacks!.onWaitingInput?.(null);
  assert.equal(live.isWaitingInput, true);

  await socket.trigger("meeting:next-turn", { channelId: "channel-1" });
  assert.equal(nextTurnCalls, 0, "auto cannot consume a manual next turn");
  callbacks!.onModeChanged?.("manual", "user");
  assert.equal(live.isWaitingInput, false);
  const modeEvent = calls.filter((call) => call.event === "meeting:mode-changed").at(-1)!
    .payload as {
    execution: { isWaitingInput: boolean; currentSpeaker: unknown };
  };
  assert.equal(modeEvent.execution.isWaitingInput, false);
  assert.equal(modeEvent.execution.currentSpeaker, null);
  await socket.trigger("meeting:next-turn", { channelId: "channel-1" });
  assert.equal(nextTurnCalls, 0, "polling/busy manual state cannot queue a release");
  callbacks!.onWaitingInput?.(null);
  allowedControl = false;
  await socket.trigger("meeting:next-turn", { channelId: "channel-1" });
  assert.equal(nextTurnCalls, 0);
  assert.equal(live.isWaitingInput, true, "denied requests do not consume readiness");
  allowedControl = true;
  await Promise.all([
    socket.trigger("meeting:next-turn", { channelId: "channel-1" }),
    socket.trigger("meeting:next-turn", { channelId: "channel-1" }),
  ]);
  assert.equal(nextTurnCalls, 1, "readiness is consumed before duplicate requests arrive");
  assert.equal(live.isWaitingInput, false);
  await socket.trigger("meeting:direct-speak", { channelId: "channel-1", npcId: "npc-1" });
  assert.equal(directedCalls, 1, "directed interruption remains allowed while busy");

  const started = calls.find((call) => call.event === "meeting:mode-changed")?.payload as {
    discussion?: { topic: string; npcs: unknown[] };
  };
  assert.equal(started.discussion?.topic, "Roadmap sync");
  assert.deepEqual(started.discussion?.npcs, [{ id: "npc-1", name: "Analyst" }]);
  assert.ok(
    calls.some(
      (call) =>
        call.target === "meeting-channel-1" &&
        call.event === "meeting:mode-changed" &&
        (call.payload as { mode?: string }).mode === "auto",
    ),
  );
});

// ---------------------------------------------------------------------------
// 해석/배선 레이어 — defaultCreateMeetingBroker + resolveNpcAdapter
// 이 층(디스패치 분류, 제외 사유, 어댑터 구성, 엔진 콜백 재매핑)은 이 커밋 전까지
// 어떤 테스트도 실행하지 않았다(M5).
// ---------------------------------------------------------------------------

type ExcludedNotice = { npcId: string; displayName: string; reason: string };

function npcConfig(over: Record<string, unknown> = {}) {
  return {
    id: "npc-1",
    name: "Analyst",
    agentId: null as string | null,
    sessionKeyPrefix: "sess-1",
    adapterType: "openclaw",
    hermesProfileId: null as string | null,
    role: "Participant",
    passPolicy: null as string | null,
    ...over,
  };
}

function recordingAdapter(replies: string[]) {
  const queue = [...replies];
  const prompts: string[] = [];
  return {
    type: "cli",
    prompts,
    async execute(options: { sessionKey: string; prompt: string }) {
      prompts.push(options.prompt);
      const text = queue.length > 1 ? queue.shift()! : queue[0];
      return { response: text, session: { sessionRef: options.sessionKey } };
    },
    async testConnection() {
      return { status: "ok" as const };
    },
  };
}

function brokerConfig(npcs: ReturnType<typeof npcConfig>[], over: Record<string, unknown> = {}) {
  return {
    topic: "Roadmap sync",
    npcs,
    userId: "user-1",
    channelId: "channel-1",
    adapterRegistry: new AdapterRegistry(),
    sessionKeyPrefix: "sess-1",
    meetingId: "meet-1",
    settings: {},
    quota: { maxTotalTurns: 4 },
    ...over,
  } as unknown as Parameters<typeof defaultCreateMeetingBroker>[0];
}

test("resolution layer: 제외 사유를 각각 그 사유로 통지한다", async () => {
  const registry = new AdapterRegistry();
  const excluded: ExcludedNotice[] = [];

  const broker = await defaultCreateMeetingBroker(
    brokerConfig(
      [
        npcConfig({ id: "n-unbound", name: "Unbound", adapterType: "unbound" }),
        npcConfig({
          id: "n-hermes",
          name: "Hermes",
          adapterType: "hermes",
          hermesProfileId: "p-1",
        }),
        // OpenClaw 제거 후: adapterType 이 openclaw 로 남아 있는 NPC 는 agentId 유무와
        // 무관하게 unbound 로 제외된다 — 쓸 백엔드가 더는 존재하지 않기 때문이다.
        npcConfig({
          id: "n-oc",
          name: "LegacyOpenClaw",
          adapterType: "openclaw",
          agentId: "agent-9",
        }),
        npcConfig({ id: "n-registry", name: "Registry", adapterType: "cli" }),
      ],
      { adapterRegistry: registry },
    ),
    { onParticipantsExcluded: (list: ExcludedNotice[]) => excluded.push(...list) },
    { createHermesAdapter: async () => null }, // 프로필 해석 실패를 흉내낸다
  );

  assert.deepEqual(
    excluded.map((e) => [e.npcId, e.reason]),
    [
      ["n-unbound", "unbound"],
      ["n-hermes", "hermes_profile_unavailable"],
      ["n-oc", "unbound"],
      ["n-registry", "adapter_unavailable"],
    ],
  );
  assert.deepEqual(broker.config.participants, [], "해석에 실패한 NPC는 참가자로 남지 않는다");
});

test("resolution layer: hermes / registry 디스패치가 각각 맞는 백엔드로 가고, openclaw 는 빠진다", async () => {
  const registry = new AdapterRegistry();
  registry.register(recordingAdapter(["PASS"]) as never);

  const hermesCalls: Array<[string, string, string]> = [];
  const broker = await defaultCreateMeetingBroker(
    brokerConfig(
      [
        npcConfig({
          id: "n-hermes",
          name: "Hermes",
          adapterType: "hermes",
          hermesProfileId: "p-1",
        }),
        npcConfig({
          id: "n-oc",
          name: "LegacyOpenClaw",
          adapterType: "openclaw",
          agentId: "agent-9",
        }),
        npcConfig({ id: "n-cli", name: "Cli", adapterType: "cli" }),
      ],
      { adapterRegistry: registry },
    ),
    {},
    {
      createHermesAdapter: async (npcId: string, userId: string, contextKey: string) => {
        hermesCalls.push([npcId, userId, contextKey]);
        return recordingAdapter(["PASS"]) as never;
      },
    },
  );

  // hermes 갈래만 hermes 어댑터 팩토리를 거친다. contextKey는 sessionKey에서 prefix를 뗀 값이다.
  assert.deepEqual(hermesCalls, [["n-hermes", "user-1", "meeting-meet-1"]]);
  // openclaw 는 쓸 백엔드가 없으므로 참가자로 남지 않는다. agentId 가 있어도 마찬가지다.
  assert.deepEqual(
    broker.config.participants.map((p) => p.npcId),
    ["n-hermes", "n-cli"],
  );
});

test("resolution layer: 개명 후에도 회의 세션키 형식이 그대로다", async () => {
  const adapterRegistry = new AdapterRegistry();
  const resolved = await resolveNpcAdapter(
    npcConfig({
      id: "npc123",
      name: "단비",
      sessionKeyPrefix: null,
      adapterType: "hermes",
      hermesProfileId: "p-1",
    }) as never,
    {
      sessionScope: "meeting-abc",
      userId: "u1",
      adapterRegistry,
      createHermesAdapter: async () => recordingAdapter(["PASS"]) as never,
    },
  );

  assert.ok(!("excluded" in resolved));
  assert.equal((resolved as { sessionKey: string }).sessionKey, "npc123-meeting-abc");
});

test("resolution layer: npc.passPolicy가 엔진까지 살아남아 폴링 프롬프트에 실린다", async () => {
  // item 1(H1)을 되돌리면 — EngineParticipant에서 passPolicy를 빼거나 formatPollMessage에
  // null을 다시 하드코딩하면 — 이 단언이 깨진다.
  const registry = new AdapterRegistry();
  const adapter = recordingAdapter(["PASS"]);
  registry.register(adapter as never);

  const broker = await defaultCreateMeetingBroker(
    brokerConfig(
      [
        npcConfig({
          id: "n-cli",
          name: "Cli",
          adapterType: "cli",
          passPolicy: "근거 없으면 PASS 하세요",
        }),
      ],
      { adapterRegistry: registry },
    ),
    {},
  );

  assert.deepEqual(
    broker.config.participants.map((p) => p.passPolicy),
    ["근거 없으면 PASS 하세요"],
  );

  await broker.run();
  assert.ok(
    adapter.prompts.some((p) => p.includes("[발언 지침] 근거 없으면 PASS 하세요")),
    `폴링 프롬프트에 [발언 지침]이 있어야 한다: ${JSON.stringify(adapter.prompts[0])}`,
  );
});

test("resolution layer: 잘못된 settings.initialMode는 캐스팅되지 않고 auto로 떨어진다", async () => {
  const registry = new AdapterRegistry();
  registry.register(recordingAdapter(["PASS"]) as never);

  const modeChanges: Array<[string, string]> = [];
  const broker = await defaultCreateMeetingBroker(
    brokerConfig([npcConfig({ id: "n-cli", name: "Cli", adapterType: "cli" })], {
      adapterRegistry: registry,
      settings: { initialMode: "bogus" },
    }),
    { onModeChanged: (mode: string, by: string) => modeChanges.push([mode, by]) },
  );

  // auto로 떨어졌으면 대기 없이 전원 PASS로 자연 종료된다(directed/manual이면 여기서 멈춘다).
  await broker.run();
  assert.deepEqual(modeChanges, [], "생성자에 넘긴 초기 모드는 mode-changed를 만들지 않는다");
  assert.equal(broker.isRunning(), false);
});

test("resolution layer: 참가자의 role이 발언 프롬프트까지 전달된다", async () => {
  const registry = new AdapterRegistry();
  const adapter = recordingAdapter(["SPEAK: 예", "말합니다"]);
  registry.register(adapter as never);

  const broker = await defaultCreateMeetingBroker(
    brokerConfig(
      [npcConfig({ id: "n-cli", name: "Cli", adapterType: "cli", role: "Facilitator" })],
      { adapterRegistry: registry, quota: { maxTotalTurns: 1 } },
    ),
    {},
  );
  await broker.run();

  const speakPrompt = adapter.prompts.find((p) => p.includes("참석자"));
  assert.ok(speakPrompt, "발언 프롬프트가 있어야 한다");
  assert.match(speakPrompt!, /Cli\(Facilitator\)/);
});

// Hermes 세션은 `<prefix>-<scope>` 로 키가 잡힌다. 이 문자열이 바뀌면 그 NPC 의 대화
// 맥락이 조용히 끊긴다 — 에러가 아니라 "어제 얘기를 기억 못 하는" 증상으로 나타나므로
// 리터럴을 글자 그대로 붙들어 둔다. 실제로 요약 범위에서 `-meeting-` 이 빠진 적이 있다.
test("회의 세션 범위는 meeting-<id> 다", () => {
  assert.equal(meetingSessionScope("meet-1"), "meeting-meet-1");
});

test("요약자 세션 범위는 회의 범위 뒤에 -summary 를 붙인다", () => {
  assert.equal(meetingSummarySessionScope("meet-1"), "meeting-meet-1-summary");
});

test("요약자 범위는 회의 범위와 절대 같지 않다", () => {
  // 같으면 요약 프롬프트가 그 NPC 의 회의 맥락에 섞여 다음 회의 발언이 오염된다.
  for (const id of ["meet-1", "a", "meet-1-summary"]) {
    assert.notEqual(meetingSummarySessionScope(id), meetingSessionScope(id));
  }
});
