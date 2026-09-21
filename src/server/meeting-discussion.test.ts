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
  settleMeeting,
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

test("회의가 끝나면 구조화된 결과와 요약 상태가 저장되고 방송된다", async () => {
  const calls: RecordedCall[] = [];
  const socket = createFakeSocket("socket-1", calls);
  const registry = new AdapterRegistry();
  registry.register(recordingAdapter(["ok"]));
  type Deps = Parameters<typeof registerMeetingDiscussionHandlers>[0]["deps"];
  type Factory = NonNullable<Deps["createMeetingBroker"]>;
  let callbacks!: Parameters<Factory>[1];
  let summaryParticipants: unknown;
  let persisted: Parameters<Deps["persistMeetingMinutes"]>[0] | undefined;
  const outcome = {
    decisions: ["A안 채택"],
    followUps: [
      {
        title: "조사",
        summary: null,
        acceptance: null,
        assigneeNpcId: "npc-1",
        assigneeName: "NPC",
        after: [],
      },
    ],
    project: { recommended: true, name: "가격 개편", reason: null },
  };
  const announced: unknown[] = [];
  registerMeetingDiscussionHandlers({
    io: createFakeIo(calls),
    socket,
    deps: {
      activeBrokers: new Map(),
      discussionInitiators: new Map(),
      meetingRooms: new Map([["a", { participants: new Set(["socket-1"]), messages: [] }]]),
      players: new Map([["socket-1", { characterName: "Dante" }]]),
      user: { userId: "u1" },
      adapterRegistry: registry,
      canControlMeeting: () => true,
      getNpcConfigsForChannel: async () => [npcConfig({ adapterType: "cli" })],
      createMeetingBroker: (_config, cb) => {
        callbacks = cb;
        return {
          config: { participants: [{ npcId: "npc-1", displayName: "NPC" }] },
          turns: [],
          isRunning: () => true,
          stop: () => {},
          run: () => Promise.resolve(),
        } as unknown as MeetingBrokerLike;
      },
      generateMeetingSummary: async (_adapter, _key, _topic, _transcript, participants) => {
        summaryParticipants = participants;
        return { keyTopics: ["가격"], conclusions: "A안", outcome, status: "ok" };
      },
      persistMeetingMinutes: async (input) => {
        persisted = input;
        return "minutes-1";
      },
      announceOutcome: async (input) => {
        announced.push(input);
      },
    },
  });

  await socket.trigger("meeting:start-discussion", { channelId: "a", topic: "가격" });
  await callbacks.onMeetingEnd!("전문", 10);

  // 회의실 밖 사람도 알도록 사무실 방 알림을 요청한다 — 저장된 회의록 id 와 같은 결과를 넘긴다.
  assert.deepEqual(announced, [
    { channelId: "a", minutesId: "minutes-1", topic: "가격", outcome, summaryStatus: "ok" },
  ]);

  // 담당 후보는 참석 **직원**만이다 — 사람 참석자는 넘기지 않는다.
  assert.equal(Array.isArray(summaryParticipants), true);
  assert.deepEqual(
    (summaryParticipants as Array<{ npcId: string }>).map((p) => p.npcId),
    [npcConfig({}).id],
  );
  assert.deepEqual(persisted?.outcome, outcome);
  assert.equal(persisted?.summaryStatus, "ok");
  const end = calls.find((call) => call.event === "meeting:end")?.payload as {
    outcome: unknown;
    summaryStatus: string;
    minutesId: string;
  };
  assert.deepEqual(end.outcome, outcome);
  assert.equal(end.summaryStatus, "ok");
  assert.equal(end.minutesId, "minutes-1");
});

test("브로커 onError 가 어떤 값을 넘겨도 meeting:error 는 문자열 코드와 사유를 싣는다", async () => {
  const calls: RecordedCall[] = [];
  const socket = createFakeSocket("socket-1", calls);
  const registry = new AdapterRegistry();
  registry.register(recordingAdapter(["ok"]));
  type Factory = NonNullable<
    Parameters<typeof registerMeetingDiscussionHandlers>[0]["deps"]["createMeetingBroker"]
  >;
  let cb!: Parameters<Factory>[1];
  registerMeetingDiscussionHandlers({
    io: createFakeIo(calls),
    socket,
    deps: {
      activeBrokers: new Map(),
      discussionInitiators: new Map(),
      meetingRooms: new Map([["a", { participants: new Set(["socket-1"]), messages: [] }]]),
      players: new Map(),
      user: { userId: "u1" },
      adapterRegistry: registry,
      canControlMeeting: () => true,
      getNpcConfigsForChannel: async () => [npcConfig({ adapterType: "cli" })],
      createMeetingBroker: (_config, callbacks) => {
        cb = callbacks;
        return {
          config: { participants: [{ npcId: "npc-1", displayName: "NPC" }] },
          turns: [],
          isRunning: () => true,
          stop: () => {},
          run: () => new Promise<void>(() => {}),
        } as unknown as MeetingBrokerLike;
      },
      generateMeetingSummary: async () => ({ keyTopics: [], conclusions: null }),
      persistMeetingMinutes: async () => null,
    },
  });
  await socket.trigger("meeting:start-discussion", { channelId: "a", topic: "t" });

  // 스테이징 실측과 같은 모양 — 어댑터가 HermesError 를 던졌다
  const usage = Object.assign(new Error("HTTP 429: The usage limit has been reached"), {
    name: "HermesError",
    code: "run_failed",
    status: 200,
  });
  for (const thrown of [usage, { code: "x", message: "obj" }, "plain", undefined]) {
    cb.onError!(thrown);
  }
  const payloads = calls
    .filter((call) => call.event === "meeting:error")
    .map((call) => call.payload as { error: unknown; detail: unknown });
  assert.equal(payloads.length, 4);
  for (const p of payloads) {
    assert.equal(typeof p.error, "string", `error 가 문자열이 아니다: ${JSON.stringify(p)}`);
    assert.ok(p.detail === null || typeof p.detail === "string");
  }
  assert.deepEqual(payloads[0], {
    error: "backend_usage_limit",
    detail: "HTTP 429: The usage limit has been reached",
  });
});

// 모델 백엔드 한도(429)로 모든 턴이 실패하는 회의. 실제 엔진(defaultCreateMeetingBroker)과
// 실제 공간 조정자를 쓴다 — 가짜 브로커로는 "턴 오류 뒤 엔진이 끝나는가" 를 볼 수 없다.
async function runFailingMeeting(opts: { hang?: boolean } = {}) {
  const calls: RecordedCall[] = [];
  const socket = createFakeSocket("socket-1", calls);
  const released: string[] = [];
  const spatial = createMeetingSpatialCoordinator({
    layout: async () => ({ spaceId: "meeting", targets: [{ x: 80, y: 80, seatId: "80:80" }] }),
    capture: async () => ({ x: 16, y: 16, seatId: "16:16" }),
    reserve: async () => true,
    move: async () => true,
    release: async (_c, actorId) => {
      released.push(actorId);
    },
    returnTarget: async (_c, _a, p) => p,
    publish: () => {},
  });
  let adapterCalls = 0;
  const registry = new AdapterRegistry();
  registry.register({
    type: "cli",
    async execute() {
      adapterCalls++;
      // 회의가 진행 중인 채로 주재자가 떠나는 경우를 보려고 응답을 붙잡아 둔다.
      if (opts.hang) return new Promise(() => {});
      throw Object.assign(new Error("HTTP 429: The usage limit has been reached"), {
        name: "HermesError",
        code: "run_failed",
        status: 200,
      });
    },
    async testConnection() {
      return { status: "ok" as const };
    },
  } as never);
  const activeBrokers = new Map<string, MeetingBrokerLike>();
  const discussionInitiators = new Map<string, string>();
  let ended = 0;
  registerMeetingDiscussionHandlers({
    io: createFakeIo(calls),
    socket,
    deps: {
      activeBrokers,
      discussionInitiators,
      meetingRooms: new Map([["a", { participants: new Set(["socket-1"]), messages: [] }]]),
      players: new Map(),
      user: { userId: "u1" },
      adapterRegistry: registry,
      spatial,
      canStartMeeting: () => true,
      canControlMeeting: () => true,
      getNpcConfigsForChannel: async () => [
        npcConfig({ id: "n1", name: "Sophie", adapterType: "cli" }),
      ],
      generateMeetingSummary: async () => {
        ended++;
        return { keyTopics: [], conclusions: null, status: "failed" };
      },
      persistMeetingMinutes: async () => null,
    },
  });
  const pending = socket.trigger("meeting:start-discussion", {
    channelId: "a",
    topic: "t",
    selectedNpcIds: ["n1"],
    settings: { maxTotalTurns: 4 },
  });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  spatial.arrived("a", "n1", spatial.snapshot("a")!.generation);
  await pending;
  const seatedAfterStart = spatial.snapshot("a")?.phase;
  // 엔진이 스스로 끝날 기회를 준다(실패 누적 → consecutive_failures).
  const deadline = Date.now() + (opts.hang ? 50 : 3000);
  while (Date.now() < deadline && activeBrokers.has("a")) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return {
    calls,
    released,
    spatial,
    activeBrokers,
    discussionInitiators,
    adapterCalls,
    ended,
    seatedAfterStart,
    socket,
  };
}

test("모든 호출이 한도 오류로 실패한 회의는 스스로 끝나고 직원을 자리로 돌려보낸다", async () => {
  const r = await runFailingMeeting();
  assert.equal(r.seatedAfterStart, "ready");
  assert.equal(
    r.activeBrokers.has("a"),
    false,
    "브로커가 activeBrokers 에 남아 다음 회의를 막는다",
  );
  assert.deepEqual(r.released, ["n1"], "직원이 회의석에서 풀려나지 않았다");
});

test("주재자가 떠나 방이 빈 회의도 직원을 자리로 돌려보내고, 같은 채널에서 다시 시작할 수 있다", async () => {
  const r = await runFailingMeeting({ hang: true });
  assert.equal(r.activeBrokers.has("a"), true, "전제: 회의가 진행 중이어야 한다");
  // socket-handlers.ts 의 disconnect 처리와 같은 순서 — 플레이어가 빠지고, 방이 비면 정산한다.
  await r.spatial.leavePlayer("a", "u1", "socket-1");
  settleMeeting(r, "a", { stopBroker: true, context: "주재자 이탈" });
  for (let i = 0; i < 50; i++) await new Promise((res) => setImmediate(res));

  assert.equal(r.activeBrokers.has("a"), false);
  assert.deepEqual(
    r.released.filter((a) => a === "n1"),
    ["n1"],
    "직원이 회의석에서 풀려나지 않았다",
  );
  assert.equal(r.spatial.snapshot("a")?.phase, "returning");

  // 직원이 자리에 돌아오면 공간 세션이 닫히고, 다음 회의가 시작된다.
  // 예전에는 세션이 "ready" 에 머물러 spatial.start 가 null 을 돌려주고 회의가 조용히 시작되지 않았다.
  r.spatial.arrived("a", "n1", r.spatial.snapshot("a")!.generation);
  assert.equal(r.spatial.snapshot("a")?.phase, "idle");
  const next = await r.spatial.start("a", "u1", ["n1"]);
  assert.notEqual(next, null, "같은 채널에서 회의를 다시 시작할 수 없다");
});

test("턴 끝 스트림 신호는 회의 기록과 같은 최종 본문을 싣는다 — 화면이 그것으로 말풍선을 확정한다", async () => {
  const { MEETING_NPC_STREAM_EVENT } = await import("./meeting-socket");
  const calls: RecordedCall[] = [];
  const socket = createFakeSocket("socket-1", calls);
  const registry = new AdapterRegistry();
  registry.register(recordingAdapter(["ok"]));
  type Factory = NonNullable<
    Parameters<typeof registerMeetingDiscussionHandlers>[0]["deps"]["createMeetingBroker"]
  >;
  let cb!: Parameters<Factory>[1];
  const meetingRooms = new Map([
    ["a", { participants: new Set(["socket-1"]), messages: [] as Array<{ content: string }> }],
  ]);
  registerMeetingDiscussionHandlers({
    io: createFakeIo(calls),
    socket,
    deps: {
      activeBrokers: new Map(),
      discussionInitiators: new Map(),
      meetingRooms: meetingRooms as never,
      players: new Map(),
      user: { userId: "u1" },
      adapterRegistry: registry,
      canControlMeeting: () => true,
      getNpcConfigsForChannel: async () => [npcConfig({ adapterType: "cli" })],
      createMeetingBroker: (_config, callbacks) => {
        cb = callbacks;
        return {
          config: { participants: [{ npcId: "npc-1", displayName: "NPC" }] },
          turns: [],
          isRunning: () => true,
          stop: () => {},
          run: () => new Promise<void>(() => {}),
        } as unknown as MeetingBrokerLike;
      },
      generateMeetingSummary: async () => ({ keyTopics: [], conclusions: null }),
      persistMeetingMinutes: async () => null,
    },
  });
  await socket.trigger("meeting:start-discussion", { channelId: "a", topic: "t" });

  cb.onTurnChunk!("npc-1", "첫 생성. ");
  cb.onTurnChunk!("npc-1", "둘째 생성.");
  cb.onTurnEnd!("npc-1", "둘째 생성.");

  const done = calls.find(
    (c) => c.event === MEETING_NPC_STREAM_EVENT && (c.payload as { done: boolean }).done,
  );
  assert.equal((done?.payload as { text?: string }).text, "둘째 생성.");
  assert.equal(meetingRooms.get("a")!.messages.at(-1)?.content, "둘째 생성.");
});
