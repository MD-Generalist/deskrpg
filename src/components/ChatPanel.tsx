"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { ReportItem } from "@/game/report-queue";
import DialogReportSummary from "./chat/DialogReportSummary";
import { Pencil, UserMinus, RotateCcw, Undo2 } from "lucide-react";
import type { NpcChatMessage } from "./NpcDialog";
import ChatInput from "./ChatInput";
import type { ChatTaskDraft } from "./kanban/kanban-view-model";
import ChatBubble from "./ui/ChatBubble";
import RosterAvatar from "./RosterAvatar";
import RoomList from "./rooms/RoomList";
import RoomHeader from "./rooms/RoomHeader";
import RoomComposer from "./rooms/RoomComposer";
import SystemMessage from "./rooms/SystemMessage";
import { candidatesForInvite } from "./rooms/compose-candidates";
import type { RoomAction, RoomState } from "@/app/game/room-state";
import type { ChatResponse } from "@/lib/chat-response";
import type { RoomMessage } from "@/lib/chat-rooms-policy";
import type { AvatarLookup } from "@/app/game/avatar-lookup";
import {
  isActiveChatResponse,
  responsesForSource,
  visibleResponseReplies,
} from "@/app/game/chat-response-state";
import ResponseProgress from "./chat/ResponseProgress";
import { ConversationSessionStore } from "@/app/game/conversation-session";
import CronPanel, { type CronEventSource } from "./cron/CronPanel";
import RoomNoticeMessage from "./chat/RoomNoticeMessage";
import NpcCardsTab from "./chat/NpcCardsTab";
import { tabFor, type NpcPanelTab, type NpcTabState } from "./chat/npc-tab-state";
import { createKanbanApi, KanbanApiError, type BoardResponse } from "./kanban/kanban-api";

/**
 * `kanban:event` 가 몰아칠 때 카드 탭이 보드를 이벤트 수만큼 읽지 않도록 묶는 시간.
 * 칸반 모달의 `KANBAN_EVENT_DEBOUNCE_MS` 와 같은 값이다 — 같은 사건 스트림을 듣는다.
 * 모듈을 끌어오지 않으려고 여기 둔다(모달은 무거운 클라이언트 컴포넌트다).
 */
const CARDS_EVENT_DEBOUNCE_MS = 400;

/** NPC 대화창의 크론 탭(T9)에 필요한 것. 배선(GamePageClient)이 넘긴다 — 없으면 탭이 없다. */
/** 직원 대화창 탭의 미확인 개수(`GET .../panel-reads`). */
export type PanelBadgeCounts = { cards: number; cron: number };

export type ChatPanelCronContext = {
  channelId: string;
  socket?: CronEventSource | null;
  onToast?: (message: string) => void;
};

interface ChatPanelProps {
  /** Overlay keeps the legacy floating panel; workspace embeds it in the right column. */
  presentation?: "overlay" | "workspace";
  width?: number;
  onWidthChange?: (width: number) => void;
  dialogNpc: { npcId: string; npcName: string } | null;
  npcMessages: NpcChatMessage[];
  /** 지금 NPC 가 무엇을 하는 중인지 알려 주는 번역 키. 없으면 표시하지 않는다. */
  npcActivityKey?: string | null;
  isNpcStreaming: boolean;
  npcResponses?: ChatResponse[];
  roomResponses?: ChatResponse[];
  npcChatInputDisabled?: boolean;
  npcChatDisabledPlaceholder?: string;
  onSend: (message: string, files?: File[]) => void;
  onClose: () => void;
  npcSelectList: { npcId: string; npcName: string }[] | null;
  onSelectNpc: (npcId: string, npcName: string) => void;
  isOwner?: boolean;
  onEditNpc?: (npcId: string) => void;
  onFireNpc?: (npcId: string) => void;
  onResetNpcChat?: (npcId: string) => void;
  npcMoveState?: string;
  onReturnNpc?: (npcId: string) => void;
  /** 이 대화창이 보고하러 온 직원의 것이면 그 보고. 맨 위에 요약을 띄운다. */
  dialogReport?: ReportItem | null;
  // Channel chat — 방(room) 단위. 목록·방 안·새 방/초대 세 화면이다.
  roomState: RoomState;
  channelChatOpen?: boolean;
  channelChatInputDisabled?: boolean;
  onRoomSend: (message: string) => void;
  onRoomAction: (action: RoomAction) => void;
  onRoomCreate: (name: string, npcIds: string[], userIds: string[]) => void;
  onRoomInvite: (roomId: string, npcIds: string[], userIds: string[]) => void;
  onRoomLeave: (roomId: string) => void;
  onRoomRename: (roomId: string, name: string) => void;
  onRoomDelete: (roomId: string) => void;
  /** `@` 로 지명할 수 있는 NPC — 방마다 다르다(office 는 출근 중 전원, group 은 멤버). */
  mentionCandidatesFor: (roomId: string | null) => { id: string; name: string }[];
  /** 지금 접속 중인 사람들 — 새 방/초대 화면의 사람 후보. */
  onlinePlayers: { id: string; name: string }[];
  /** 방 안 화면(패널 열림 + DM/선택목록 아님)이 보이는지 — 맵의 NPC 대기 규칙이 이걸 본다. */
  onChannelChatVisibleChange?: (visible: boolean) => void;
  currentPlayerName?: string;
  /** NPC DM 에 "크론" 탭을 붙인다 — 그 NPC 것만(R15). 없으면 대화만 보인다. */
  cron?: ChatPanelCronContext | null;
  /** 방 알림의 "카드 열기"(R29) — 칸반 모달을 그 카드로 연다. 없으면 링크가 없다. */
  onOpenNoticeCard?: (cardId: string, boardSlug: string) => void;
  /** 탭별 미확인 개수. 0 이면 배지를 그리지 않는다. 없으면 배지가 없다. */
  badges?: PanelBadgeCounts | null;
  /** 크론·카드 탭을 골랐다 — 열람 기록(`POST .../panel-reads`)은 배선이 한다. */
  onMarkSeen?: (tab: "cron" | "cards") => void;
  /** 카드 탭에서 카드를 눌렀다 — 칸반을 그 카드로 지목한다. 없으면 누를 수 없다. */
  onOpenAssignedCard?: (taskId: string) => void;
  onCreateTaskFromChat?: (draft: ChatTaskDraft) => void;
  /**
   * `kanban:event` 마다 오르는 값(배선의 `kanbanRefreshTick`). 카드 탭이 열려 있을 때만
   * 보드를 다시 읽는다 — 배지와 목록이 같은 트리거를 쓰게 하는 것이 이 prop 의 전부다.
   */
  cardsRefreshTick?: number;
  /** 사건 → 재조회 디바운스(ms). 칸반 모달과 같은 값이다(테스트에서 줄인다). */
  cardsDebounceMs?: number;
  /** 방 알림의 "이력 열기"(R30) — 채널 크론 화면을 그 잡으로 연다. 없으면 링크가 없다. */
  onOpenNoticeCronJob?: (jobId: string) => void;
  /** 승인 요청 알림의 "승인 열기" — 판단 모음을 연다. 없으면 버튼이 없다. */
  onOpenNoticeApproval?: (approvalId: string) => void;
  /** 회의 결과 알림의 "프로젝트로 등록" — 그 회의록을 연다. 없으면 버튼이 없다. */
  onOpenNoticeMinutes?: (minutesId: string) => void;
  /** 이 대화에서 NPC 가 저장한 결과물 — 마지막 답변 아래 칩으로 그린다. */
  npcArtifactChips?: Array<{ artifactId: string; title: string }>;
  /** 결과물 칩을 누르면 결과물 모달을 그 결과물로 연다. 없으면 칩이 없다. */
  onOpenArtifact?: (artifactId: string) => void;
  /**
   * 발화자의 외형을 찾아 준다 — 말풍선·헤더의 원형 아바타에 쓴다. 메시지마다 외형을 싣지
   * 않고 조회 함수를 받는다(외형은 채널 명부에 이미 있다). 못 찾으면 `null`(기본 표시).
   * 없으면 아바타를 그리지 않는다.
   */
  avatarFor?: AvatarLookup;
}

/**
 * 바로 앞 메시지와 같은 발화자인가 — 아바타·이름을 되풀이하지 않기 위해 본다.
 * 알림·시스템 메시지는 흐름을 끊으므로 그 뒤의 말풍선은 다시 아바타를 단다.
 */
function sameSpeaker(previous: RoomMessage | undefined, current: RoomMessage): boolean {
  if (!previous || previous.notice || previous.senderKind === "system") return false;
  if (previous.senderKind !== current.senderKind) return false;
  return previous.senderId && current.senderId
    ? previous.senderId === current.senderId
    : previous.senderName === current.senderName;
}

const MIN_WIDTH = 250;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 320;

/** 대화창보다 위에 모달 레이어가 떠 있는가. */
function modalLayerOpen(): boolean {
  return document.querySelector('[aria-modal="true"], [data-modal-overlay]') !== null;
}

export default function ChatPanel({
  presentation = "overlay",
  width: controlledWidth,
  onWidthChange,
  dialogNpc,
  npcMessages,
  npcActivityKey = null,
  isNpcStreaming,
  npcResponses = [],
  roomResponses = [],
  npcChatInputDisabled,
  npcChatDisabledPlaceholder,
  onSend,
  onClose,
  npcSelectList,
  onSelectNpc,
  isOwner,
  onEditNpc,
  onFireNpc,
  onResetNpcChat,
  roomState,
  channelChatOpen,
  channelChatInputDisabled,
  onRoomSend,
  onRoomAction,
  onRoomCreate,
  onRoomInvite,
  onRoomLeave,
  onRoomRename,
  onRoomDelete,
  mentionCandidatesFor,
  onlinePlayers,
  onChannelChatVisibleChange,
  currentPlayerName,
  npcMoveState,
  onReturnNpc,
  dialogReport,
  cron = null,
  onOpenNoticeCard,
  onOpenNoticeCronJob,
  onOpenNoticeApproval,
  onOpenNoticeMinutes,
  badges = null,
  onMarkSeen,
  onOpenAssignedCard,
  onCreateTaskFromChat,
  cardsRefreshTick = 0,
  cardsDebounceMs = CARDS_EVENT_DEBOUNCE_MS,
  npcArtifactChips = [],
  onOpenArtifact,
  avatarFor,
}: ChatPanelProps) {
  const [internalWidth, setInternalWidth] = useState(DEFAULT_WIDTH);
  // NPC DM 의 탭 — 어느 NPC 의 선택인지 같이 기억해, 다른 NPC 로 바뀌면 대화 탭으로 돌아간다
  // (effect 로 되돌리지 않는다 — 렌더 중 파생).
  const [npcTabState, setNpcTabState] = useState<NpcTabState>({ npcId: null, tab: "chat" });
  const dialogNpcId = dialogNpc?.npcId ?? null;
  const npcTab = tabFor(npcTabState, dialogNpcId);
  const setNpcTab = (tab: NpcPanelTab) => {
    setNpcTabState({ npcId: dialogNpcId, tab });
    if (tab !== "chat") onMarkSeen?.(tab);
  };
  // 카드 탭의 보드 — 탭을 열 때, 그리고 `kanban:event` 가 올 때 읽는다. 실패하면 **서버가 준 코드를 그대로** 들고 가야
  // `NpcCardsTab` 이 428·409·503 전용 안내를 고를 수 있다(감싸거나 바꾸지 않는다).
  // 결과에 조회 키를 함께 담아, 직원·채널이 바뀌면 옛 결과를 렌더 중에 버린다(effect 로
  // 되돌리지 않는다 — 한 프레임 동안 남의 카드가 보이는 일이 없다).
  const [cardsFetch, setCardsFetch] = useState<{
    key: string;
    board: BoardResponse | null;
    error: string | null;
  } | null>(null);
  const cardsChannelId = cron?.channelId ?? null;
  const cardsKey =
    npcTab === "cards" && cardsChannelId && dialogNpcId ? `${cardsChannelId}:${dialogNpcId}` : null;
  // 늦게 온 응답이 새 조회 결과를 덮지 않게 하는 세대 번호. 디바운스 재조회가 생기면서
  // 조회가 겹칠 수 있어 effect 지역의 `alive` 플래그만으로는 모자란다.
  const cardsRequestRef = useRef(0);
  const loadCards = useCallback(() => {
    if (!cardsKey || !cardsChannelId) return;
    const seq = ++cardsRequestRef.current;
    createKanbanApi(cardsChannelId)
      .board(false)
      .then((board) => {
        if (seq === cardsRequestRef.current) setCardsFetch({ key: cardsKey, board, error: null });
      })
      .catch((err: unknown) => {
        if (seq !== cardsRequestRef.current) return;
        setCardsFetch({
          key: cardsKey,
          board: null,
          error: err instanceof KanbanApiError ? err.code : "unknown_error",
        });
      });
  }, [cardsKey, cardsChannelId]);
  useEffect(() => {
    loadCards();
    return () => {
      // 직원·채널이 바뀌면 진행 중인 조회의 결과를 버린다.
      cardsRequestRef.current += 1;
    };
  }, [loadCards]);
  /**
   * `kanban:event` 로 목록을 다시 읽는다 — 배지만 오르고 목록이 낡는 상태를 없앤다.
   *
   * **"tick 이 0 이 아니다" 가 아니라 "tick 이 올랐다" 에 반응해야 한다.** `kanbanRefreshTick`
   * 은 세션 동안 오르기만 하므로, 사건이 한 번 지나간 뒤 탭을 열면 위의 첫 조회와 여기의
   * 타이머가 겹쳐 보드를 두 번 읽는다 — 그 사이에 새 사건은 없었는데도. 이 조회는 서버에서
   * Hermes 보드를 읽으므로 탭 열기마다 두 배다. 그래서 마지막으로 반영한 tick 을 들고 다니며
   * 탭을 연 순간의 값을 기준선으로 삼는다(열기 = 최신).
   *
   * **탭이 열려 있을 때만** 돈다 — 조회를 막는 것은 `loadCards` 의 `cardsKey` 검사이고,
   * 여기 같은 조건을 한 번 더 두는 것은 닫힌 탭에서 타이머를 걸지 않기 위해서다. 조회 키는
   * 그대로라 재조회 중에도 이전 목록이 남는다 — 확정되지 않은 상태를 빈 목록으로
   * 단정하지 않는다는 카드 탭의 불변식(`6b2fb198`)이 여기서 유지된다.
   */
  const cardsAppliedRef = useRef<{ key: string | null; tick: number }>({
    key: null,
    tick: cardsRefreshTick,
  });
  useEffect(() => {
    if (!cardsKey) {
      // 탭이 닫혔다 — 기준선을 버린다. 남겨 두면 같은 직원의 탭을 다시 열 때 "그 사이 tick 이 올랐다" 로
      // 읽혀, 열기 조회에 더해 한 번 더 읽는다.
      cardsAppliedRef.current = { key: null, tick: cardsRefreshTick };
      return;
    }
    if (cardsAppliedRef.current.key !== cardsKey) {
      // 탭을 열었거나 직원이 바뀌었다 — 위 effect 가 방금 읽었으므로 여기선 기준선만 맞춘다.
      cardsAppliedRef.current = { key: cardsKey, tick: cardsRefreshTick };
      return;
    }
    if (cardsAppliedRef.current.tick === cardsRefreshTick) return;
    const timer = setTimeout(() => {
      cardsAppliedRef.current = { key: cardsKey, tick: cardsRefreshTick };
      loadCards();
    }, cardsDebounceMs);
    return () => clearTimeout(timer);
  }, [cardsRefreshTick, cardsDebounceMs, cardsKey, loadCards]);
  const cardsLoaded = cardsFetch?.key === cardsKey ? cardsFetch : null;
  const cardsBoard = cardsLoaded?.board ?? null;
  const cardsError = cardsLoaded?.error ?? null;
  const cardsNpcProfile =
    cardsBoard?.npcs.find((npc) => npc.npcId === dialogNpcId)?.profileName ?? "";
  const width = controlledWidth ?? internalWidth;
  const setWidth = useCallback(
    (next: number) => {
      if (controlledWidth === undefined) setInternalWidth(next);
      onWidthChange?.(next);
    },
    [controlledWidth, onWidthChange],
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showGearMenu, setShowGearMenu] = useState(false);
  const [sessions] = useState(() => new ConversationSessionStore());
  const [, setSessionRevision] = useState(0);
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelScrollRef = useRef<HTMLDivElement>(null);
  const conversationKey = dialogNpc
    ? `npc:${dialogNpc.npcId}`
    : roomState.view === "compose"
      ? `compose:${roomState.compose?.inviteTo ?? "new"}`
      : roomState.currentRoomId
        ? `room:${roomState.currentRoomId}`
        : "room:list";
  const conversationDraft = sessions.get(conversationKey).draft;
  const updateConversationDraft = (draft: string) => {
    sessions.setDraft(conversationKey, draft);
    setSessionRevision((revision) => revision + 1);
  };
  const isWorkspace = presentation === "workspace";
  const isOpen = isWorkspace || manualOpen || !!dialogNpc || !!npcSelectList || !!channelChatOpen;
  // NPC 는 "방이 보이는 동안" 만 곁에 머문다 — 목록·새 방 화면은 대화가 아니다.
  const channelChatVisible = isOpen && !dialogNpc && !npcSelectList && roomState.view === "room";
  useEffect(() => {
    onChannelChatVisibleChange?.(channelChatVisible);
  }, [channelChatVisible, onChannelChatVisibleChange]);

  // Auto-scroll NPC messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [npcMessages]);
  useEffect(() => {
    const container = scrollRef.current;
    if (container && container.scrollHeight - container.clientHeight - container.scrollTop <= 80) {
      container.scrollTop = container.scrollHeight;
    }
  }, [npcResponses]);

  const currentRoom = roomState.rooms.find((room) => room.id === roomState.currentRoomId) ?? null;
  // useMemo 로 감싼다 — 삼항이 매 렌더마다 새 배열을 만들면 스크롤 useEffect 가 계속 돈다.
  const roomMessages = useMemo(
    () => (roomState.currentRoomId ? (roomState.messages[roomState.currentRoomId] ?? []) : []),
    [roomState.currentRoomId, roomState.messages],
  );

  // ---- 카드 제안 해소 (T7) ------------------------------------------------
  //
  // 버튼 유무의 정본은 알림의 `resolved` 이고, 그 정본은 서버에 있다. 다만 방 메시지가
  // 갱신되는 소켓 경로가 없어(새 이벤트를 만들지 않는다) 성공 직후에는 이 화면이 기억한
  // 결정을 알림에 얹어 그린다 — 새로고침하면 서버가 실어 준 값으로 대체된다.
  const [proposalResolved, setProposalResolved] = useState<
    Record<string, { choice: "card" | "inline"; taskId?: string }>
  >({});
  const [proposalCalls, setProposalCalls] = useState<
    Record<string, { pending: boolean; error: string | null }>
  >({});

  const handleResolveProposal = useCallback(
    async (proposalId: string, choice: "card" | "inline") => {
      if (!cardsChannelId) return;
      setProposalCalls((prev) => ({ ...prev, [proposalId]: { pending: true, error: null } }));
      try {
        const result = await createKanbanApi(cardsChannelId).resolveProposal(proposalId, choice);
        setProposalResolved((prev) => ({
          ...prev,
          [proposalId]: { choice, ...(result.taskId ? { taskId: result.taskId } : {}) },
        }));
        setProposalCalls((prev) => ({ ...prev, [proposalId]: { pending: false, error: null } }));
        // 담당이 떨어진 카드는 triage 로 들어간다 — 그 사실을 사용자에게 알린다.
        if (result.assigneeDropped) cron?.onToast?.(t("notice.cardProposal.assigneeDropped"));
        // 여기서 처리하기로 했으면 그 직원에게 후속 메시지를 보낸다 — 기존 방 전송 경로다.
        if (choice === "inline") {
          const notice = roomMessages.find(
            (message) =>
              message.notice?.kind === "card_proposal" && message.notice.proposalId === proposalId,
          )?.notice;
          const npcName = notice?.kind === "card_proposal" ? notice.npcName : "";
          onRoomSend(
            npcName
              ? `@[${npcName}] ${t("notice.cardProposal.inlineFollowUp")}`
              : t("notice.cardProposal.inlineFollowUp"),
          );
        }
      } catch (err) {
        // 실패는 버튼을 지우지 않는다 — 이유를 보이고 다시 고르게 둔다.
        setProposalCalls((prev) => ({
          ...prev,
          [proposalId]: {
            pending: false,
            error: err instanceof KanbanApiError ? err.code : "unknown_error",
          },
        }));
      }
    },
    [cardsChannelId, cron, onRoomSend, roomMessages, t],
  );

  /** 알림에 이 화면이 기억한 결정을 얹는다. 서버가 이미 `resolved` 를 실었으면 그것이 이긴다. */
  const withLocalResolution = useCallback(
    (message: RoomMessage): RoomMessage => {
      const notice = message.notice;
      if (notice?.kind !== "card_proposal" || notice.resolved) return message;
      const local = proposalResolved[notice.proposalId];
      if (!local) return message;
      return {
        ...message,
        notice: {
          ...notice,
          // `by`·`at` 은 화면에 쓰이지 않는다 — 정본은 서버가 쓴 값이다.
          resolved: {
            choice: local.choice,
            by: "",
            at: "",
            ...(local.taskId ? { taskId: local.taskId } : {}),
          },
        },
      };
    },
    [proposalResolved],
  );

  // Auto-scroll channel messages
  useEffect(() => {
    if (channelScrollRef.current) {
      channelScrollRef.current.scrollTop = channelScrollRef.current.scrollHeight;
    }
  }, [roomMessages]);
  useEffect(() => {
    const container = channelScrollRef.current;
    if (container && container.scrollHeight - container.clientHeight - container.scrollTop <= 80) {
      container.scrollTop = container.scrollHeight;
    }
  }, [roomResponses]);

  useEffect(() => {
    const container = dialogNpc ? scrollRef.current : channelScrollRef.current;
    if (container) container.scrollTop = sessions.get(conversationKey).scrollTop;
  }, [conversationKey, dialogNpc, sessions]);

  // ESC to close NPC dialog (return to channel chat)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 가장 위 레이어만 Esc 를 먹는다. 칸반·크론 같은 모달이 열려 있으면 그 모달이 닫히고
      // 뒤의 대화창은 그대로다 — 예전에는 둘 다 닫혀, 보고 대화창이면 "확인 없이 닫음" 으로
      // 보고가 접혔다(스테이징 실측).
      // 위 레이어가 이미 소비한 Esc 는 여기서 다시 처리하지 않는다.
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && dialogNpc && !modalLayerOpen()) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialogNpc, onClose]);

  // Drag handle
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const startWidth = widthRef.current;

      const handleMouseMove = (e: MouseEvent) => {
        const delta = isWorkspace ? startX - e.clientX : e.clientX - startX;
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [isWorkspace, setWidth],
  );

  if (!isOpen && !isWorkspace) {
    return (
      <button
        onClick={() => setManualOpen(true)}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-20 bg-surface/80 hover:bg-surface-raised text-text px-1 py-4 rounded-r-lg"
        title={t("chat.openChat")}
      >
        &#9654;
      </button>
    );
  }

  const inNpcDialog = !!dialogNpc;
  const inNpcSelect = !!npcSelectList && !dialogNpc;

  const composeMode: "create" | "invite" = roomState.compose?.inviteTo ? "invite" : "create";
  // 초대 화면은 이미 그 방에 있는 사람을 후보에서 뺀다 — 고를 수는 있지만 아무 일도 안 일어난다.
  const inviteCandidates = candidatesForInvite(
    roomState.rooms.find((room) => room.id === roomState.compose?.inviteTo) ?? null,
    mentionCandidatesFor(null),
    onlinePlayers.map((player) => ({ ...player, online: true })),
    roomState.viewerUserId,
  );

  /** 목록은 단일 office 채널에서도 새 방 만들기의 진입점이다. */
  const backFromRoom = () => onRoomAction({ type: "showList" });
  // 목록이 최상위 화면이다 — 그 위는 "닫힘". 방이 여러 개여도 여기서 패널을 접을 수 있어야 한다.
  const backFromList = () => {
    if (!isWorkspace) setManualOpen(false);
  };

  return (
    <div
      ref={panelRef}
      data-chat-panel={presentation}
      className={
        isWorkspace
          ? "relative flex h-full min-h-0 max-w-full flex-row-reverse"
          : "fixed left-0 bottom-0 z-20 flex"
      }
      style={isWorkspace ? { width } : { width, top: "var(--game-header-height, 48px)" }}
    >
      {/* Panel content */}
      <div
        className={`flex min-w-0 flex-1 flex-col bg-bg/95 backdrop-blur ${
          isWorkspace ? "" : "border-r border-border"
        }`}
      >
        {/* Panel header — 방 안에서는 RoomHeader 가 이 자리를 대신한다(화살표가 두 줄이 되지 않게). */}
        {!inNpcDialog && !inNpcSelect && roomState.view === "room" && currentRoom ? (
          <RoomHeader
            room={currentRoom}
            avatarFor={avatarFor}
            fallbackParticipants={[
              ...onlinePlayers.map((player) => ({ kind: "user" as const, ...player })),
              ...mentionCandidatesFor(currentRoom.id).map((npc) => ({
                kind: "npc" as const,
                ...npc,
              })),
            ]}
            canManage={!!roomState.viewerUserId && currentRoom.createdBy === roomState.viewerUserId}
            onBack={backFromRoom}
            onClose={() => (isWorkspace ? backFromRoom() : setManualOpen(false))}
            onInvite={() =>
              onRoomAction({ type: "compose", presetNpcIds: [], inviteTo: currentRoom.id })
            }
            onRename={(name) => onRoomRename(currentRoom.id, name)}
            onLeave={() => onRoomLeave(currentRoom.id)}
            onDelete={() => onRoomDelete(currentRoom.id)}
          />
        ) : (
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface/80">
            <button
              onClick={() => {
                if (inNpcDialog) {
                  onClose(); // Return to channel chat
                } else if (inNpcSelect) {
                  setManualOpen(false);
                } else if (roomState.view === "compose") {
                  onRoomAction({ type: "showList" });
                } else {
                  backFromList();
                }
              }}
              className="text-text-muted hover:text-text text-sm"
            >
              &#9664;
            </button>
            <span className="flex items-center gap-2 text-sm font-bold text-text-secondary">
              {inNpcDialog && avatarFor && (
                <span data-chat-header-avatar>
                  <RosterAvatar
                    appearance={avatarFor({
                      kind: "npc",
                      id: dialogNpc.npcId,
                      name: dialogNpc.npcName,
                    })}
                    size={24}
                  />
                </span>
              )}
              {inNpcDialog
                ? dialogNpc.npcName
                : inNpcSelect
                  ? t("chat.title")
                  : roomState.view === "compose"
                    ? composeMode === "invite"
                      ? t("room.invite")
                      : t("room.new")
                    : t("room.list")}
            </span>
            {inNpcDialog ? (
              <>
                {npcMoveState === "waiting" && onReturnNpc && (
                  <button
                    onClick={() => onReturnNpc(dialogNpc!.npcId)}
                    className="text-xs px-2 py-1 rounded bg-surface-raised hover:brightness-125 text-npc font-medium"
                    title={t("chat.returnNpcToOrigin")}
                  >
                    <Undo2 className="w-3.5 h-3.5 inline mr-1" />
                    {t("npc.return")}
                  </button>
                )}
                <div className="relative">
                  <button
                    onClick={() => setShowGearMenu(!showGearMenu)}
                    className="text-text-muted hover:text-text text-sm px-1"
                    title={t("chat.options")}
                  >
                    &#9881;
                  </button>
                  {showGearMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[140px] z-50">
                      {isOwner && (
                        <>
                          <button
                            onClick={() => {
                              setShowGearMenu(false);
                              onEditNpc?.(dialogNpc!.npcId);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-raised"
                          >
                            <Pencil className="w-3.5 h-3.5 inline mr-1" />
                            {t("npc.move")}
                          </button>
                          <button
                            onClick={() => {
                              setShowGearMenu(false);
                              onFireNpc?.(dialogNpc!.npcId);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-surface-raised"
                          >
                            <UserMinus className="w-3.5 h-3.5 inline mr-1" />
                            {t("npc.sleep")}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => {
                          setShowGearMenu(false);
                          onResetNpcChat?.(dialogNpc!.npcId);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-npc hover:bg-surface-raised"
                      >
                        <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
                        {t("context.resetChat")}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="w-4" />
            )}
          </div>
        )}

        {/* Chat content */}
        {inNpcSelect ? (
          <div className="flex-1 flex flex-col px-3 py-4 space-y-2">
            <p className="text-sm text-text-muted mb-2">{t("chat.placeholder")}</p>
            {npcSelectList!.map((npc) => (
              <button
                key={npc.npcId}
                onClick={() => onSelectNpc(npc.npcId, npc.npcName)}
                className="w-full text-left px-4 py-3 bg-surface hover:bg-surface-raised rounded-lg text-sm font-medium text-npc transition"
              >
                {npc.npcName}
              </button>
            ))}
          </div>
        ) : inNpcDialog ? (
          // NPC dialog mode
          <>
            {cron && (
              <div
                role="tablist"
                data-testid="npc-dialog-tabs"
                className="flex border-b border-border bg-surface/60 text-xs"
              >
                {(["chat", "cron", "cards"] as const).map((tab) => {
                  const unseen = tab === "chat" ? 0 : (badges?.[tab] ?? 0);
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      data-tab={tab}
                      aria-selected={npcTab === tab}
                      onClick={() => setNpcTab(tab)}
                      className={`px-3 py-1.5 ${
                        npcTab === tab
                          ? "text-text border-b-2 border-primary"
                          : "text-text-muted hover:text-text"
                      }`}
                    >
                      {t(`cron.tab.${tab}`)}
                      {unseen > 0 && (
                        <span
                          data-badge={tab}
                          className="ml-1 inline-block min-w-[1.1rem] rounded-full bg-primary/20 px-1 text-center text-[10px] leading-4 text-primary"
                        >
                          {unseen}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {cron && npcTab === "cards" ? (
              <div className="flex-1 min-h-0">
                <NpcCardsTab
                  npcProfile={cardsNpcProfile}
                  board={cardsBoard}
                  error={cardsError}
                  onOpenCard={(taskId) => onOpenAssignedCard?.(taskId)}
                />
              </div>
            ) : cron && npcTab === "cron" ? (
              <div className="flex-1 min-h-0">
                <CronPanel
                  channelId={cron.channelId}
                  npcs={[dialogNpc!]}
                  npc={dialogNpc}
                  socket={cron.socket ?? null}
                  onToast={cron.onToast}
                />
              </div>
            ) : (
              <>
                {dialogReport && dialogReport.npcId === dialogNpc?.npcId && (
                  <DialogReportSummary
                    report={dialogReport}
                    onOpenCard={
                      onOpenNoticeCard
                        ? (cardId) => onOpenNoticeCard(cardId, dialogReport.boardSlug ?? "")
                        : undefined
                    }
                    onOpenCronJob={onOpenNoticeCronJob}
                  />
                )}
                <div
                  ref={scrollRef}
                  onScroll={(event) =>
                    sessions.setScroll(conversationKey, event.currentTarget.scrollTop)
                  }
                  className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
                >
                  {npcMessages.length === 0 && (
                    <div className="text-text-dim text-sm italic py-4">
                      {t("chat.npcPlaceholder", { name: dialogNpc!.npcName })}
                    </div>
                  )}
                  {npcMessages.map((msg, i) => (
                    <div key={msg.id ?? `${msg.role}-${i}`}>
                      {msg.responseRequestId &&
                      npcResponses.some(
                        (response) => response.requestId === msg.responseRequestId,
                      ) ? (
                        <ResponseProgress
                          responses={npcResponses.filter(
                            (response) => response.requestId === msg.responseRequestId,
                          )}
                          avatarFor={avatarFor}
                        />
                      ) : (
                        <ChatBubble
                          sender={msg.role === "player" ? "player" : "npc"}
                          avatar={
                            avatarFor && dialogNpc
                              ? avatarFor({
                                  kind: "npc",
                                  id: dialogNpc.npcId,
                                  name: dialogNpc.npcName,
                                })
                              : undefined
                          }
                          continued={i > 0 && npcMessages[i - 1].role === msg.role}
                          streaming={
                            msg.role === "npc" && isNpcStreaming && i === npcMessages.length - 1
                          }
                        >
                          {msg.content}
                        </ChatBubble>
                      )}
                      {onCreateTaskFromChat &&
                        dialogNpc &&
                        msg.role === "npc" &&
                        msg.content.trim() &&
                        !msg.responseTransient &&
                        !(isNpcStreaming && i === npcMessages.length - 1) && (
                          <button
                            type="button"
                            className="text-xs text-primary underline underline-offset-2"
                            onClick={() => {
                              const response = npcResponses.find(
                                (entry) =>
                                  entry.requestId === msg.responseRequestId &&
                                  entry.npcId === dialogNpc.npcId,
                              );
                              const request = response
                                ? npcMessages.find(
                                    (entry) =>
                                      entry.role === "player" &&
                                      entry.id === response.sourceMessageId,
                                  )?.content
                                : undefined;
                              onCreateTaskFromChat({
                                title: (request || msg.content).split("\n")[0].slice(0, 140),
                                body: `${t("chat.taskSourceRequest")}\n${request ?? t("chat.taskSourceUnknown")}\n\n${t("chat.taskSourceReply", { name: dialogNpc.npcName })}\n${msg.content}`,
                                assigneeNpcId: dialogNpc.npcId,
                              });
                            }}
                          >
                            {t("chat.createTask")}
                          </button>
                        )}
                      {msg.role === "player" && (
                        <ResponseProgress
                          responses={responsesForSource(npcResponses, msg.id)}
                          receipt
                          receiptOnly
                        />
                      )}
                    </div>
                  ))}
                  {onOpenArtifact && npcArtifactChips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {npcArtifactChips.map((chip) => (
                        <button
                          key={chip.artifactId}
                          type="button"
                          className="rounded-full bg-surface-raised px-2.5 py-1 text-[11px]"
                          onClick={() => onOpenArtifact(chip.artifactId)}
                        >
                          {t("artifacts.chip", { title: chip.title })}
                        </button>
                      ))}
                    </div>
                  )}
                  <ResponseProgress
                    responses={visibleResponseReplies(npcResponses, {
                      responseRequestIds: new Set(
                        npcMessages
                          .map((message) => message.responseRequestId)
                          .filter((id): id is string => !!id),
                      ),
                    })}
                  />
                </div>
                {/* 진행 상태 — 답변 본문과 섞이지 않는 별도 줄.
                    예전에는 tool.progress 를 채팅 청크로 흘려서 답이 두 번 보였다. */}
                {/* isStreaming 을 함께 보지 않는다 — 그 값은 **첫 답변 청크**가 와야
                    true 가 되는데, 도구는 그 전에 돈다. 실측(2026-08-28): web_search 가
                    3회 돌 동안 화면에 아무것도 뜨지 않았다. 활동 키가 있다는 것 자체가
                    "아직 진행 중"이라는 뜻이므로 그것만으로 충분하다. */}
                {npcActivityKey && !npcResponses.some(isActiveChatResponse) && (
                  <div
                    className="flex items-center gap-2 px-3 pb-1 text-xs text-text-dim"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    {t(npcActivityKey)}
                  </div>
                )}
                <ChatInput
                  onSend={onSend}
                  value={conversationDraft}
                  onValueChange={updateConversationDraft}
                  placeholder={t("chat.npcPlaceholder", { name: dialogNpc!.npcName })}
                  disabled={!!npcChatInputDisabled}
                  scope="npc"
                  disabledPlaceholder={
                    npcChatInputDisabled
                      ? (npcChatDisabledPlaceholder ?? t("chat.disconnected"))
                      : t("chat.responding")
                  }
                  autoFocus
                  showFileUpload
                />
              </>
            )}
          </>
        ) : roomState.view === "list" ? (
          <RoomList
            rooms={roomState.rooms}
            currentRoomId={roomState.currentRoomId}
            onOpen={(roomId) => onRoomAction({ type: "open", roomId })}
            onNew={() => onRoomAction({ type: "compose", presetNpcIds: [] })}
          />
        ) : roomState.view === "compose" ? (
          <RoomComposer
            mode={composeMode}
            npcCandidates={inviteCandidates.npcs}
            userCandidates={inviteCandidates.users}
            presetNpcIds={roomState.compose?.presetNpcIds ?? []}
            onSubmit={({ name, npcIds, userIds }) => {
              const inviteTo = roomState.compose?.inviteTo;
              if (inviteTo) {
                onRoomInvite(inviteTo, npcIds, userIds);
                // 초대는 이미 그 방에 있던 사람이 하는 일이다 — 목록이 아니라 방으로 돌아간다.
                onRoomAction({ type: "open", roomId: inviteTo });
              } else {
                onRoomCreate(name, npcIds, userIds);
                // 새 방은 서버의 `room:created` 가 들어오면 그 방으로 데려간다.
                onRoomAction({ type: "showList" });
              }
            }}
            onCancel={() => onRoomAction({ type: "showList" })}
          />
        ) : (
          // 방 안 — 메시지 + 입력
          <>
            <div
              ref={channelScrollRef}
              onScroll={(event) =>
                sessions.setScroll(conversationKey, event.currentTarget.scrollTop)
              }
              className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5"
            >
              {roomMessages.length === 0 && (
                <div className="text-text-dim text-sm italic py-4 text-center">
                  {t("room.empty")}
                </div>
              )}
              {roomMessages.map((msg, index) => {
                // 구조화 알림(R29·R30)은 발신자 종류와 무관하게 알림 렌더러가 그린다.
                if (msg.notice) {
                  return (
                    <RoomNoticeMessage
                      key={msg.id}
                      message={withLocalResolution(msg)}
                      onOpenCard={onOpenNoticeCard}
                      onOpenCronJob={onOpenNoticeCronJob}
                      onOpenApproval={onOpenNoticeApproval}
                      onOpenMinutes={onOpenNoticeMinutes}
                      onResolveProposal={cardsChannelId ? handleResolveProposal : undefined}
                      proposalPending={
                        msg.notice?.kind === "card_proposal"
                          ? (proposalCalls[msg.notice.proposalId]?.pending ?? false)
                          : false
                      }
                      proposalError={
                        msg.notice?.kind === "card_proposal"
                          ? (proposalCalls[msg.notice.proposalId]?.error ?? null)
                          : null
                      }
                    />
                  );
                }
                if (msg.senderKind === "system") {
                  return <SystemMessage key={msg.id} content={msg.content} />;
                }
                const isMe = msg.senderKind === "user" && msg.senderName === currentPlayerName;
                return (
                  <div key={msg.id}>
                    <ChatBubble
                      sender={isMe ? "player" : "npc"}
                      name={!isMe ? msg.senderName : undefined}
                      avatar={
                        avatarFor
                          ? avatarFor({
                              kind: msg.senderKind,
                              id: msg.senderId,
                              name: msg.senderName,
                            })
                          : undefined
                      }
                      continued={sameSpeaker(roomMessages[index - 1], msg)}
                    >
                      {msg.content}
                    </ChatBubble>
                    {
                      <ResponseProgress
                        responses={responsesForSource(roomResponses, msg.id)}
                        receipt
                        receiptOnly
                      />
                    }
                  </div>
                );
              })}
              <ResponseProgress
                responses={visibleResponseReplies(roomResponses, {
                  persistedMessageIds: new Set(roomMessages.map((message) => message.id)),
                })}
              />
            </div>
            <ChatInput
              onSend={onRoomSend}
              value={conversationDraft}
              onValueChange={updateConversationDraft}
              placeholder={t("chat.placeholder")}
              disabledPlaceholder={t("chat.moveCloser")}
              disabled={!!channelChatInputDisabled}
              scope="room"
              mentionCandidates={mentionCandidatesFor(roomState.currentRoomId)}
              autoFocus
            />
          </>
        )}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`w-2 cursor-col-resize flex items-center justify-center hover:bg-primary/30 transition ${
          isDragging ? "bg-primary/50" : "bg-surface-raised/50"
        }`}
      >
        <div className="w-0.5 h-8 bg-text-dim rounded" />
      </div>
    </div>
  );
}

// ChatInput is now imported from shared component
