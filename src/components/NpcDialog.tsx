"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import ChatInput from "./ChatInput";
import TaskChatView, { type TaskMessage } from "./TaskChatView";
import TaskInlineCard from "./TaskInlineCard";
import TaskPanel from "./TaskPanel";
import TaskConfirmButtons, { isTaskConfirmPrompt } from "./TaskConfirmButtons";
import MarkdownContent from "./ui/MarkdownContent";
import type { Task } from "./TaskCard";
import type { Socket } from "socket.io-client";

export interface NpcChatMessage {
  id?: string;
  responseRequestId?: string;
  responseTransient?: boolean;
  role: "player" | "npc";
  content: string;
  taskCard?: { taskId: string; npcTaskId: string; title: string; status: string };
}

interface NpcDialogProps {
  npcName: string;
  npcId: string;
  messages: NpcChatMessage[];
  isStreaming: boolean;
  onSend: (message: string, files?: File[]) => void;
  onClose: () => void;
  // Task session props
  tasks?: Task[];
  taskMessages?: Map<string, TaskMessage[]>;
  isTaskStreaming?: boolean;
  onTaskSend?: (taskId: string, message: string, files?: File[]) => void;
  activeTaskId?: string | null;
  onSetActiveTaskId?: (taskId: string | null) => void;
  // Socket + task actions (passed through to TaskPanel)
  socket?: Socket | null;
  onDeleteTask?: (taskId: string) => void;
  onRequestReportTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void;
  // Multi-adapter
  onResetChat?: () => void;
  adapterInfo?: { type: string; model?: string };
}

const COOLDOWN_MS = 2000;

export default function NpcDialog({
  npcName,
  npcId,
  messages,
  isStreaming,
  onSend,
  onClose,
  // Task session props
  tasks: _tasks = [],
  taskMessages = new Map(),
  isTaskStreaming = false,
  onTaskSend,
  activeTaskId = null,
  onSetActiveTaskId,
  // Socket + task actions
  socket = null,
  onDeleteTask,
  onRequestReportTask,
  onResumeTask,
  onCompleteTask,
  onResetChat,
  adapterInfo,
}: NpcDialogProps) {
  const t = useT();
  const [cooldown, setCooldown] = useState(false);
  const [tab, setTab] = useState<"chat" | "task">("chat");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadedTasks, setLoadedTasks] = useState<Task[]>([]);

  const activeTaskCount = loadedTasks.filter(
    (tk) => tk.status === "pending" || tk.status === "in_progress",
  ).length;

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSend = useCallback(
    (message: string, files?: File[]) => {
      if (cooldown || isStreaming) return;
      onSend(message, files);
      setCooldown(true);
      setTimeout(() => setCooldown(false), COOLDOWN_MS);
    },
    [cooldown, isStreaming, onSend],
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
      <div className="w-full max-w-[800px] pointer-events-auto">
        <div className="bg-bg border-t-2 border-x-2 border-amber-500 rounded-t-lg shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface rounded-t-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-700 flex items-center justify-center text-white font-bold text-lg">
                {npcName[0]}
              </div>
              <span className="text-npc font-bold text-lg">{npcName}</span>
            </div>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text px-2 py-1 text-sm"
              title={t("common.closeEsc")}
            >
              ESC
            </button>
          </div>

          {/* Tab Bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => {
                setTab("chat");
                onSetActiveTaskId?.(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold text-center ${tab === "chat" ? "text-npc border-b-2 border-amber-400" : "text-text-dim hover:text-text-secondary"}`}
            >
              💬 {t("chat.tab")}
            </button>
            <button
              onClick={() => {
                setTab("task");
                onSetActiveTaskId?.(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold text-center relative ${tab === "task" ? "text-npc border-b-2 border-amber-400" : "text-text-dim hover:text-text-secondary"}`}
            >
              📋 {t("task.tab")}
              {activeTaskCount > 0 && (
                <span className="absolute top-1 ml-0.5 bg-amber-500 text-black text-[9px] rounded-full min-w-[14px] h-[14px] flex items-center justify-center font-bold">
                  {activeTaskCount}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          {tab === "chat" ? (
            <>
              {/* Chat messages */}
              <div ref={scrollRef} className="h-48 overflow-y-auto px-4 py-3 space-y-2">
                {messages.length === 0 && (
                  <div className="text-text-dim text-sm italic">
                    {t("chat.npcPlaceholder", { name: npcName })}
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i}>
                    {msg.taskCard && (
                      <TaskInlineCard
                        taskId={msg.taskCard.taskId}
                        npcTaskId={msg.taskCard.npcTaskId}
                        title={msg.taskCard.title}
                        status={msg.taskCard.status}
                        onClick={(npcTaskId) => {
                          setTab("task");
                          onSetActiveTaskId?.(npcTaskId);
                        }}
                      />
                    )}
                    {msg.content && (
                      <div
                        className={`flex ${msg.role === "player" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                            msg.role === "player"
                              ? "bg-indigo-600 text-white"
                              : "bg-surface-raised text-text"
                          }`}
                        >
                          {msg.role === "npc" ? (
                            <MarkdownContent content={msg.content} />
                          ) : (
                            msg.content
                          )}
                          {msg.role === "npc" && isStreaming && i === messages.length - 1 && (
                            <span className="inline-block w-1.5 h-4 bg-amber-400 ml-0.5 animate-pulse" />
                          )}
                          {msg.role === "npc" &&
                            !isStreaming &&
                            i === messages.length - 1 &&
                            isTaskConfirmPrompt(msg.content) && (
                              <TaskConfirmButtons
                                onConfirm={() => onSend("등록해")}
                                onCancel={() => onSend("취소")}
                              />
                            )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Input — reuses ChatInput with file upload */}
              <ChatInput
                onSend={handleSend}
                disabled={isStreaming}
                cooldown={cooldown}
                maxLength={500}
                autoFocus
                showFileUpload
                accentColor="amber"
                placeholder={t("chat.npcPlaceholder", { name: npcName })}
                disabledPlaceholder={t("chat.responding")}
              />
              {/* Footer info bar — new conversation + adapter info */}
              <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-text-dim">
                <button
                  onClick={onResetChat}
                  disabled={isStreaming || !onResetChat}
                  className="flex items-center gap-1 text-text-muted hover:text-npc disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title={t("chat.newConversation")}
                >
                  <span>🔄</span>
                  <span>{t("chat.newConversation")}</span>
                </button>
                {adapterInfo && (
                  <span className="text-text-dim">
                    {adapterInfo.type === "openclaw"
                      ? "OpenClaw"
                      : adapterInfo.type.charAt(0).toUpperCase() + adapterInfo.type.slice(1)}
                    {adapterInfo.model && (
                      <span className="ml-1 text-gray-600">· {adapterInfo.model}</span>
                    )}
                  </span>
                )}
              </div>
            </>
          ) : activeTaskId ? (
            /* Task conversation view */
            <TaskChatView
              taskId={activeTaskId}
              taskTitle={
                loadedTasks.find((tk) => tk.npcTaskId === activeTaskId)?.title || activeTaskId
              }
              taskStatus={
                loadedTasks.find((tk) => tk.npcTaskId === activeTaskId)?.status || "pending"
              }
              messages={taskMessages.get(activeTaskId) || []}
              isStreaming={isTaskStreaming}
              onSend={(msg, files) => onTaskSend?.(activeTaskId, msg, files)}
              onBack={() => onSetActiveTaskId?.(null)}
            />
          ) : (
            /* Task list */
            <div className="h-48 overflow-y-auto">
              <TaskPanel
                npcId={npcId}
                npcName={npcName}
                socket={socket}
                onTaskClick={(npcTaskId) => onSetActiveTaskId?.(npcTaskId)}
                onDeleteTask={onDeleteTask}
                onRequestReportTask={onRequestReportTask}
                onResumeTask={onResumeTask}
                onCompleteTask={onCompleteTask}
                onTasksLoaded={setLoadedTasks}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
