"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useT } from "@/lib/i18n";
import { Pencil, UserMinus, RotateCcw, MessageSquare, ClipboardList, Undo2 } from "lucide-react";
import type { NpcChatMessage } from "./NpcDialog";
import TaskPanel from "./TaskPanel";
import TaskChatView, { type TaskMessage } from "./TaskChatView";
import ChatInput from "./ChatInput";
import Tab from "./ui/Tab";
import ChatBubble from "./ui/ChatBubble";
import RoomList from "./rooms/RoomList";
import RoomHeader from "./rooms/RoomHeader";
import RoomComposer from "./rooms/RoomComposer";
import SystemMessage from "./rooms/SystemMessage";
import type { RoomAction, RoomState } from "@/app/game/room-state";

interface ChatPanelProps {
  dialogNpc: { npcId: string; npcName: string } | null;
  npcMessages: NpcChatMessage[];
  /** 지금 NPC 가 무엇을 하는 중인지 알려 주는 번역 키. 없으면 표시하지 않는다. */
  npcActivityKey?: string | null;
  isNpcStreaming: boolean;
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
  socket?: Socket | null;
  onDeleteTask?: (taskId: string) => void;
  onRequestReportTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
  // Task session props
  taskMessages?: Map<string, TaskMessage[]>;
  isTaskStreaming?: boolean;
  onTaskSend?: (taskId: string, message: string, files?: File[]) => void;
  activeTaskId?: string | null;
  onSetActiveTaskId?: (taskId: string | null) => void;
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
  /**
   * 이 브라우저의 사용자 id. 클라이언트는 자기 신원을 정확히 모르므로 채널 소유자일 때만
   * 채워진다 — `room.createdBy` 와 맞춰 이름 변경·삭제 권한을 가린다.
   */
  currentUserId?: string;
  /** 방 안 화면(패널 열림 + DM/선택목록 아님)이 보이는지 — 맵의 NPC 대기 규칙이 이걸 본다. */
  onChannelChatVisibleChange?: (visible: boolean) => void;
  currentPlayerName?: string;
}

const MIN_WIDTH = 250;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 320;

export default function ChatPanel({
  dialogNpc,
  npcMessages,
  npcActivityKey = null,
  isNpcStreaming,
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
  currentUserId,
  onChannelChatVisibleChange,
  currentPlayerName,
  npcMoveState,
  onReturnNpc,
  socket,
  onDeleteTask,
  onRequestReportTask,
  onResumeTask,
  onCompleteTask,
  taskMessages,
  isTaskStreaming,
  onTaskSend,
  activeTaskId,
  onSetActiveTaskId,
}: ChatPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [manualOpen, setManualOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showGearMenu, setShowGearMenu] = useState(false);
  const [activeTabState, setActiveTabState] = useState<{
    npcId: string | null;
    tab: "chat" | "tasks";
  }>({
    npcId: null,
    tab: "chat",
  });
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelScrollRef = useRef<HTMLDivElement>(null);
  const activeNpcId = dialogNpc?.npcId ?? null;
  const activeTab = activeTabState.npcId === activeNpcId ? activeTabState.tab : "chat";
  const isOpen = manualOpen || !!dialogNpc || !!npcSelectList || !!channelChatOpen;
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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={() => setManualOpen(true)}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-20 bg-surface/80 hover:bg-surface-raised text-white px-1 py-4 rounded-r-lg"
        title={t("chat.openChat")}
      >
        &#9654;
      </button>
    );
  }

  const inNpcDialog = !!dialogNpc;
  const inNpcSelect = !!npcSelectList && !dialogNpc;

  const composeMode: "create" | "invite" = roomState.compose?.inviteTo ? "invite" : "create";

  /** 방 안에서 뒤로 — 방이 하나뿐이면 목록이 빈 화면이므로 패널을 접는다. */
  const backFromRoom = () => {
    if (roomState.rooms.length > 1) onRoomAction({ type: "showList" });
    else setManualOpen(false);
  };
  const backFromList = () => {
    if (roomState.currentRoomId) onRoomAction({ type: "open", roomId: roomState.currentRoomId });
    else setManualOpen(false);
  };

  return (
    <div ref={panelRef} className="fixed left-0 top-[40px] bottom-0 z-20 flex" style={{ width }}>
      {/* Panel content */}
      <div className="flex-1 flex flex-col bg-bg/95 backdrop-blur border-r border-border min-w-0">
        {/* Panel header — 방 안에서는 RoomHeader 가 이 자리를 대신한다(화살표가 두 줄이 되지 않게). */}
        {!inNpcDialog && !inNpcSelect && roomState.view === "room" && currentRoom ? (
          <RoomHeader
            room={currentRoom}
            canManage={!!currentUserId && currentRoom.createdBy === currentUserId}
            onBack={backFromRoom}
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
            {/* Tab Bar */}
            <Tab
              tabs={[
                {
                  key: "chat",
                  label: t("chat.title"),
                  icon: <MessageSquare className="w-3.5 h-3.5" />,
                },
                {
                  key: "tasks",
                  label: t("task.title"),
                  icon: <ClipboardList className="w-3.5 h-3.5" />,
                },
              ]}
              activeKey={activeTab}
              onChange={(key) =>
                setActiveTabState({ npcId: activeNpcId, tab: key as "chat" | "tasks" })
              }
            />
            {activeTab === "chat" ? (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                  {npcMessages.length === 0 && (
                    <div className="text-text-dim text-sm italic py-4">
                      {t("chat.npcPlaceholder", { name: dialogNpc!.npcName })}
                    </div>
                  )}
                  {npcMessages.map((msg, i) => (
                    <ChatBubble
                      key={i}
                      sender={msg.role === "player" ? "player" : "npc"}
                      streaming={
                        msg.role === "npc" && isNpcStreaming && i === npcMessages.length - 1
                      }
                    >
                      {msg.content}
                    </ChatBubble>
                  ))}
                </div>
                {/* 진행 상태 — 답변 본문과 섞이지 않는 별도 줄.
                    예전에는 tool.progress 를 채팅 청크로 흘려서 답이 두 번 보였다. */}
                {/* isStreaming 을 함께 보지 않는다 — 그 값은 **첫 답변 청크**가 와야
                    true 가 되는데, 도구는 그 전에 돈다. 실측(2026-08-28): web_search 가
                    3회 돌 동안 화면에 아무것도 뜨지 않았다. 활동 키가 있다는 것 자체가
                    "아직 진행 중"이라는 뜻이므로 그것만으로 충분하다. */}
                {npcActivityKey && (
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
                  placeholder={t("chat.npcPlaceholder", { name: dialogNpc!.npcName })}
                  disabled={!!npcChatInputDisabled || isNpcStreaming}
                  disabledPlaceholder={
                    npcChatInputDisabled
                      ? (npcChatDisabledPlaceholder ?? t("chat.disconnected"))
                      : t("chat.responding")
                  }
                  autoFocus
                  showFileUpload
                />
              </>
            ) : activeTaskId ? (
              <TaskChatView
                taskId={activeTaskId}
                taskTitle={activeTaskId}
                taskStatus="pending"
                messages={taskMessages?.get(activeTaskId) || []}
                isStreaming={isTaskStreaming || false}
                onSend={(msg, files) => onTaskSend?.(activeTaskId, msg, files)}
                onBack={() => onSetActiveTaskId?.(null)}
              />
            ) : (
              <TaskPanel
                npcId={dialogNpc!.npcId}
                npcName={dialogNpc!.npcName}
                socket={socket ?? null}
                onDeleteTask={onDeleteTask}
                onRequestReportTask={onRequestReportTask}
                onResumeTask={onResumeTask}
                onCompleteTask={onCompleteTask}
                onTaskClick={(npcTaskId) => onSetActiveTaskId?.(npcTaskId)}
              />
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
            npcCandidates={mentionCandidatesFor(null)}
            userCandidates={onlinePlayers.map((player) => ({ ...player, online: true }))}
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
            <div ref={channelScrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
              {roomMessages.length === 0 && (
                <div className="text-text-dim text-sm italic py-4 text-center">
                  {t("room.empty")}
                </div>
              )}
              {roomMessages.map((msg) => {
                if (msg.senderKind === "system") {
                  return <SystemMessage key={msg.id} content={msg.content} />;
                }
                const isMe = msg.senderKind === "user" && msg.senderName === currentPlayerName;
                return (
                  <ChatBubble
                    key={msg.id}
                    sender={isMe ? "player" : "npc"}
                    name={!isMe ? msg.senderName : undefined}
                  >
                    {msg.content}
                  </ChatBubble>
                );
              })}
            </div>
            <ChatInput
              onSend={onRoomSend}
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
