import { withStreamDiagnosticRequest } from "@/lib/hermes/stream-diagnostics";
// 맵 채팅에서 지명받은 NPC 들이 동시에 대답한다. 루프가 없다 — 사람의 말이 올 때만 깨어난다.
//
// 회의(ChannelRuntime)와 갈라 둔 이유: 회의는 매 라운드 "다음은 누구"를 정하는 박자로 돌지만
// 자유채팅에는 그 박자가 없다. 라운드 루프를 이벤트 구동에 맞추려면 빈 박자를 계속 돌게
// 해야 한다. 공유하는 것은 NpcRuntime.speakWithPrompt — 대본을 들고 가서 말을 시키고
// 답을 받아오는 기계다.

import { randomUUID } from "node:crypto";
import { SessionQueue } from "./request-queue";
import { NpcRuntime } from "./npc-runtime";
import { Transcript } from "./transcript";
import { extractMentionNames, parseAllMentions } from "./mention";
import { ChatQuota, DEFAULT_CHAT_BUDGET } from "./chat-quota";
import { formatOpenChatMessage, type ChatLine } from "@/lib/open-chat-formatter";
import type { EngineParticipant } from "./types";
import type { UserContext } from "@/lib/user-context";

/** speakWithPrompt 는 이 둘을 읽지 않는다. 읽히면 테스트에서 드러나도록 눈에 띄는 값을 넣는다. */
const UNUSED_TOPIC = "__open_chat_topic_should_never_be_read__";
const UNUSED_MAX_TURNS = -1;

export type TurnContext = {
  requestId: string;
  sourceMessageId: string;
  callerSocketId: string | null;
  /**
   * 사람이 직접 부른 턴에서만 그 사람의 이름·소개. NPC 가 NPC 를 부른 턴은 null 이다 —
   * 그 턴의 "부른 사람" 은 동료 NPC 라서 사람의 소개를 붙이면 상대를 잘못 알려 준다.
   */
  callerContext?: UserContext | null;
};

export type OpenChatCallbacks = {
  onTurnQueued?: (npcId: string, displayName: string, context: TurnContext) => void;
  onDisposed?: () => void;
  onQueueFull?: (npcId: string, sourceMessageId: string) => void;
  /**
   * 턴이 열렸다. `callerSocketId` 는 **이 사슬을 시작한 사람의 소켓 id** 다 — NPC 가
   * 누구 곁으로 걸어갈지를 정하는 값이라, NPC 가 NPC 를 부른 턴도 같은 값을 쓴다.
   */
  onTurnStart?: (
    npcId: string,
    displayName: string,
    callerSocketId: string | null,
    context: TurnContext,
  ) => void;
  onTurnChunk?: (npcId: string, chunk: string, context: TurnContext) => void;
  onTurnEnd?: (
    npcId: string,
    fullResponse: string,
    meta: { aborted: true; reason: string } | undefined,
    context: TurnContext,
  ) => unknown;
  /** 지명받았으나 게이트웨이가 죽어 건너뛴 NPC. 회의의 같은 이름 콜백과 짝이다. */
  onMentionSkipped?: (npcId: string, reason: "backend_failing") => void;
  /**
   * 사람이 누군가를 지목했지만 그 지목이 응답자를 하나도 만들지 못했다(비멤버·오타).
   * 맵에는 말풍선이 없어 이대로면 완전 침묵이다 — 부른 사람에게만 신호를 준다.
   */
  onMentionNoMatch?: (callerSocketId: string | null) => void;
  onError?: (err: unknown, npcId: string) => void;
};

export type OpenChatDeps = {
  participants: EngineParticipant[];
  /** 프롬프트에 실을 최근 대화. 소켓 계층의 채널 히스토리를 그대로 넘긴다. */
  recent: () => ChatLine[];
  recentForSource?: (sourceMessageId: string) => ChatLine[];
  turnTimeout: { idleMs: number; maxMs: number };
  historyLimit?: number;
  budget?: number;
  now?: () => number;
  /** 방 정책. 없으면 지명만 — 사무실 전체 방과 같다. */
  selectResponders?: (mentionedIds: string[]) => string[];
};

export class OpenChatRuntime {
  private readonly deps: OpenChatDeps;
  private readonly callbacks: OpenChatCallbacks;
  private readonly runtimes = new Map<string, NpcRuntime>();
  private readonly quota: ChatQuota;
  private readonly queue = new SessionQueue(8);
  private disposed = false;

  constructor(deps: OpenChatDeps, callbacks: OpenChatCallbacks) {
    this.deps = deps;
    this.callbacks = callbacks;
    this.quota = new ChatQuota(deps.budget ?? DEFAULT_CHAT_BUDGET);

    const transcript = new Transcript();
    const now = deps.now ?? (() => Date.now());
    for (const participant of deps.participants) {
      this.runtimes.set(
        participant.npcId,
        new NpcRuntime(participant, {
          transcript,
          topic: UNUSED_TOPIC,
          allParticipants: deps.participants,
          maxTotalTurns: UNUSED_MAX_TURNS,
          historyLimit: deps.historyLimit ?? 10,
          turnTimeout: deps.turnTimeout,
          now,
        }),
      );
    }
  }

  isSpeaking(npcId: string): boolean {
    return this.queue.size(npcId) > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.callbacks.onDisposed?.();
    for (const [id, runtime] of this.runtimes) if (this.isSpeaking(id)) runtime.abort();
  }

  async handleHumanMessage(
    senderName: string,
    text: string,
    callerSocketId: string | null = null,
    sourceMessageId: string = randomUUID(),
    callerContext: UserContext | null = null,
  ): Promise<void> {
    if (this.disposed) return;
    this.quota.resetByHuman();
    const mentioned = parseAllMentions(text, this.participantsView(), null);
    const targets = this.deps.selectResponders ? this.deps.selectResponders(mentioned) : mentioned;
    if (targets.length === 0 && extractMentionNames(text).length > 0) {
      this.callbacks.onMentionNoMatch?.(callerSocketId);
    }
    const recent = (this.deps.recentForSource?.(sourceMessageId) ?? this.deps.recent()).map(
      (line) => ({ ...line }),
    );
    await this.dispatch(
      targets,
      senderName,
      true,
      callerSocketId,
      sourceMessageId,
      recent,
      callerContext,
    );
  }

  private participantsView(): Array<{ npcId: string; displayName: string }> {
    return this.deps.participants.map((p) => ({ npcId: p.npcId, displayName: p.displayName }));
  }

  private async dispatch(
    targets: string[],
    calledBy: string,
    fromHuman: boolean,
    callerSocketId: string | null,
    sourceMessageId: string,
    recent: ChatLine[],
    callerContext: UserContext | null = null,
  ): Promise<void> {
    if (this.disposed) return;
    const work: Promise<void>[] = [];
    for (const npcId of new Set(targets)) {
      const runtime = this.runtimes.get(npcId);
      if (!runtime || (!fromHuman && this.isSpeaking(npcId))) continue;
      if (runtime.isBurnedOut()) {
        this.callbacks.onMentionSkipped?.(npcId, "backend_failing");
        continue;
      }
      if (this.queue.isFull(npcId)) {
        this.callbacks.onQueueFull?.(npcId, sourceMessageId);
        continue;
      }
      if (!fromHuman && !this.quota.spend()) break;
      const context: TurnContext = {
        requestId: randomUUID(),
        sourceMessageId,
        callerSocketId,
        callerContext: fromHuman ? callerContext : null,
      };
      this.callbacks.onTurnQueued?.(npcId, runtime.displayName, context);
      // The chain runs after this job releases its queue slot, avoiding A -> B -> A deadlocks.
      const job = this.queue.run(npcId, () => this.speakOne(npcId, calledBy, context, recent));
      work.push(
        job.then(async (result) => {
          if (!result || this.disposed) return;
          const next = parseAllMentions(result.text, this.participantsView(), npcId);
          if (next.length)
            await this.dispatch(
              next,
              runtime.displayName,
              false,
              callerSocketId,
              result.messageId ?? sourceMessageId,
              this.deps.recent().map((line) => ({ ...line })),
            );
        }),
      );
    }
    await Promise.all(work);
  }

  private async speakOne(
    npcId: string,
    calledBy: string,
    context: TurnContext,
    recent: ChatLine[],
  ): Promise<{ text: string; messageId?: string } | undefined> {
    const runtime = this.runtimes.get(npcId);
    if (!runtime || this.disposed) return;
    let closed = false;
    try {
      this.callbacks.onTurnStart?.(npcId, runtime.displayName, context.callerSocketId, context);
      const others = this.deps.participants
        .filter((p) => p.npcId !== npcId)
        .map((p) => ({ displayName: p.displayName, role: p.role || "동료" }));
      const prompt = formatOpenChatMessage(
        { displayName: runtime.displayName },
        others,
        recent,
        calledBy,
        context.callerContext,
      );
      const outcome = await withStreamDiagnosticRequest(context.requestId, () =>
        runtime.speakWithPrompt(prompt, {
          onChunk: (chunk) => {
            if (!this.disposed && !closed) this.callbacks.onTurnChunk?.(npcId, chunk, context);
          },
        }),
      );
      closed = true;
      if (this.disposed) return;
      if (outcome.kind === "spoke") {
        const messageId = await this.callbacks.onTurnEnd?.(npcId, outcome.text, undefined, context);
        return {
          text: outcome.text,
          messageId: typeof messageId === "string" ? messageId : undefined,
        };
      }
      if (outcome.kind === "error") this.callbacks.onError?.(outcome.error, npcId);
      await this.callbacks.onTurnEnd?.(
        npcId,
        outcome.partialText,
        {
          aborted: true,
          reason:
            outcome.kind === "empty"
              ? "empty_response"
              : outcome.timedOut
                ? `timeout:${outcome.timedOut.kind}`
                : "adapter_error",
        },
        context,
      );
    } catch (error) {
      closed = true;
      await this.callbacks.onTurnEnd?.(
        npcId,
        "",
        { aborted: true, reason: "adapter_error" },
        context,
      );
      throw error;
    }
  }
}
