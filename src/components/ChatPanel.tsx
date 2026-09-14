"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { Pencil, UserMinus, RotateCcw, Undo2 } from "lucide-react";
import type { NpcChatMessage } from "./NpcDialog";
import ChatInput from "./ChatInput";
import ChatBubble from "./ui/ChatBubble";
import RoomList from "./rooms/RoomList";
import RoomHeader from "./rooms/RoomHeader";
import RoomComposer from "./rooms/RoomComposer";
import SystemMessage from "./rooms/SystemMessage";
import { candidatesForInvite } from "./rooms/compose-candidates";
import type { RoomAction, RoomState } from "@/app/game/room-state";
import type { ChatResponse } from "@/lib/chat-response";
import {
  isActiveChatResponse,
  responsesForSource,
  visibleResponseReplies,
} from "@/app/game/chat-response-state";
import ResponseProgress from "./chat/ResponseProgress";
import { ConversationSessionStore } from "@/app/game/conversation-session";
import CronPanel, { type CronEventSource } from "./cron/CronPanel";
import RoomNoticeMessage from "./chat/RoomNoticeMessage";

/** NPC 대화창의 크론 탭(T9)에 필요한 것. 배선(GamePageClient)이 넘긴다 — 없으면 탭이 없다. */
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
  /** 방 알림의 "이력 열기"(R30) — 채널 크론 화면을 그 잡으로 연다. 없으면 링크가 없다. */
  onOpenNoticeCronJob?: (jobId: string) => void;
}

const MIN_WIDTH = 250;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 320;

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
  cron = null,
  onOpenNoticeCard,
  onOpenNoticeCronJob,
}: ChatPanelProps) {
  const [internalWidth, setInternalWidth] = useState(DEFAULT_WIDTH);
  // NPC DM 의 탭 — 어느 NPC 의 선택인지 같이 기억해, 다른 NPC 로 바뀌면 대화 탭으로 돌아간다
  // (effect 로 되돌리지 않는다 — 렌더 중 파생).
  const [npcTabState, setNpcTabState] = useState<{ npcId: string | null; tab: "chat" | "cron" }>({
    npcId: null,
    tab: "chat",
  });
  const dialogNpcId = dialogNpc?.npcId ?? null;
  const npcTab = npcTabState.npcId === dialogNpcId ? npcTabState.tab : "chat";
  const setNpcTab = (tab: "chat" | "cron") => setNpcTabState({ npcId: dialogNpcId, tab });
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
      if (e.key === "Escape" && dialogNpc) {
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
            <span className="text-sm font-bold text-text-secondary">
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
                {(["chat", "cron"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={npcTab === tab}
                    onClick={() => setNpcTab(tab)}
                    className={`px-3 py-1.5 ${
                      npcTab === tab
                        ? "text-text border-b-2 border-primary"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    {t(`cron.tab.${tab}`)}
                  </button>
                ))}
              </div>
            )}
            {cron && npcTab === "cron" ? (
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
                        />
                      ) : (
                        <ChatBubble
                          sender={msg.role === "player" ? "player" : "npc"}
                          streaming={
                            msg.role === "npc" && isNpcStreaming && i === npcMessages.length - 1
                          }
                        >
                          {msg.content}
                        </ChatBubble>
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
              {roomMessages.map((msg) => {
                // 구조화 알림(R29·R30)은 발신자 종류와 무관하게 알림 렌더러가 그린다.
                if (msg.notice) {
                  return (
                    <RoomNoticeMessage
                      key={msg.id}
                      message={msg}
                      onOpenCard={onOpenNoticeCard}
                      onOpenCronJob={onOpenNoticeCronJob}
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
