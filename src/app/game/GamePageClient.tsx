"use client";

import { npcMotionUi } from "./npc-motion-ui";
import { navigatorMotion } from "./conversation-integration";
import type { MotionSnapshot } from "@/game/motion-snapshot";

import { MapChatWalkers } from "./map-chat-walkers";
import { MapChatParticipants } from "./map-chat-participants";
import {
  Suspense,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useT, useLocale, LOCALES } from "@/lib/i18n";
import {
  MessageSquare,
  Undo2,
  Clock,
  Footprints,
  PhoneCall,
  Bell,
  ChevronDown,
  UserMinus,
  Settings,
  LogOut,
  Pencil,
  Users,
  Globe,
  RotateCcw,
  Bug,
  Info,
  KanbanSquare,
  AlarmClock,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { EventBus, setPendingChannelData, type PendingChannelData } from "@/game/EventBus";
import { decideChatError } from "./chat-error-dispatch";
import { initialRoomState, lastRoomKey, reduceRoomState } from "./room-state";
import { decideContextInvite } from "./context-invite-decision";
import type { RoomMessage, RoomSummary } from "@/lib/chat-rooms-policy";
import {
  buildPlacementRequest,
  keepsPlacementMode,
  placementBroadcastPlan,
} from "@/game/npc-placement-request";
import ChatPanel from "@/components/ChatPanel";
import ConversationPane from "@/components/conversation/ConversationPane";
import ConversationWorkspace from "@/components/conversation/ConversationWorkspace";
import MeetingWorkspace from "@/components/conversation/MeetingWorkspace";
import { useMeetingEntry } from "@/components/meeting-room/use-meeting-entry";
import "@/components/meeting-room/meeting-mode.css";
import WorkspaceNavigator, {
  type NavigatorNpc,
  type NpcNavigatorAction,
} from "@/components/conversation/WorkspaceNavigator";
import type { RosterNpc } from "@/components/NpcRoster";
import type { NpcChatMessage } from "@/components/NpcDialog";
import PasswordModal from "@/components/PasswordModal";
import ChannelSettingsModal from "@/components/ChannelSettingsModal";
import KanbanBoardModal from "@/components/kanban/KanbanBoardModal";
import CronModal from "@/components/cron/CronModal";
import {
  EMPTY_NPC_WORKING,
  parseNpcWorkingPayload,
  reduceNpcWorking,
  workingNpcIds,
  type NpcWorkingMap,
} from "./npc-working-state";
import { getLocalizedErrorMessage, getLocalizedMessage } from "@/lib/i18n/error-codes";
import { mentionSkipI18nKey } from "@/components/meeting-room/mention-skip-notice";
import type { MentionSkipReason } from "@/lib/conversation/floor-controller";
import { resolveNpcResponseChunk, type NpcResponsePayload } from "@/lib/npc-response-messages";
import type { ChatResponse } from "@/lib/chat-response";
import {
  npcPresentationPhases,
  initialChatResponseState,
  reconcileNpcResponseMessages,
  reduceChatResponseState,
  responsesForScope,
  upsertLegacyNpcChunk,
} from "./chat-response-state";

const APP_VERSION = "2026.918.1";
const BUG_REPORT_BASE_URL = "https://github.com/dandacompany/deskrpg/issues/new";
const SOURCE_CODE_URL = "https://github.com/dandacompany/deskrpg";
const LICENSE_URL = `${SOURCE_CODE_URL}/blob/main/LICENSE.md`;
const THIRD_PARTY_LICENSES_URL = "/third-party-licenses.html";
const INSTANCE_ID_STORAGE_KEY = "deskrpg.instanceId";

function GameEngineLoading() {
  const t = useT();

  return (
    <div className="fixed inset-0 bg-surface flex items-center justify-center text-text-muted">
      {t("game.loadingEngine")}
    </div>
  );
}

// Load the Three.js office presentation on the client.
const ThreeGame = dynamic(() => import("@/components/ThreeGame"), {
  ssr: false,
  loading: () => <GameEngineLoading />,
});

/**
 * 외형 원본은 DB 의 JSON 이다. 맵(ThreeGame)은 `officeLookId` 만 읽고, 회의·목록 컴포넌트가
 * 나머지를 해석한다 — 그 컴포넌트들의 prop 타입을 그대로 빌려 이 파일은 외형 포맷을 모른다.
 */
type CharacterAppearanceData = ComponentProps<typeof MeetingWorkspace>["character"]["appearance"];

interface Character {
  id: string;
  name: string;
  appearance: CharacterAppearanceData;
}

interface GameNotification {
  id: string;
  message: string;
  timestamp: number;
  read: boolean;
}

interface ChannelInfo {
  id: string;
  ownerId?: string;
  name: string;
  description: string | null;
  inviteCode: string | null;
  mapData: unknown;
  mapConfig: unknown;
  isPublic: boolean;
  isMember?: boolean;
  isOwner?: boolean;
  hasGateway: boolean;
  gatewayConfig?: {
    gatewayId?: string | null;
    url?: string | null;
    token?: string | null;
  } | null;
}

interface ChannelPlayerSummary {
  id: string;
  userId?: string;
  name: string;
  appearance: CharacterAppearanceData | null;
}

function getSocketServerUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const explicitUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (explicitUrl) return explicitUrl;

  if (process.env.NODE_ENV !== "production") return undefined;

  const { protocol, hostname, port } = window.location;
  const currentPort = Number.parseInt(port, 10);
  if (!Number.isFinite(currentPort)) return undefined;

  return `${protocol}//${hostname}:${currentPort + 1}`;
}

type GamePageClientProps = {
  /**
   * 3D 를 더 이상 띄울 수 없을 때(렌더러 초기화 실패·WebGL 컨텍스트 소실) 부른다.
   * 부르기 전에 소켓을 끊어 반쯤 살아 있는 채널 화면을 남기지 않는다.
   */
  onFatal?: () => void;
};

export default function GamePage({ onFatal }: GamePageClientProps = {}) {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      }
    >
      <GamePageInner onFatal={onFatal} />
    </Suspense>
  );
}

function GamePageInner({ onFatal }: GamePageClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useT();
  const { locale, setLocale } = useLocale();
  const characterId = searchParams.get("characterId");
  const channelId = searchParams.get("channelId");

  const [character, setCharacter] = useState<Character | null>(null);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [gameChannelData, setGameChannelData] = useState<PendingChannelData>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // playerCount is derived from channelPlayers array length
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // 칸반 보드(T8). `kanbanRefreshTick` 은 `kanban:event` 마다 오르고, 모달이 디바운스해 재조회한다.
  const [showKanban, setShowKanban] = useState(false);
  useEffect(() => {
    const open = () => setShowKanban(true);
    EventBus.on("kanban:open", open);
    return () => {
      EventBus.off("kanban:open", open);
    };
  }, []);
  const [kanbanRefreshTick, setKanbanRefreshTick] = useState(0);
  // 방 알림의 "카드 열기"(R29) — 모달이 마운트될 때 이 카드의 상세를 편다.
  const [kanbanInitialTaskId, setKanbanInitialTaskId] = useState<string | null>(null);
  // 채널 크론 화면(T10, R15). "이력 열기"(R30) 는 그 잡의 실행 이력으로 연다.
  const [showCron, setShowCron] = useState(false);
  const [cronInitialJobId, setCronInitialJobId] = useState<string | null>(null);
  // 맵의 "작업 중"(R27). 소켓의 `npc:working` 만 담는다 — 낙관적 갱신 없음(R26).
  const [npcWorking, setNpcWorking] = useState<NpcWorkingMap>(EMPTY_NPC_WORKING);
  const meetingEntry = useMeetingEntry(socket, channelId);
  const mode = ["joining", "joined"].includes(meetingEntry.state.status) ? "meeting" : "office";
  // Map rendering needs only placed NPC identity and appearance.
  const [channelNpcs, setChannelNpcs] = useState<
    {
      id: string;
      name: string;
      appearance: unknown;
    }[]
  >([]);
  // 맵용 목록(`channelNpcs`)은 배치·출근한 것만이다. 출근부는 자리 없는·퇴근한 NPC 도
  // 보여야 하므로 `?roster=1` 로 따로 읽는다.
  const [rosterNpcs, setRosterNpcs] = useState<RosterNpc[]>([]);
  const [channelPlayers, setChannelPlayers] = useState<ChannelPlayerSummary[]>([]);
  const [conversationPanelWidth, setConversationPanelWidth] = useState(388);

  // Ref to track current dialogNpc for use inside socket listeners (must be declared before sync effect)
  const dialogNpcRef = useRef<{ npcId: string; npcName: string } | null>(null);

  // NPC dialog state — all managed here, ChatPanel is pure display
  const [npcActivityKey, setNpcActivityKey] = useState<string | null>(null);
  const [dialogNpc, setDialogNpc] = useState<{ npcId: string; npcName: string } | null>(null);
  // Keep ref in sync so socket listeners can read current value without stale closure
  useEffect(() => {
    dialogNpcRef.current = dialogNpc;
  }, [dialogNpc]);
  const [npcMessages, setNpcMessages] = useState<NpcChatMessage[]>([]);
  const [isNpcStreaming, setIsNpcStreaming] = useState(false);
  const [chatResponses, dispatchChatResponse] = useReducer(
    reduceChatResponseState,
    initialChatResponseState,
  );
  useEffect(() => {
    const publish = () =>
      EventBus.emit("npc:response-phases", { phases: npcPresentationPhases(chatResponses) });
    publish();
    EventBus.on("scene-ready", publish);
    return () => {
      EventBus.off("scene-ready", publish);
    };
  }, [chatResponses]);
  // 작업 중 목록도 같은 길로 맵에 넘긴다. 씬이 늦게 뜨면 `scene-ready` 에서 다시 보낸다.
  useEffect(() => {
    const publish = () => EventBus.emit("npc:working-state", { npcIds: workingNpcIds(npcWorking) });
    publish();
    EventBus.on("scene-ready", publish);
    return () => {
      EventBus.off("scene-ready", publish);
    };
  }, [npcWorking]);
  const [npcSelectList, setNpcSelectList] = useState<{ npcId: string; npcName: string }[] | null>(
    null,
  );
  const [interactSelectList, setInteractSelectList] = useState<
    { id: string; name: string; type: "npc" | "player" }[] | null
  >(null);

  // Channel chat state — 방(room)별로 갈린다. 서버는 `room:*` 만 말한다.
  const [roomState, dispatchRoom] = useReducer(reduceRoomState, initialRoomState);
  const currentRoomId = roomState.currentRoomId;
  /**
   * 지금 `room:open` 을 걸어 둔 방. 방을 옮길 때 이전 방을 닫으려면 필요하고,
   * 재접속하면 서버의 `openRooms` 가 비므로 null 로 되돌려 다시 열게 한다.
   */
  const openedRoomRef = useRef<string | null>(null);
  /**
   * 내가 만든 방인가. 클라이언트는 자기 user id 를 모르므로(뷰어 신원 엔드포인트가 없다)
   * `room:create` 에 일회용 표를 실어 보내고, 서버가 **요청한 소켓에만** 그 표를 되돌려 준다.
   * 이름으로 가르면 같은 이름을 동시에 만든 두 사람이 서로의 방으로 끌려 들어간다.
   */
  const pendingCreateRef = useRef<string | null>(null);
  const [channelChatOpen, setChannelChatOpen] = useState(false);
  const [channelChatInputDisabled, setChannelChatInputDisabled] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notification state
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  const characterNameRef = useRef<string>("");
  const characterAppearanceRef = useRef<CharacterAppearanceData | null>(null);

  // NPC greeting messages (stored until dialog opens)
  const npcGreetings = useRef<Map<string, string>>(new Map());
  const npcMessagesRef = useRef<NpcChatMessage[]>([]);
  /**
   * 맵 채팅 지명 때문에 걸어오는 중인 NPC 들. 도착했을 때 1:1 대화창을 **열지 않기**
   * 위해서다 — 대답은 맵 채팅에 나오는데 대화창이 뜨면 그 채팅을 가려 버린다.
   * 컨텍스트 메뉴로 부른 경우(자동으로 대화창을 여는 기존 동작)와는 다른 사건이다.
   */
  const mapChatWalkersRef = useRef<MapChatWalkers>(new MapChatWalkers());
  const mapChatParticipantsRef = useRef<MapChatParticipants>(new MapChatParticipants());
  /** 채널 채팅 패널이 지금 보이는가(ChatPanel 이 알려 준다) — 씬에 전달한다. */
  const [channelChatVisible, setChannelChatVisible] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const returnToKanbanRef = useRef(false);
  const [channelSettingsInitialTab, setChannelSettingsInitialTab] = useState<
    "settings" | "members" | "gateway"
  >("settings");
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [meetingMinutesCount, setMeetingMinutesCount] = useState(0);

  // Owner & NPC management state
  const [isOwner, setIsOwner] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [spawnSetMode, setSpawnSetMode] = useState(false);
  // 배치할 NPC 는 **이미 존재하는 행** 이다. 만드는 것이 아니라 자리를 주는 것이라
  // id 하나면 된다(이름·페르소나·외형은 프로필이 정본이다).
  const [pendingNpc, setPendingNpc] = useState<{ id: string; wasPlaced: boolean } | null>(null);
  // npcMenu removed — Edit/Fire now in ChatPanel gear menu

  // NPC context menu (right-click) state
  const [contextMenu, setContextMenu] = useState<{
    npcId: string;
    npcName: string;
    x: number;
    y: number;
    moveState: string;
  } | null>(null);

  const [npcMoveStates, setNpcMoveStates] = useState<Record<string, string>>({});
  const npcMoveStatesRef = useRef<Record<string, string>>({});
  // 씬은 "지금 어느 방이 보이는가" 를 본다 — 패널이 닫혔거나 방이 없으면 null 이다.
  // 두 값 중 하나만 바뀌어도 항상 최신 조합을 보내야 하므로 한 effect 에서 낸다.
  useEffect(() => {
    EventBus.emit("room:visible", { roomId: channelChatVisible ? currentRoomId : null });
  }, [channelChatVisible, currentRoomId]);
  useEffect(() => {
    npcMoveStatesRef.current = npcMoveStates;
  }, [npcMoveStates]);
  const npcMotionSnapshotRef = useRef<MotionSnapshot | null>(null);
  const [npcCallers, setNpcCallers] = useState<Record<string, string>>({}); // npcId → callerSocketId

  // Ref to accumulate streaming text (avoids setState-in-effect issues)
  const streamBufferRef = useRef("");
  const socketRef = useRef<Socket | null>(null);
  // Current player position — updated from the simulation for beforeunload save
  const playerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [instanceId, setInstanceId] = useState("");
  const [debugCopied, setDebugCopied] = useState(false);

  // 3D 가 죽으면 채널 화면을 더 유지할 이유가 없다 — 소켓부터 끊고 관문에 알린다.
  const handleGameFatal = useCallback(() => {
    const socketInstance = socketRef.current;
    if (socketInstance) {
      socketInstance.removeAllListeners();
      socketInstance.disconnect();
      socketRef.current = null;
    }
    onFatal?.();
  }, [onFatal]);

  const openChannelSettings = useCallback(
    (initialTab: "settings" | "members" | "gateway" = "settings") => {
      setChannelSettingsInitialTab(initialTab);
      setShowChannelSettings(true);
    },
    [],
  );

  const openBugReport = useCallback(() => {
    const userAgent = typeof window !== "undefined" ? window.navigator.userAgent : "unknown";
    const body = [
      "## 문제 설명",
      "",
      "",
      "## 재현 방법",
      "",
      "",
      "## 기대 결과",
      "",
      "",
      "## 실제 결과",
      "",
      "",
      "## 디버그 정보",
      "",
      `- version: v${APP_VERSION}`,
      `- browser: ${userAgent}`,
    ].join("\n");

    const params = new URLSearchParams({
      labels: "bug-report",
      body,
    });

    window.open(`${BUG_REPORT_BASE_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
  }, []);

  const copyDebugInformation = useCallback(async () => {
    const debugInfo = [
      `version: v${APP_VERSION}`,
      `browser: ${typeof window !== "undefined" ? window.navigator.userAgent : "unknown"}`,
      `url: ${typeof window !== "undefined" ? window.location.href : "unknown"}`,
      `instanceId: ${instanceId || "unknown"}`,
      `locale: ${locale}`,
    ].join("\n");

    await navigator.clipboard.writeText(debugInfo);
    setDebugCopied(true);
    setTimeout(() => setDebugCopied(false), 2000);
  }, [instanceId, locale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let nextId = window.localStorage.getItem(INSTANCE_ID_STORAGE_KEY);
    if (!nextId) {
      nextId =
        window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(INSTANCE_ID_STORAGE_KEY, nextId);
    }
    setInstanceId(nextId);
  }, []);

  // Redirect to channel select if no channelId
  useEffect(() => {
    if (!channelId && characterId) {
      router.replace(`/channels?characterId=${characterId}`);
    } else if (!channelId && !characterId) {
      router.replace("/characters");
    }
  }, [channelId, characterId, router]);

  // Track player position for beforeunload save
  useEffect(() => {
    if (!channelId) return;
    // Poll position every 15s and update ref
    const interval = setInterval(() => {
      let resolved = false;
      const handler = (data: { x: number; y: number }) => {
        resolved = true;
        EventBus.off("player-position-response", handler);
        playerPositionRef.current = data;
      };
      EventBus.on("player-position-response", handler);
      EventBus.emit("request-player-position");
      setTimeout(() => {
        if (!resolved) EventBus.off("player-position-response", handler);
      }, 500);
    }, 15000);

    // Save position on page unload (refresh, tab close)
    const handleUnload = () => {
      // EventBus is synchronous — get fresh position immediately
      let freshPos: { x: number; y: number } | null = null;
      const syncHandler = (data: { x: number; y: number }) => {
        freshPos = data;
      };
      EventBus.on("player-position-response", syncHandler);
      EventBus.emit("request-player-position");
      EventBus.off("player-position-response", syncHandler);

      const pos = freshPos ?? playerPositionRef.current;
      if (!pos) return;
      // fetch with keepalive continues after page navigation
      fetch(`/api/channels/${channelId}/save-position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [channelId]);

  const showToastNotification = useCallback((id: string, message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);
    setNotifications((prev) =>
      [{ id, message, timestamp: Date.now(), read: false }, ...prev].slice(0, 20),
    );
  }, []);
  // 크론 화면·탭의 토스트(R19). id 는 메시지마다 새로 — 알림 목록에 겹치지 않게.
  const cronToast = useCallback(
    (message: string) => showToastNotification(`cron-${Date.now()}`, message),
    [showToastNotification],
  );

  // Socket.io connection (dynamic import to avoid SSR window access)
  useEffect(() => {
    let socketInstance: Socket | null = null;
    let cancelled = false;
    const leavePage = () => socketInstance?.disconnect();
    const restorePage = (event: PageTransitionEvent) => {
      if (event.persisted && !cancelled) socketInstance?.connect();
    };
    window.addEventListener("pagehide", leavePage);
    window.addEventListener("pageshow", restorePage);

    import("socket.io-client").then(({ io }) => {
      if (cancelled) return;
      socketInstance = io(getSocketServerUrl(), {
        path: "/socket.io",
        transports: ["websocket"],
        upgrade: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 3000,
        timeout: 10000,
      });
      setSocket(socketInstance);
      socketRef.current = socketInstance;
      setSocketConnected(socketInstance.connected);

      socketInstance.on("connect", () => {
        setSocketConnected(true);
        setIsNpcStreaming(false);
        if (channelId) {
          socketInstance?.emit("room:list", { channelId });
        }
        const openNpc = dialogNpcRef.current;
        if (openNpc) {
          socketInstance?.emit("npc:history", {
            npcId: openNpc.npcId,
            characterId: characterId ?? undefined,
          });
        }
      });
      socketInstance.on("disconnect", (reason: string) => {
        npcMotionSnapshotRef.current = null;
        setSocketConnected(false);
        setIsNpcStreaming(false);
        setNpcActivityKey(null);
        dispatchChatResponse({ type: "disconnect" });
        setNpcMessages((previous) => previous.filter((message) => !message.responseTransient));
        // 서버의 openRooms 는 소켓별 상태다 — 끊기면 비므로 다시 열어야 한다.
        openedRoomRef.current = null;
        showToastNotification("socket-disconnected", t("game.socketDisconnected", { reason }));
      });
      socketInstance.on("room:error", (payload: unknown) => {
        const { toastKey, rejoin, backToList } = decideChatError(payload);
        showToastNotification("channel-chat-error", t(toastKey));
        if (rejoin) EventBus.emit("socket-rejoin");
        if (backToList) {
          // 그 방은 사라졌거나 권한을 잃었다 — 목록으로 돌아가 서버에서 새로 받는다.
          dispatchRoom({ type: "showList" });
          if (channelId) socketInstance?.emit("room:list", { channelId });
        }
      });
      socketInstance.on("connect_error", (error: Error) => {
        setSocketConnected(false);
        setIsNpcStreaming(false);
        console.error("[page] socket connect_error", {
          message: error.message,
          description:
            "description" in error
              ? (error as Error & { description?: unknown }).description
              : undefined,
          context:
            "context" in error ? (error as Error & { context?: unknown }).context : undefined,
          type: "type" in error ? (error as Error & { type?: unknown }).type : undefined,
        });
        showToastNotification("socket-connect-error", t("game.socketConnectFailed"));
      });

      socketInstance.on("players:state", (data: { players: unknown[] }) => {
        // This acknowledgement arrives after authentication and handler registration.
        if (channelId) {
          socketInstance?.emit("room:list", { channelId });
        }
        setChannelPlayers([
          {
            id: "__self__",
            name: characterNameRef.current || t("game.you"),
            appearance: characterAppearanceRef.current ?? null,
          },
          ...(
            (data.players || []) as {
              id: string;
              userId?: string;
              characterName: string;
              appearance?: CharacterAppearanceData | null;
            }[]
          ).map((player) => ({
            id: player.id,
            userId: player.userId,
            name: player.characterName,
            appearance: player.appearance ?? null,
          })),
        ]);
      });
      socketInstance.on(
        "player:joined",
        (player: {
          id: string;
          userId?: string;
          characterName: string;
          appearance?: CharacterAppearanceData | null;
        }) => {
          setChannelPlayers((prev) => {
            if (prev.some((existing) => existing.id === player.id)) return prev;
            return [
              ...prev,
              {
                id: player.id,
                userId: player.userId,
                name: player.characterName,
                appearance: player.appearance ?? null,
              },
            ];
          });
        },
      );
      socketInstance.on("player:left", ({ id }: { id: string }) => {
        setChannelPlayers((prev) => prev.filter((player) => player.id !== id));
      });

      // 방 목록과 히스토리 — 목록은 connect 뒤에, 히스토리는 room:open 의 응답이다.
      socketInstance.on(
        "room:list-response",
        (data: { rooms: RoomSummary[]; viewerUserId?: string }) => {
          let preferRoomId: string | null = null;
          try {
            preferRoomId = channelId ? window.localStorage.getItem(lastRoomKey(channelId)) : null;
          } catch {
            preferRoomId = null;
          }
          dispatchRoom({
            type: "list",
            rooms: data.rooms || [],
            preferRoomId,
            viewerUserId: data.viewerUserId ?? null,
          });
        },
      );

      socketInstance.on("room:history", (data: { roomId: string; messages: RoomMessage[] }) => {
        dispatchRoom({ type: "history", roomId: data.roomId, messages: data.messages || [] });
      });

      socketInstance.on("room:created", (data: { room: RoomSummary; requestId?: string }) => {
        const enter = data.requestId != null && data.requestId === pendingCreateRef.current;
        if (enter) pendingCreateRef.current = null;
        dispatchRoom({ type: "created", room: data.room, enter });
      });

      socketInstance.on("room:updated", (data: { room: RoomSummary }) => {
        dispatchRoom({ type: "updated", room: data.room, enter: false });
      });

      socketInstance.on("room:deleted", (data: { roomId: string }) => {
        if (openedRoomRef.current === data.roomId) openedRoomRef.current = null;
        dispatchRoom({ type: "deleted", roomId: data.roomId });
      });

      // NPC chat history (sent on demand) — only apply if it matches the current dialog
      socketInstance.on(
        "npc:history",
        (data: {
          npcId: string;
          messages: { id?: string; responseRequestId?: string; role: string; content: string }[];
        }) => {
          if (!dialogNpcRef.current || dialogNpcRef.current.npcId !== data.npcId) return;
          const historyMessages = (data.messages || []).map<NpcChatMessage>((m) => ({
            role: m.role === "npc" ? "npc" : "player",
            content: m.content,
            id: m.id,
            responseRequestId: m.responseRequestId,
          }));
          setNpcMessages(historyMessages);
        },
      );

      // Room messages
      socketInstance.on("room:message", (data: { roomId: string; message: RoomMessage }) => {
        const msg = data.message;
        dispatchRoom({ type: "message", roomId: data.roomId, message: msg });
        if (msg.senderKind === "system") return;
        // Show speech bubble on map
        if (msg.senderId) {
          EventBus.emit("chat:bubble", { senderId: msg.senderId });
          EventBus.emit("chat:speech", { actorId: msg.senderId, text: msg.content });
        }
        // Add notification + toast if not from self
        if (msg.senderName !== characterNameRef.current) {
          const preview = msg.content.length > 30 ? msg.content.slice(0, 30) + "..." : msg.content;
          showToastNotification(msg.id, `${msg.senderName}: ${preview}`);
        }
      });

      socketInstance.on(
        "room:response-state",
        (data: { roomId: string; response: ChatResponse }) => {
          if (data.response.content)
            EventBus.emit("chat:speech", {
              actorId: data.response.npcId,
              text: data.response.content,
            });
          dispatchChatResponse({
            type: "state",
            scope: "room",
            scopeId: data.roomId,
            response: data.response,
          });
        },
      );
      socketInstance.on(
        "room:response-snapshot",
        (data: { roomId: string; responses: ChatResponse[] }) => {
          dispatchChatResponse({
            type: "snapshot",
            scope: "room",
            scopeId: data.roomId,
            responses: data.responses || [],
          });
        },
      );
      socketInstance.on("npc:response-state", (data: { response: ChatResponse }) => {
        if (data.response.content)
          EventBus.emit("chat:speech", {
            actorId: data.response.npcId,
            text: data.response.content,
          });
        dispatchChatResponse({
          type: "state",
          scope: "npc",
          scopeId: data.response.npcId,
          response: data.response,
        });
        if (dialogNpcRef.current?.npcId === data.response.npcId) {
          setNpcMessages((previous) => reconcileNpcResponseMessages(previous, [data.response]));
          if (
            data.response.status === "complete" ||
            data.response.status === "failed" ||
            data.response.status === "cancelled"
          ) {
            setNpcActivityKey(null);
          }
        }
      });
      socketInstance.on(
        "npc:response-snapshot",
        (data: { npcId: string; responses: ChatResponse[] }) => {
          dispatchChatResponse({
            type: "snapshot",
            scope: "npc",
            scopeId: data.npcId,
            responses: data.responses || [],
          });
          if (dialogNpcRef.current?.npcId === data.npcId) {
            setNpcMessages((previous) =>
              reconcileNpcResponseMessages(previous, data.responses || [], {
                replaceTransient: true,
              }),
            );
            const hasActive = (data.responses || []).some(
              (response) =>
                response.status === "queued" ||
                response.status === "thinking" ||
                response.status === "streaming",
            );
            if (!hasActive) setNpcActivityKey(null);
          }
        },
      );

      // 자유채팅 전용 알림 — 회의 전용 이벤트를 맵 룸으로 재사용하지 않는다. 맵 룸 방송은
      // 회의 중인 사람에게도 닿는데(회의 참가자는 맵 룸을 떠나지 않는다), 그러면 남의 맵
      // 사건이 진행 중인 회의 트랜스크립트에 삽입된다.
      socketInstance.on(
        "room:mention-skipped",
        (data: {
          roomId: string;
          npcId?: string;
          npcName?: string;
          reason: MentionSkipReason | "no_match";
        }) => {
          if (data.roomId !== openedRoomRef.current) return;
          if (data.reason === "no_match") {
            // 지목이 아무 멤버에도 안 맞았다 — 특정 NPC 가 없으므로 이름 없는 토스트.
            showToastNotification(`chat-mention-no-match-${Date.now()}`, t("room.mentionNoMatch"));
            return;
          }
          showToastNotification(
            `chat-mention-skipped-${data.npcId}-${Date.now()}`,
            t(mentionSkipI18nKey(data.reason), { name: data.npcName ?? "" }),
          );
        },
      );

      // 실패한 턴(타임아웃·어댑터 에러·빈 응답). 맵에는 스트리밍 말풍선이 없어 이 신호가
      // 없으면 사용자에게는 자기 말풍선 하나만 남는다.
      socketInstance.on(
        "room:npc-aborted",
        (data: { roomId: string; npcId: string; npcName: string; reason: string }) => {
          if (data.roomId !== openedRoomRef.current) return;
          showToastNotification(
            `chat-npc-aborted-${data.npcId}-${Date.now()}`,
            t(data.reason === "queue_full" ? "chat.npcQueueFull" : "chat.npcNoResponse", {
              name: data.npcName,
            }),
          );
        },
      );

      socketInstance.on("member:kicked", () => {
        alert(t("game.removedFromChannel"));
        router.push(`/channels?characterId=${characterId}`);
      });

      socketInstance.on(
        "map:refresh",
        (data: { channelId: string; protocolVersion: number; phase: string }) => {
          if (data.channelId !== channelId || data.protocolVersion !== 1) return;
          if (data.phase === "begin") EventBus.emit("map-refresh-start");
          if (data.phase === "ready") window.location.reload();
        },
      );

      socketInstance.on("channel:updated", (data: { name?: string; isPublic?: boolean }) => {
        setChannel((prev) => (prev ? { ...prev, ...data } : prev));
      });

      socketInstance.on("channel:deleted", () => {
        alert(t("game.channelDeleted"));
        router.push(`/channels?characterId=${characterId}`);
      });

      socketInstance.on(
        "channel:access-denied",
        (data: { channelId?: string; action?: string; reason?: string; errorCode?: string }) => {
          setIsNpcStreaming(false);
          showToastNotification(
            `channel-access-denied-${data.action ?? "unknown"}-${data.reason ?? "unknown"}`,
            getLocalizedErrorMessage(t, data, "errors.forbidden"),
          );
        },
      );

      socketInstance.on("session:kicked", (data: { reason: string }) => {
        setIsNpcStreaming(false);
        alert(getLocalizedMessage(t, data.reason, "game.sessionKicked"));
        router.push(`/channels?characterId=${characterId}`);
      });

      socketInstance.on("join-error", () => {
        setIsNpcStreaming(false);
        router.push(`/channels?characterId=${characterId}`);
      });

      socketInstance.on("npc:motion-state", (snapshot: MotionSnapshot) => {
        if (snapshot.channelId !== channelId) return;
        npcMotionSnapshotRef.current = snapshot;
        setNpcMoveStates(
          Object.fromEntries(
            snapshot.npcs.map((npc) => [
              npc.npcId,
              npc.phase === "called"
                ? "moving-to-player"
                : npc.phase === "ambient"
                  ? "idle"
                  : npc.phase,
            ]),
          ),
        );
        setNpcCallers(
          Object.fromEntries(
            snapshot.npcs
              .filter((npc) => npc.ownerSocketId && npc.phase !== "ambient")
              .map((npc) => [npc.npcId, npc.ownerSocketId!]),
          ),
        );
      });
      // NPC movement socket events — relay to the simulation via EventBus
      socketInstance.on(
        "npc:come-to-player",
        (data: { npcId: string; targetPlayerId: string; reason?: string; roomId?: string }) => {
          // Room-runtime also emits this legacy intent directly. Acquire the same server
          // claim before driving; the coordinator replies with snapshot then this event.
          if (
            npcMotionSnapshotRef.current?.npcs.find((npc) => npc.npcId === data.npcId)
              ?.ownerSocketId !== data.targetPlayerId
          ) {
            if (data.targetPlayerId === socketInstance?.id)
              socketInstance?.emit("npc:call", {
                channelId,
                npcId: data.npcId,
                ...(data.reason ? { reason: data.reason } : {}),
                ...(data.roomId ? { roomId: data.roomId } : {}),
              });
            return;
          }
          EventBus.emit("npc:movement-owner", { npcId: data.npcId, ownerId: data.targetPlayerId });
          setNpcCallers((prev) => ({ ...prev, [data.npcId]: data.targetPlayerId }));
          // Only the caller runs local A* pathfinding; other clients follow npc:position-sync
          if (socketInstance && data.targetPlayerId === socketInstance.id) {
            // 표시는 도착 시점에 정해지지만 사유는 지금만 알 수 있다. 근거리면 아래 emit 이
            // 그 자리에서 도착까지 진행하므로, 반드시 emit 앞에서 기록해야 한다.
            // 컨텍스트 메뉴 호출(reason 없음)은 이전 맵 채팅 대기를 무효화한다. 지우지 않으면
            // 그 NPC 가 도착했을 때 사용자가 방금 명시적으로 요청한 1:1 대화창이 삼켜진다 —
            // 시뮬레이션은 이미 걷고 있는 NPC 의 재호출을 조용히 무시하므로, 도착은 원래
            // 걷기로 일어나고 항목은 그때까지 살아 있다.
            mapChatWalkersRef.current.noteCall(data.npcId, data.reason);
            mapChatParticipantsRef.current.noteCalled(data.roomId, data.npcId, data.reason);
            EventBus.emit("npc:call-to-player", {
              npcId: data.npcId,
              reason: data.reason,
              roomId: data.roomId,
            });
          }
        },
      );

      // Generic NPC chat responses stay in the dialog — nothing pulls the NPC over.
      socketInstance.on("npc:response-complete", () => {});

      // 진행 상태. 대화창이 열려 있으면 창 안 상태 줄로, 아니면 맵 위 말풍선으로 —
      // 같은 사실을 두 군데 동시에 띄우지 않는다.
      socketInstance.on("npc:activity", (data: { npcId: string; activityKey?: string | null }) => {
        const key = data.activityKey ?? null;
        const inDialog = dialogNpcRef.current?.npcId === data.npcId;
        if (inDialog) {
          setNpcActivityKey(key);
          EventBus.emit("npc:activity-bubble", { npcId: data.npcId });
          return;
        }
        setNpcActivityKey(null);
        EventBus.emit("npc:activity-bubble", {
          npcId: data.npcId,
          text: key ? t(key) : undefined,
        });
      });

      socketInstance.on("npc:returning", (data: { npcId: string }) => {
        EventBus.emit("npc:start-return", { npcId: data.npcId });
      });

      // NPC response streaming — DM messages only
      socketInstance.on("npc:response", (data: NpcResponsePayload) => {
        if (data.responseRequestId) return;
        const chunk = resolveNpcResponseChunk(data, t);
        // Ignore responses for NPCs not in the current dialog
        if (dialogNpcRef.current && dialogNpcRef.current.npcId !== data.npcId) return;

        if (chunk) {
          const continuing = streamBufferRef.current.length > 0;
          streamBufferRef.current += chunk;
          const buffered = streamBufferRef.current;
          EventBus.emit("chat:speech", { actorId: data.npcId, text: buffered });
          setIsNpcStreaming(true);
          setNpcMessages((prev) => upsertLegacyNpcChunk(prev, buffered, continuing));
        }
        if (data.done) {
          setIsNpcStreaming(false);
          const hadBufferedContent = streamBufferRef.current.length > 0;
          const cleaned = streamBufferRef.current.trim();
          if (hadBufferedContent) {
            setNpcMessages((prev) => {
              const lastIdx = prev.length - 1;
              if (lastIdx >= 0 && prev[lastIdx].role === "npc") {
                const updated = [...prev];
                updated[lastIdx] = { ...updated[lastIdx], content: cleaned };
                return updated;
              }
              return prev;
            });
          }
          streamBufferRef.current = "";
        }
      });

      // Request initial room list for this channel
      if (channelId) {
        socketInstance.emit("room:list", { channelId });
      }
    });

    return () => {
      cancelled = true;
      npcMotionSnapshotRef.current = null;
      window.removeEventListener("pagehide", leavePage);
      window.removeEventListener("pageshow", restorePage);
      if (socketInstance) {
        socketInstance.off("room:error");
        socketInstance.off("room:list-response");
        socketInstance.off("room:history");
        socketInstance.off("room:message");
        socketInstance.off("room:response-state");
        socketInstance.off("room:response-snapshot");
        socketInstance.off("npc:response-state");
        socketInstance.off("npc:response-snapshot");
        socketInstance.off("room:created");
        socketInstance.off("room:updated");
        socketInstance.off("room:deleted");
        socketInstance.off("room:mention-skipped");
        socketInstance.off("room:npc-aborted");
        socketInstance.removeAllListeners();
        socketInstance.disconnect();
      }
      // removeAllListeners() 가 disconnect 핸들러를 먼저 떼므로 그 안의 리셋이 안 돈다.
      // 소켓이 재생성되면 room:open 이펙트가 새 소켓에 무조건 다시 열도록 여기서 리셋한다.
      openedRoomRef.current = null;
      setSocket(null);
      setSocketConnected(false);
      setChannelPlayers([]);
      socketRef.current = null;
    };
  }, [channelId, characterId, router, showToastNotification, t]);

  // Shared dialog state reset
  const resetDialog = useCallback(() => {
    setDialogNpc(null);
    dialogNpcRef.current = null;
    setNpcMessages([]);
    npcMessagesRef.current = [];
    setIsNpcStreaming(false);
    setNpcSelectList(null);
    streamBufferRef.current = "";
    setNpcActivityKey(null);
  }, []);

  // Keep refs in sync with state for use in socket handlers
  useEffect(() => {
    npcMessagesRef.current = npcMessages;
  }, [npcMessages]);

  // Listen for NPC interact event from the simulation
  useEffect(() => {
    const handleNpcInteract = (data: { npcId: string; npcName: string }) => {
      resetDialog();
      // If NPC has a stored greeting, show it as the first message
      const greeting = npcGreetings.current.get(data.npcId);
      if (greeting) {
        setNpcMessages([{ role: "npc", content: greeting }]);
        npcGreetings.current.delete(data.npcId);
      }
      dialogNpcRef.current = data;
      setDialogNpc(data);
      EventBus.emit("dialog:open");
      EventBus.emit("npc:bubble-clear", { npcId: data.npcId });
      // Request NPC chat history from server
      if (socketRef.current) {
        socketRef.current.emit("npc:history", {
          npcId: data.npcId,
          characterId: characterId ?? undefined,
        });
      }
    };

    const handleNpcSelect = (data: { npcs: { npcId: string; npcName: string }[] }) => {
      setNpcSelectList(data.npcs);
    };

    const handleInteractSelect = (data: {
      targets: { id: string; name: string; type: "npc" | "player" }[];
    }) => {
      setInteractSelectList(data.targets);
    };

    // NPC dialog auto-close (when walking away from NPC)
    const handleNpcDialogAutoClose = () => {
      resetDialog();
      setInteractSelectList(null);
      EventBus.emit("dialog:close");
    };

    // Channel chat input enable/disable based on player proximity
    const handleChatInputEnabled = (enabled: boolean) => {
      setChannelChatInputDisabled(!enabled);
    };

    const handlePlayerChatOpen = () => {
      resetDialog();
      setChannelChatOpen(true);
      setChannelChatInputDisabled(false);
      EventBus.emit("dialog:open");
    };

    const handleNpcAutoGreet = (data: { npcId: string; npcName: string }) => {
      const greeting = t("game.npcGreeting", { name: data.npcName });
      npcGreetings.current.set(data.npcId, greeting);
      EventBus.emit("npc:bubble", {
        npcId: data.npcId,
        text: t("game.npcGreetingBubble"),
        durationMs: 4500,
      });
      showToastNotification(
        `greet-${data.npcId}-${Date.now()}`,
        t("game.npcGreeting", { name: data.npcName }),
      );
    };

    const handleToastShow = (data: {
      message?: string;
      messageKey?: string;
      params?: Record<string, string>;
    }) => {
      // Cancel any auto-clear timer so proximity toast persists until toast:hide
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      // 시뮬레이션은 로케일을 모른다 — 키만 넘기고 번역은 여기서 한다.
      // (예전에는 씬이 영어 문장을 만들어 넘겨서 한국어 사용자도 영어를 봤다.)
      setToastMessage(data.messageKey ? t(data.messageKey, data.params) : (data.message ?? ""));
    };
    const handleToastHide = () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      setToastMessage(null);
    };

    const handleContextMenu = (data: {
      npcId: string;
      npcName: string;
      screenX: number;
      screenY: number;
      moveState: string;
    }) => {
      setContextMenu({
        npcId: data.npcId,
        npcName: data.npcName,
        x: data.screenX,
        y: data.screenY,
        moveState: data.moveState,
      });
    };

    const handleMovementStarted = (data: { npcId: string }) => {
      setNpcMoveStates((prev) => ({ ...prev, [data.npcId]: "moving-to-player" }));
    };
    const handleMovementArrived = (data: { npcId: string; npcName?: string }) => {
      setNpcMoveStates((prev) => ({ ...prev, [data.npcId]: "waiting" }));
      // 맵 채팅으로 부른 NPC 는 맵 채팅에서 대답한다 — 여기서 1:1 대화창을 열면 그 대답이
      // 보이는 패널을 덮어 버린다.
      const fromMapChat = mapChatWalkersRef.current.takeOnArrival(data.npcId);
      // Auto-open dialog when NPC arrives — preserve existing messages (don't resetDialog)
      if (data.npcName && !fromMapChat) {
        const nextDialogNpc = { npcId: data.npcId, npcName: data.npcName };
        dialogNpcRef.current = nextDialogNpc;
        setDialogNpc(nextDialogNpc);
        EventBus.emit("dialog:open");
        EventBus.emit("npc:bubble-clear", { npcId: data.npcId });
        // Always request history to ensure conversation is complete
        // (dialog might have been auto-closed during NPC approach, losing partial messages)
        if (socketRef.current) {
          socketRef.current.emit("npc:history", {
            npcId: data.npcId,
            characterId: characterId ?? undefined,
          });
        }
      }
    };
    const handleMovementReturned = (data: { npcId: string }) => {
      mapChatWalkersRef.current.forget(data.npcId);
      setNpcMoveStates((prev) => ({ ...prev, [data.npcId]: "idle" }));
      setNpcCallers((prev) => {
        const next = { ...prev };
        delete next[data.npcId];
        return next;
      });
    };

    EventBus.on("npc:interact", handleNpcInteract);
    EventBus.on("npc:select", handleNpcSelect);
    EventBus.on("interact:select", handleInteractSelect);
    EventBus.on("npc:dialog-auto-close", handleNpcDialogAutoClose);
    EventBus.on("chat:input-enabled", handleChatInputEnabled);
    EventBus.on("player:chat-open", handlePlayerChatOpen);
    EventBus.on("npc:auto-greet", handleNpcAutoGreet);
    EventBus.on("toast:show", handleToastShow);
    EventBus.on("toast:hide", handleToastHide);
    EventBus.on("npc:context-menu", handleContextMenu);
    EventBus.on("npc:call-to-player", handleMovementStarted);
    EventBus.on("npc:movement-arrived", handleMovementArrived);
    EventBus.on("npc:movement-returned", handleMovementReturned);
    return () => {
      EventBus.off("npc:interact", handleNpcInteract);
      EventBus.off("npc:select", handleNpcSelect);
      EventBus.off("interact:select", handleInteractSelect);
      EventBus.off("npc:dialog-auto-close", handleNpcDialogAutoClose);
      EventBus.off("chat:input-enabled", handleChatInputEnabled);
      EventBus.off("player:chat-open", handlePlayerChatOpen);
      EventBus.off("npc:auto-greet", handleNpcAutoGreet);
      EventBus.off("toast:show", handleToastShow);
      EventBus.off("toast:hide", handleToastHide);
      EventBus.off("npc:context-menu", handleContextMenu);
      EventBus.off("npc:call-to-player", handleMovementStarted);
      EventBus.off("npc:movement-arrived", handleMovementArrived);
      EventBus.off("npc:movement-returned", handleMovementReturned);
    };
  }, [characterId, resetDialog, showToastNotification, t]);

  const handleDialogClose = useCallback(() => {
    resetDialog();
    EventBus.emit("dialog:close");
  }, [resetDialog]);

  const closeRosterMenus = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCallNpcById = useCallback(
    (npcId: string) => {
      if (!socket) return;
      socket.emit("npc:call", { channelId, npcId });
      setContextMenu(null);
      closeRosterMenus();
    },
    [socket, channelId, closeRosterMenus],
  );

  const handleTalkNpcById = useCallback(
    (npcId: string, npcName: string) => {
      EventBus.emit("npc:approach-and-interact", { npcId, npcName });
      setContextMenu(null);
      closeRosterMenus();
    },
    [closeRosterMenus],
  );

  /**
   * NPC 의 이름·외형·페르소나는 게이트웨이 프로필이 정본이라 맵에서 고치지 않는다.
   * 맵에서 할 수 있는 것은 **자리 이동** 뿐이다.
   */
  const handleMoveNpcById = useCallback(
    (npcId: string) => {
      // 맵 목록(`channelNpcs`)에 있다 = 이미 자리가 있다 = 다른 화면에도 스프라이트가
      // 있다. 배치가 끝난 뒤 무엇을 브로드캐스트할지가 여기서 갈린다.
      setPendingNpc({ id: npcId, wasPlaced: channelNpcs.some((n) => n.id === npcId) });
      setPlacementMode(true);
      setContextMenu(null);
      closeRosterMenus();
    },
    [channelNpcs, closeRosterMenus],
  );

  const seatAssignmentStarted = useRef(false);
  useEffect(() => {
    if (
      searchParams.get("assignSeat") !== "1" ||
      seatAssignmentStarted.current ||
      !channel?.isOwner
    )
      return;
    const unplaced = rosterNpcs.find((n) => n.active && !n.placed);
    if (unplaced) {
      seatAssignmentStarted.current = true;
      handleMoveNpcById(unplaced.id);
    }
  }, [searchParams, rosterNpcs, channel?.isOwner, handleMoveNpcById]);

  const gatewayId = channel?.gatewayConfig?.gatewayId ?? null;

  const openProfileSettings = useCallback(() => {
    if (!gatewayId) return;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    setContextMenu(null);
    closeRosterMenus();
    router.push(`/gateways?gateway=${gatewayId}&returnTo=${encodeURIComponent(returnTo)}`);
  }, [closeRosterMenus, gatewayId, router]);

  const handleHireNpc = useCallback(() => {
    if (!gatewayId) return;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    closeRosterMenus();
    router.push(`/gateways?gateway=${gatewayId}&new=1&returnTo=${encodeURIComponent(returnTo)}`);
  }, [closeRosterMenus, gatewayId, router]);

  const handleResetNpcChatById = useCallback(
    (npcId: string) => {
      if (socketRef.current) {
        socketRef.current.emit("npc:reset-chat", { npcId, characterId: characterId ?? undefined });
      }
      if (dialogNpcRef.current?.npcId === npcId) {
        setNpcMessages([]);
        npcMessagesRef.current = [];
      }
      setContextMenu(null);
      closeRosterMenus();
    },
    [characterId, closeRosterMenus],
  );

  /**
   * 해고가 아니라 **퇴근** 이다. NPC 행을 지우면 다시 출근시킬 때 자리를 잃는다.
   * REST 가 아니라 소켓인 이유는 회의 중 차단이 소켓 쪽에만 보이기 때문이다.
   */
  const setNpcActiveById = useCallback(
    (npcId: string, active: boolean) => {
      if (!socketRef.current || !channelId) return;
      socketRef.current.emit("npc:set-active", { channelId, npcId, active });
      setContextMenu(null);
      closeRosterMenus();
    },
    [channelId, closeRosterMenus],
  );

  const handleSleepNpcById = useCallback(
    (npcId: string) => {
      if (!confirm(t("game.fireNpcConfirm"))) return;
      setNpcActiveById(npcId, false);
    },
    [setNpcActiveById, t],
  );

  const handleOpenPlayerChat = useCallback(() => {
    EventBus.emit("player:chat-open");
    closeRosterMenus();
  }, [closeRosterMenus]);

  const handleEditCharacter = useCallback(() => {
    closeRosterMenus();
    router.push(`/characters/create?editId=${characterId}`);
  }, [characterId, closeRosterMenus, router]);

  const handleStartPositionSetting = useCallback(() => {
    if (!isOwner || mode !== "office") return;
    setSpawnSetMode(true);
    closeRosterMenus();
  }, [closeRosterMenus, isOwner, mode]);

  const handleSelectNpc = useCallback(
    (npcId: string, npcName: string) => {
      resetDialog();
      const nextDialogNpc = { npcId, npcName };
      dialogNpcRef.current = nextDialogNpc;
      setDialogNpc(nextDialogNpc);
      EventBus.emit("dialog:open");
      EventBus.emit("npc:bubble-clear", { npcId });
      if (socketRef.current) {
        socketRef.current.emit("npc:history", { npcId, characterId: characterId ?? undefined });
      }
    },
    [characterId, resetDialog],
  );

  const handleDialogSend = useCallback(
    async (message: string, files?: File[]) => {
      if (!socket || !dialogNpc) return;
      if (!socket.connected) {
        showToastNotification(
          `npc-chat-disconnected-${dialogNpc.npcId}`,
          t("game.npcChatDisconnected"),
        );
        return;
      }
      // Add player message immediately (with file names if attached)
      const displayMessage =
        files && files.length > 0
          ? `${message}\n📎 ${files.map((f) => f.name).join(", ")}`
          : message;
      const sourceMessageId = crypto.randomUUID();
      setNpcMessages((prev) => [
        ...prev,
        { id: sourceMessageId, role: "player", content: displayMessage },
      ]);

      // Convert files to ArrayBuffers for socket transport
      let filePayloads:
        Array<{ name: string; type: string; size: number; data: ArrayBuffer }> | undefined;
      if (files && files.length > 0) {
        filePayloads = await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
            data: await f.arrayBuffer(),
          })),
        );
      }

      if (socket.id) EventBus.emit("chat:speech", { actorId: socket.id, text: displayMessage });
      socket.emit("npc:chat", {
        npcId: dialogNpc.npcId,
        message,
        sourceMessageId,
        // 재연결 직후에는 서버의 `players` 에 이 소켓이 아직 없어 캐릭터를 모른다.
        // 그 구간에서 나눈 대화가 사라지지 않도록 캐릭터를 함께 보낸다(서버가 소유를 검증한다).
        characterId: characterId ?? undefined,
        files: filePayloads,
      });
    },
    [socket, dialogNpc, characterId, showToastNotification, t],
  );

  const handleRoomSend = useCallback(
    (message: string) => {
      if (!socket || !socket.connected) {
        showToastNotification("channel-chat-disconnected", t("game.channelChatDisconnected"));
        return;
      }
      if (!currentRoomId) return;
      socket.emit("room:send", { roomId: currentRoomId, message });
      if (socket.id) EventBus.emit("chat:speech", { actorId: socket.id, text: message });
      // 대화를 다시 시작하는 메시지 — 자리로 돌아갔던 참여자를 다시 곁으로 부른다.
      // 지명된 NPC 는 서버가 따로 부르고, 이미 곁에 있거나 걷는 중이면 씬이 재호출을 무시한다.
      const present = new Set(
        Object.entries(npcMoveStatesRef.current)
          .filter(([, st]) => st === "waiting" || st === "moving-to-player")
          .map(([id]) => id),
      );
      // 그룹 방의 참여자는 명단이 정본이다(지명하지 않아도 전원이 대답한다).
      // office 는 명단이 채널 전원이라 그럴 수 없어 지명 이력을 쓴다.
      const room = roomState.rooms.find((candidate) => candidate.id === currentRoomId);
      const targets =
        room?.kind === "group"
          ? room.members
              .filter((member) => member.kind === "npc")
              .map((member) => member.id)
              .filter((npcId) => !present.has(npcId))
          : mapChatParticipantsRef.current.recallTargets(currentRoomId, present);
      for (const npcId of targets) {
        socket.emit("npc:call", { channelId, npcId, reason: "map-chat", roomId: currentRoomId });
      }
    },
    [socket, channelId, currentRoomId, roomState.rooms, showToastNotification, t],
  );

  /** 방을 옮기면 이전 방을 닫고 새 방을 연다. 마지막 방은 채널별로 기억한다. */
  useEffect(() => {
    const socketInstance = socketRef.current;
    if (!socketInstance || !socketConnected || !currentRoomId) return;
    const previous = openedRoomRef.current;
    if (previous === currentRoomId) return;
    if (previous) socketInstance.emit("room:close", { roomId: previous });
    socketInstance.emit("room:open", { roomId: currentRoomId });
    openedRoomRef.current = currentRoomId;
    if (channelId) {
      try {
        window.localStorage.setItem(lastRoomKey(channelId), currentRoomId);
      } catch {
        // 시크릿 모드·차단된 저장소 — 마지막 방을 기억하지 못할 뿐이다.
      }
    }
  }, [currentRoomId, socketConnected, channelId]);

  const handleRoomAction = useCallback(
    (action: Parameters<typeof reduceRoomState>[1]) => dispatchRoom(action),
    [],
  );

  const handleRoomCreate = useCallback(
    (name: string, npcIds: string[], userIds: string[]) => {
      if (!socket || !socket.connected || !channelId) return;
      // 서버가 `room:created` 를 돌려줄 때 "내가 만든 것" 을 가릴 근거는 이 표뿐이다.
      const requestId = crypto.randomUUID();
      pendingCreateRef.current = requestId;
      socket.emit("room:create", { channelId, name, npcIds, userIds, requestId });
    },
    [socket, channelId],
  );

  const handleRoomInvite = useCallback(
    (roomId: string, npcIds: string[], userIds: string[]) => {
      socket?.emit("room:invite", { roomId, npcIds, userIds });
    },
    [socket],
  );

  const handleRoomLeave = useCallback(
    (roomId: string) => {
      socket?.emit("room:leave", { roomId });
    },
    [socket],
  );

  const handleRoomRename = useCallback(
    (roomId: string, name: string) => {
      socket?.emit("room:rename", { roomId, name });
    },
    [socket],
  );

  const handleRoomDelete = useCallback(
    (roomId: string) => {
      socket?.emit("room:delete", { roomId });
    },
    [socket],
  );

  /** `@` 로 지명할 수 있는 NPC — office 는 출근 중 전원, group 은 그중 방 멤버만. */
  const mentionCandidatesFor = useCallback(
    (roomId: string | null) => {
      const active = rosterNpcs
        .filter((npc) => npc.active)
        .map((npc) => ({ id: npc.id, name: npc.name }));
      const room = roomState.rooms.find((candidate) => candidate.id === roomId);
      if (!room || room.kind === "office") return active;
      const memberIds = new Set(
        room.members.filter((member) => member.kind === "npc").map((member) => member.id),
      );
      return active.filter((npc) => memberIds.has(npc.id));
    },
    [rosterNpcs, roomState.rooms],
  );

  const handleGamePasswordSubmit = useCallback(
    async (password: string): Promise<string | null> => {
      if (!channelId) return t("errors.failedToJoinChannel");
      try {
        const res = await fetch(`/api/channels/${channelId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return getLocalizedErrorMessage(t, data, "password.wrong");
        }
        setShowPasswordModal(false);
        setLoading(true);
        // Reload channel data
        const channelRes = await fetch(`/api/channels/${channelId}`);
        if (channelRes.ok) {
          const channelData = await channelRes.json();
          setChannel(channelData.channel);
          setIsOwner(channelData.channel.isOwner || false);
        }
        setLoading(false);
        return null;
      } catch {
        return t("errors.failedToJoinChannel");
      }
    },
    [channelId, t],
  );

  const handleCopyInvite = () => {
    if (!channel?.inviteCode) return;
    const url = `${window.location.origin}/channels/join/${channel.inviteCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Fetch character data and channel data
  useEffect(() => {
    if (!characterId) {
      setError(t("errors.noCharacterSelected"));
      setLoading(false);
      return;
    }
    if (!channelId) {
      return; // will redirect above
    }

    (async () => {
      // Fetch channel first to handle password-protected channels
      const channelRes = await fetch(`/api/channels/${channelId}`).catch(() => null);
      if (channelRes && channelRes.status === 403) {
        const data = await channelRes.json();
        if (data.errorCode === "password_required" || data.error === "password_required") {
          setShowPasswordModal(true);
          setLoading(false);
          return;
        }
      }

      Promise.all([
        fetch("/api/characters").then((res) => res.json()),
        channelRes
          ? channelRes.json()
          : fetch(`/api/channels/${channelId}`).then((res) => res.json()),
      ])
        .then(async ([charData, channelData]) => {
          // Character
          const chars: Character[] = charData.characters || [];
          const found = chars.find((c) => c.id === characterId);
          if (!found) {
            setError(t("errors.characterNotFound"));
            setLoading(false);
            return;
          }
          setCharacter(found);
          characterNameRef.current = found.name;
          characterAppearanceRef.current = found.appearance ?? null;

          // Channel
          if (channelData.error) {
            setError(t("game.channelNotFound"));
            setLoading(false);
            return;
          }
          let nextChannel = channelData.channel as ChannelInfo;

          // Auto-join public channels before downstream effects start fetching
          if (nextChannel?.isPublic && !nextChannel?.isMember && !nextChannel?.isOwner) {
            const joinRes = await fetch(`/api/channels/${channelId}/join`, { method: "POST" });
            if (!joinRes.ok) {
              const errorData = await joinRes.json().catch(() => ({}));
              throw new Error(
                getLocalizedErrorMessage(t, errorData, "errors.failedToLoadGameData"),
              );
            }
            nextChannel = {
              ...nextChannel,
              isMember: true,
            };
          }

          setChannel(nextChannel);
          if (nextChannel?.isOwner) setIsOwner(true);

          // 시뮬레이션이 시작할 때 읽을 채널 데이터
          // Parse mapData if it's a JSON string (SQLite stores as text)
          let rawMapData = channelData.channel.mapData;
          if (typeof rawMapData === "string") {
            try {
              rawMapData = JSON.parse(rawMapData);
            } catch {
              /* keep as string */
            }
          }
          // Detect if mapData is actually Tiled JSON (has tiledversion field)
          const isTiledJson =
            rawMapData && typeof rawMapData === "object" && "tiledversion" in rawMapData;

          const nextPendingChannelData: PendingChannelData = {
            channelId: channelData.channel.id,
            mapRevision: channelData.channel.mapRevision ?? "null",
            mapData: isTiledJson ? null : rawMapData || null,
            tiledJson: isTiledJson ? rawMapData : null,
            mapConfig:
              typeof channelData.channel.mapConfig === "string"
                ? JSON.parse(channelData.channel.mapConfig)
                : channelData.channel.mapConfig || null,
            savedPosition:
              channelData.channel.lastX != null && channelData.channel.lastY != null
                ? { x: channelData.channel.lastX, y: channelData.channel.lastY }
                : null,
          };
          setPendingChannelData(nextPendingChannelData);
          setGameChannelData(nextPendingChannelData);

          setLoading(false);
        })
        .catch(() => {
          setError(t("errors.failedToLoadGameData"));
          setLoading(false);
        });
    })();
  }, [characterId, channelId, t]);

  /**
   * 맵 목록과 출근부를 함께 읽는다. 하나만 갱신하면 화면 두 곳이 서로 다른 사실을
   * 말한다 — 출근부에서 퇴근시켰는데 헤더의 "출근 N명" 이 그대로인 식이다.
   */
  const refreshNpcLists = useCallback(async () => {
    if (!channelId) return;
    try {
      const [mapRes, rosterRes] = await Promise.all([
        fetch(`/api/npcs?channelId=${channelId}`),
        fetch(`/api/npcs?channelId=${channelId}&roster=1`),
      ]);
      if (!mapRes.ok) {
        const errorData = await mapRes.json().catch(() => ({}));
        throw new Error(getLocalizedErrorMessage(t, errorData, "errors.failedToFetchNpcs"));
      }
      const mapData = await mapRes.json();
      if (mapData.npcs) setChannelNpcs(mapData.npcs);
      if (rosterRes.ok) {
        const rosterData = await rosterRes.json();
        if (Array.isArray(rosterData.npcs)) {
          setRosterNpcs(
            rosterData.npcs.map(
              (npc: RosterNpc & { positionX?: number | null; placed?: boolean }) => ({
                id: npc.id,
                name: npc.name,
                appearance: npc.appearance,
                active: !!npc.active,
                placed: !!npc.placed,
                profile: npc.profile ?? null,
              }),
            ),
          );
        }
      }
    } catch (err) {
      console.error("Failed to fetch channel NPCs:", err);
    }
  }, [channelId, t]);

  // Fetch NPCs for this channel (for meeting room + roster)
  useEffect(() => {
    if (!channelId || (!channel?.isMember && !channel?.isOwner)) return;
    void refreshNpcLists();
  }, [channelId, channel?.isMember, channel?.isOwner, refreshNpcLists]);

  useEffect(() => {
    if (!channelId || (!channel?.isMember && !channel?.isOwner)) return;
    fetch(`/api/meetings?channelId=${channelId}`)
      .then(async (res) => {
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(getLocalizedErrorMessage(t, errorData, "errors.failedToFetchMeetings"));
        }
        return res.json();
      })
      .then((data) => {
        setMeetingMinutesCount(Array.isArray(data.minutes) ? data.minutes.length : 0);
      })
      .catch((err) => {
        console.error("Failed to fetch meeting minutes:", err);
      });
  }, [channelId, channel?.isMember, channel?.isOwner, mode, t]);

  // Emit owner status when scene is ready
  useEffect(() => {
    const onSceneReady = () => {
      EventBus.emit("owner-status", { isOwner });
    };
    EventBus.on("scene-ready", onSceneReady);
    return () => {
      EventBus.off("scene-ready", onSceneReady);
    };
  }, [isOwner]);

  // Placement mode coordination
  useEffect(() => {
    if (placementMode && pendingNpc) {
      EventBus.emit("placement-mode-start", pendingNpc);
    }
    const restorePlacement = () => {
      if (placementMode && pendingNpc) EventBus.emit("placement-mode-start", pendingNpc);
    };
    EventBus.on("scene-ready", restorePlacement);
    const onPlacementComplete = async (data: { col: number; row: number }) => {
      if (!pendingNpc) return;
      // 409(타일 점유)일 때만 배치 모드를 유지한다. `return` 은 finally 를 건너뛰지
      // 않으므로 플래그로 알린다 — 예전에는 주석만 "유지한다" 고 적혀 있고 실제로는
      // 배치 모드가 조용히 꺼졌다(칸을 찍었는데 아무 일도 안 일어났다).
      let keepPlacementMode = false;
      try {
        // NPC 를 새로 만들지 않는다 — 이미 있는 행에 **자리를 준다**. 생성 라우트는
        // 없어졌고, 자리·방향 말고는 이 라우트가 받지 않는다(프로필이 정본).
        const request = buildPlacementRequest(pendingNpc.id, data.col, data.row);
        const res = await fetch(request.url, request.init);
        // 그 칸에 이미 다른 NPC 가 있다(`npcs_channel_position_unique`). 배치 모드를
        // 유지한 채 다른 칸을 기다리되, 왜 안 됐는지는 알려 준다.
        if (keepsPlacementMode(res.status)) {
          keepPlacementMode = true;
          showToastNotification("npc-place-occupied", t("errors.tileAlreadyOccupied"));
          return;
        }
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(getLocalizedErrorMessage(t, errorData, "errors.failedToCreateNpc"));
        }
        const result = await res.json();
        await refreshNpcLists();
        if (result?.npc) {
          // 이동은 로컬에서도 원격에서도 **빼고 다시 넣는다**. add 만 보내면 받는 쪽
          // `npc:added` 가 "이미 있는 NPC" 라며 무시해서 옛 칸에 그대로 남는다.
          for (const step of placementBroadcastPlan(pendingNpc.wasPlaced)) {
            if (step === "remove") {
              EventBus.emit("npc:remove-local", { npcId: pendingNpc.id });
              if (socket) socket.emit("npc:broadcast-remove", { npcId: pendingNpc.id });
            } else {
              EventBus.emit("npc:spawn-local", result.npc);
              if (socket) socket.emit("npc:broadcast-add", result.npc);
            }
          }
        }
      } catch (err) {
        console.error("Failed to place NPC:", err);
        showToastNotification(
          "npc-place-error",
          err instanceof Error ? err.message : t("errors.failedToCreateNpc"),
        );
      } finally {
        if (!keepPlacementMode) {
          setPlacementMode(false);
          setPendingNpc(null);
          EventBus.emit("placement-mode-end");
        }
      }
    };
    const onPlacementCancel = () => {
      setPlacementMode(false);
      setPendingNpc(null);
    };
    EventBus.on("placement-complete", onPlacementComplete);
    EventBus.on("placement-cancel", onPlacementCancel);
    return () => {
      EventBus.off("scene-ready", restorePlacement);
      EventBus.off("placement-complete", onPlacementComplete);
      EventBus.off("placement-cancel", onPlacementCancel);
    };
  }, [placementMode, pendingNpc, refreshNpcLists, showToastNotification, socket, t]);

  /**
   * 출근부 토글의 결과는 소켓으로 온다. 성공은 채널 전체 브로드캐스트(`npc:updated`)
   * 이고, 실패는 요청한 소켓에만 온다(`npc:set-active:error`) — 회의 중이라 막힌 것을
   * 토스트로 알리지 않으면 버튼이 아무 일도 안 한 것처럼 보인다.
   */
  useEffect(() => {
    if (!socket) return;
    const onNpcUpdated = () => {
      void refreshNpcLists();
    };
    const onSetActiveError = (data: { npcId: string; errorCode: string }) => {
      showToastNotification(
        `npc-set-active-${data.npcId}`,
        getLocalizedErrorMessage(t, data, "errors.failedToUpdateNpc"),
      );
    };
    socket.on("npc:updated", onNpcUpdated);
    socket.on("npc:set-active:error", onSetActiveError);
    return () => {
      socket.off("npc:updated", onNpcUpdated);
      socket.off("npc:set-active:error", onSetActiveError);
    };
  }, [socket, refreshNpcLists, showToastNotification, t]);

  /**
   * 칸반 사건(`kanban:event`)은 이 채널의 것만 세어 모달에 재조회 신호를 준다(R26).
   * 모달이 닫혀 있어도 세지만, 여는 순간 어차피 처음부터 읽으므로 누적은 무해하다.
   */
  useEffect(() => {
    if (!socket || !channelId) return;
    const onKanbanEvent = (data: { channelId?: string }) => {
      if (data?.channelId && data.channelId !== channelId) return;
      setKanbanRefreshTick((n) => n + 1);
    };
    socket.on("kanban:event", onKanbanEvent);
    return () => {
      socket.off("kanban:event", onKanbanEvent);
    };
  }, [socket, channelId]);

  /**
   * `npc:working`(R27) — 값이 바뀔 때만 오고, 접속 때 스냅샷이 한 번 온다. 채널이 바뀌면
   * 비운다: 스냅샷이 새 채널 것으로 다시 오므로 옛 채널의 표시가 남지 않는다.
   */
  useEffect(() => {
    setNpcWorking(EMPTY_NPC_WORKING);
    if (!socket || !channelId) return;
    const onWorking = (raw: unknown) => {
      const payload = parseNpcWorkingPayload(raw);
      if (!payload) return;
      setNpcWorking((prev) => reduceNpcWorking(prev, payload));
    };
    socket.on("npc:working", onWorking);
    return () => {
      socket.off("npc:working", onWorking);
    };
  }, [socket, channelId]);

  // 방 알림 링크(R29·R30) → 해당 모달을 그 항목으로 연다.
  const openNoticeCard = useCallback((cardId: string) => {
    setKanbanInitialTaskId(cardId);
    setShowKanban(true);
  }, []);
  const openNoticeCronJob = useCallback((jobId: string) => {
    setCronInitialJobId(jobId);
    setShowCron(true);
  }, []);
  const closeKanban = useCallback(() => {
    setShowKanban(false);
    setKanbanInitialTaskId(null);
  }, []);
  const closeCron = useCallback(() => {
    setShowCron(false);
    setCronInitialJobId(null);
  }, []);

  // Spawn set mode coordination
  useEffect(() => {
    if (spawnSetMode) {
      EventBus.emit("spawn-set-mode-start");
    }
    const onSpawnSelected = async (data: { col: number; row: number }) => {
      if (!channelId) return;
      try {
        const existingConfig =
          typeof channel?.mapConfig === "string"
            ? JSON.parse(channel.mapConfig as string)
            : channel?.mapConfig || {};
        await fetch(`/api/channels/${channelId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mapConfig: { ...existingConfig, spawnCol: data.col, spawnRow: data.row },
          }),
        });
        setChannel((prev) =>
          prev
            ? {
                ...prev,
                mapConfig: {
                  ...(typeof prev.mapConfig === "object"
                    ? (prev.mapConfig as Record<string, unknown>)
                    : {}),
                  spawnCol: data.col,
                  spawnRow: data.row,
                },
              }
            : prev,
        );
        showToastNotification(
          "spawn-set",
          t("game.spawnSetSuccess", { col: data.col, row: data.row }),
        );
      } catch (err) {
        console.error("Failed to save spawn position:", err);
      } finally {
        setSpawnSetMode(false);
        EventBus.emit("spawn-set-mode-end");
      }
    };
    const onSpawnCancel = () => {
      setSpawnSetMode(false);
      EventBus.emit("spawn-set-mode-end");
    };
    EventBus.on("spawn:selected", onSpawnSelected);
    EventBus.on("spawn-set-cancel", onSpawnCancel);
    return () => {
      EventBus.off("spawn:selected", onSpawnSelected);
      EventBus.off("spawn-set-cancel", onSpawnCancel);
    };
  }, [spawnSetMode, channelId, channel, showToastNotification, t]);

  // NPC context menu handlers
  const handleCallNpc = useCallback(() => {
    if (!contextMenu) return;
    handleCallNpcById(contextMenu.npcId);
  }, [contextMenu, handleCallNpcById]);

  const handleContextTalk = useCallback(() => {
    if (!contextMenu) return;
    handleTalkNpcById(contextMenu.npcId, contextMenu.npcName);
  }, [contextMenu, handleTalkNpcById]);

  const handleContextInviteToRoom = useCallback(() => {
    if (!contextMenu) return;
    const currentRoom = roomState.rooms.find((room) => room.id === roomState.currentRoomId);
    const decision = decideContextInvite({
      visible: channelChatVisible,
      currentRoom,
      npcId: contextMenu.npcId,
    });
    if (decision.kind === "invite") {
      handleRoomInvite(decision.roomId, [contextMenu.npcId], []);
    } else if (decision.kind === "already-member") {
      showToastNotification(`room-already-member-${contextMenu.npcId}`, t("room.alreadyMember"));
    } else {
      handleRoomAction({ type: "compose", presetNpcIds: [contextMenu.npcId] });
      setChannelChatOpen(true);
    }
    setContextMenu(null);
  }, [
    contextMenu,
    roomState,
    channelChatVisible,
    handleRoomInvite,
    handleRoomAction,
    showToastNotification,
    t,
  ]);

  const handleReturnNpc = useCallback(
    (npcId: string) => {
      if (!socket?.connected) {
        showToastNotification("npc-return-disconnected", t("errors.connectionFailed"));
        return;
      }
      socket
        .timeout(3000)
        .emit(
          "npc:return-home",
          { channelId, npcId },
          (error: Error | null, result?: { ok: boolean; error?: string }) => {
            if (error || !result?.ok)
              showToastNotification(
                `npc-return-${npcId}`,
                t(
                  error
                    ? "errors.connectionFailed"
                    : result?.error === "not_owner" || result?.error === "forbidden"
                      ? "errors.forbidden"
                      : "errors.notFound",
                ),
              );
          },
        );
      mapChatParticipantsRef.current.dismiss(npcId);
      setContextMenu(null);
      closeRosterMenus();
    },
    [socket, channelId, closeRosterMenus, showToastNotification, t],
  );

  // ESC key to close context menu
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenu) setContextMenu(null);
      }
    };
    const preventContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("keydown", handleEsc);
    window.addEventListener("contextmenu", preventContextMenu);
    return () => {
      window.removeEventListener("keydown", handleEsc);
      window.removeEventListener("contextmenu", preventContextMenu);
    };
  }, [contextMenu]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-text">
        <div className="text-center">
          <div className="text-xl mb-2">{t("common.loadingGame")}</div>
          <div className="text-text-muted">{t("common.preparingCharacter")}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-text">
        <div className="text-center">
          <div className="text-xl mb-4 text-red-400">{error}</div>
          <Link
            href="/characters"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded font-semibold"
          >
            {t("common.backToCharacters")}
          </Link>
        </div>
      </div>
    );
  }

  const dialogMotion = npcMotionUi(
    npcMotionSnapshotRef.current,
    dialogNpc?.npcId,
    dialogNpc ? npcMoveStates[dialogNpc.npcId] : undefined,
    dialogNpc ? npcCallers[dialogNpc.npcId] : undefined,
  );

  const npcResponsePhases = npcPresentationPhases(chatResponses);
  // 크론 화면의 NPC 후보 — 출근부의 active 만, 이름은 프로필 표시명(출근부가 이미 그것이다).
  const cronNpcs = rosterNpcs
    .filter((npc) => npc.active)
    .map((npc) => ({ npcId: npc.id, npcName: npc.name }));
  const navigatorNpcs: NavigatorNpc[] = rosterNpcs.map((npc) => {
    const motion = npcMotionUi(
      npcMotionSnapshotRef.current,
      npc.id,
      npcMoveStates[npc.id],
      npcCallers[npc.id],
    );
    return {
      ...npc,
      motion: navigatorMotion({ active: npc.active, placed: npc.placed, phase: motion.phase }),
      response: npcResponsePhases[npc.id],
      calledByViewer: motion.caller === socket?.id,
    };
  });

  const handleNavigatorNpcAction = (npcId: string, action: NpcNavigatorAction) => {
    if (action === "call") handleCallNpcById(npcId);
    else if (action === "return") handleReturnNpc(npcId);
    else if (action === "place") handleMoveNpcById(npcId);
    else if (action === "profile") openProfileSettings();
    else if (action === "reset-chat") handleResetNpcChatById(npcId);
    else if (action === "sleep") handleSleepNpcById(npcId);
    else if (action === "wake") setNpcActiveById(npcId, true);
  };

  const activeConversationRoom = roomState.rooms.find(
    (room) => room.id === roomState.currentRoomId,
  );
  const conversationLabel = dialogNpc
    ? `${dialogNpc.npcName} ${t("chat.title")}`
    : roomState.view === "compose"
      ? t("room.new")
      : activeConversationRoom?.kind === "office"
        ? t("room.office")
        : (activeConversationRoom?.name ?? t("room.list"));

  const conversationPanel = (
    <ConversationPane label={conversationLabel}>
      <ChatPanel
        presentation="workspace"
        width={conversationPanelWidth}
        onWidthChange={setConversationPanelWidth}
        dialogNpc={dialogNpc}
        npcMessages={npcMessages}
        npcActivityKey={npcActivityKey}
        isNpcStreaming={isNpcStreaming}
        npcResponses={responsesForScope(chatResponses, "npc", dialogNpc?.npcId ?? null)}
        roomResponses={responsesForScope(chatResponses, "room", currentRoomId)}
        npcChatInputDisabled={!socketConnected}
        npcChatDisabledPlaceholder={t("chat.disconnected")}
        onSend={handleDialogSend}
        onClose={handleDialogClose}
        npcSelectList={npcSelectList}
        onSelectNpc={handleSelectNpc}
        isOwner={isOwner}
        onEditNpc={handleMoveNpcById}
        onFireNpc={handleSleepNpcById}
        onResetNpcChat={handleResetNpcChatById}
        roomState={roomState}
        channelChatOpen={channelChatOpen}
        channelChatInputDisabled={channelChatInputDisabled || !socketConnected}
        onChannelChatVisibleChange={setChannelChatVisible}
        mentionCandidatesFor={mentionCandidatesFor}
        onlinePlayers={channelPlayers.flatMap((player) => {
          const userId = player.id === "__self__" ? roomState.viewerUserId : player.userId;
          return userId ? [{ id: userId, name: player.name }] : [];
        })}
        onRoomSend={handleRoomSend}
        onRoomAction={handleRoomAction}
        onRoomCreate={handleRoomCreate}
        onRoomInvite={handleRoomInvite}
        onRoomLeave={handleRoomLeave}
        onRoomRename={handleRoomRename}
        onRoomDelete={handleRoomDelete}
        currentPlayerName={character?.name}
        npcMoveState={dialogMotion.phase}
        onReturnNpc={dialogNpc && dialogMotion.caller === socket?.id ? handleReturnNpc : undefined}
        cron={channelId ? { channelId, socket, onToast: cronToast } : null}
        onOpenNoticeCard={openNoticeCard}
        onOpenNoticeCronJob={openNoticeCronJob}
      />
    </ConversationPane>
  );

  return (
    <div
      data-game-meeting={mode === "meeting"}
      className="theme-game ui2-game h-screen w-screen overflow-hidden bg-bg text-text"
    >
      <ConversationWorkspace
        conversationWidth={conversationPanelWidth}
        navigator={
          <WorkspaceNavigator
            workspaceName={channel?.name || "DeskRPG"}
            rooms={roomState.rooms}
            currentRoomId={dialogNpc ? null : roomState.currentRoomId}
            players={channelPlayers.map((player) => ({
              id: player.id,
              name: player.name,
              online: true,
              self: player.id === "__self__",
              appearance: player.appearance,
            }))}
            npcs={navigatorNpcs}
            selectedNpcId={dialogNpc?.npcId}
            isOwner={isOwner}
            onSelectRoom={(roomId) => {
              if (dialogNpc) handleDialogClose();
              handleRoomAction({ type: "open", roomId });
              setChannelChatOpen(true);
            }}
            onSelectNpc={handleTalkNpcById}
            onSelectPlayer={() => handleOpenPlayerChat()}
            onCompose={(presetNpcIds) => {
              if (dialogNpc) handleDialogClose();
              handleRoomAction({ type: "compose", presetNpcIds });
              setChannelChatOpen(true);
            }}
            onNpcAction={handleNavigatorNpcAction}
            onInvitePeople={() => setShowSharePopup(true)}
            onEditSelf={handleEditCharacter}
            onSetStartPosition={isOwner ? handleStartPositionSetting : undefined}
            onAddNpc={isOwner ? handleHireNpc : undefined}
            addNpcDisabled={!gatewayId}
          />
        }
        conversation={conversationPanel}
      >
        {/* Game canvas remains mounted while the meeting workspace is visible. */}
        <div>
          {character && gameChannelData && (
            <ThreeGame
              socket={socket}
              characterId={character.id}
              characterName={character.name}
              appearance={character.appearance}
              channelInitData={gameChannelData}
              onFatal={handleGameFatal}
            />
          )}
        </div>
      </ConversationWorkspace>

      {/* Spawn set mode banner */}
      {spawnSetMode && (
        <div
          style={{ top: "var(--game-header-height, 48px)" }}
          className="fixed left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 bg-green-900/90 border border-green-500 rounded-lg text-green-100 text-sm shadow-lg"
        >
          <Footprints className="w-4 h-4 text-green-400" />
          <span>{t("game.spawnSetMode")}</span>
          <button
            onClick={() => {
              setSpawnSetMode(false);
              EventBus.emit("spawn-set-mode-end");
            }}
            className="ml-2 px-2 py-0.5 bg-green-700 hover:bg-green-600 rounded text-xs"
          >
            {t("common.closeEsc")}
          </button>
        </div>
      )}

      {/* Top bar — floating over game */}
      <div className="fixed top-0 left-0 right-0 z-10 px-4 py-2 ui2-game-header">
        <style jsx>{`
          .ui2-game-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            height: var(--game-header-height, 48px);
          }
          .ui2-game-header h1 {
            min-width: 0;
            max-width: none;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .header-controls {
            display: flex;
            flex-shrink: 0;
            align-items: center;
            gap: 6px;
          }
          .header-controls :global(button) {
            white-space: nowrap;
          }
          .header-mobile-label {
            display: none;
          }
          @media (max-width: 1000px) {
            .ui2-game-header {
              display: grid;
              grid-template-columns: minmax(0, 1fr);
              grid-template-rows: 24px 36px;
              gap: 4px;
              height: var(--game-header-height, 48px);
              min-height: var(--game-header-height, 48px);
              padding: 8px;
            }
            .ui2-game-header h1 {
              font-size: 13px;
              line-height: 24px;
            }
            .header-controls {
              min-width: 0;
              width: 100%;
              justify-content: space-between;
              gap: 4px;
            }
            .header-controls > button,
            .header-controls > div > button,
            .header-controls > div > div:first-child > button {
              height: 36px;
              flex-shrink: 0;
              padding: 0 8px;
              gap: 5px;
            }
            .header-full-label,
            .header-separator {
              display: none;
            }
            .header-mobile-label {
              display: inline;
            }
            .header-roster-buttons {
              gap: 4px;
            }
            .header-controls :global(svg) {
              flex-shrink: 0;
            }
            .header-menu {
              position: fixed;
              top: calc(var(--game-header-height, 48px) + 4px);
              right: 8px;
              left: auto;
              max-width: calc(100vw - 16px);
              max-height: calc(100dvh - var(--game-header-height, 48px) - 20px);
              overflow-y: auto;
              margin-top: 0;
            }
            .header-roster-menu {
              position: fixed;
              top: calc(var(--game-header-height, 48px) + 4px);
              left: 8px;
              right: 8px;
              width: auto;
              max-height: calc(100dvh - var(--game-header-height, 48px) - 20px);
              margin-top: 0;
              overflow-y: auto;
            }
          }
          @media (max-width: 360px) {
            .header-controls > button,
            .header-controls > div > button,
            .header-controls > div > div:first-child > button {
              padding: 0 5px;
              gap: 3px;
            }
          }
        `}</style>
        {/* Left: Channel name — Character name */}
        <h1
          className="text-lg font-bold"
          title={`${channel?.name || "DeskRPG"} — ${character?.name || ""}`}
        >
          {channel?.name || "DeskRPG"} &mdash; {character?.name}
        </h1>

        {/* Right: grouped controls */}
        <div className="header-controls">
          {/* Gateway status */}
          {channel?.hasGateway ? (
            <button
              onClick={() => openChannelSettings("gateway")}
              title={t(channel?.hasGateway ? "game.aiGateway" : "game.gatewayConnect")}
              aria-label={t(channel?.hasGateway ? "game.aiGateway" : "game.gatewayConnect")}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-sky-500/10 border border-sky-400/20 text-caption text-sky-700 hover:bg-sky-500/20"
            >
              <span className="w-2 h-2 rounded-full bg-sky-300" />
              <span className="header-full-label">{t("game.aiGateway")}</span>
              <span className="header-mobile-label" aria-hidden="true">
                AI
              </span>
            </button>
          ) : (
            <button
              onClick={() => openChannelSettings("gateway")}
              title={t(channel?.hasGateway ? "game.aiGateway" : "game.gatewayConnect")}
              aria-label={t(channel?.hasGateway ? "game.aiGateway" : "game.gatewayConnect")}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-400/20 text-caption text-amber-700 hover:bg-amber-500/20"
            >
              <span className="w-2 h-2 rounded-full bg-amber-300" />
              <span className="header-full-label">{t("game.gatewayConnect")}</span>
              <span className="header-mobile-label" aria-hidden="true">
                AI +
              </span>
            </button>
          )}

          {/* Counts remain in the header; the full roster now lives in the workspace navigator. */}
          <div
            className="header-roster-buttons flex items-center gap-1.5"
            aria-label={t("workspace.people")}
          >
            <span className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1 text-caption text-text-secondary">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              <span className="header-full-label">
                {t("game.playersOnlineCount", { count: channelPlayers.length })}
              </span>
              <span className="header-mobile-label" aria-hidden="true">
                {channelPlayers.length}
              </span>
            </span>
            <span className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1 text-caption text-text-secondary">
              <span className="h-2 w-2 rounded-full bg-violet-400" />
              <span className="header-full-label">
                {t("game.npcsAtWorkCount", {
                  count: rosterNpcs.filter((npc) => npc.active).length,
                })}
              </span>
              <span className="header-mobile-label" aria-hidden="true">
                NPC {rosterNpcs.filter((npc) => npc.active).length}
              </span>
            </span>
          </div>

          {/* Mode toggle */}
          <button
            data-meeting-entry="navbar"
            onClick={() => (mode === "meeting" ? meetingEntry.cancel() : meetingEntry.request())}
            title={mode === "office" ? t("game.meetingRoom") : t("common.back")}
            aria-label={mode === "office" ? t("game.meetingRoom") : t("common.back")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-caption font-semibold ${
              mode === "meeting"
                ? "bg-primary hover:bg-primary-hover text-white"
                : "bg-meeting/80 hover:bg-meeting text-white"
            }`}
          >
            <Users className="w-3 h-3" />
            <span className="header-full-label">
              {mode === "office" ? t("game.meetingRoom") : t("common.back")}
            </span>
            <span className="bg-white/20 px-1.5 rounded-full text-micro">
              {meetingMinutesCount}
            </span>
          </button>

          {/* Kanban board (T8) — 옛 태스크 보드 버튼 자리 */}
          <button
            onClick={() => setShowKanban(true)}
            title={t("kanban.title")}
            aria-label={t("kanban.title")}
            className="flex items-center gap-1 px-2.5 py-1 bg-primary/80 hover:bg-primary text-white rounded-md text-caption font-semibold"
          >
            <KanbanSquare className="w-3 h-3" />
            <span className="header-full-label">{t("kanban.open")}</span>
          </button>

          {/* 채널 크론 화면 (T10, R15) */}
          <button
            onClick={() => setShowCron(true)}
            title={t("cron.title")}
            aria-label={t("cron.title")}
            className="flex items-center gap-1 px-2.5 py-1 bg-primary/80 hover:bg-primary text-white rounded-md text-caption font-semibold"
          >
            <AlarmClock className="w-3 h-3" />
            <span className="header-full-label">{t("cron.open")}</span>
          </button>

          {/* Separator */}
          <div className="header-separator w-px h-5 bg-border" />

          {/* Unified menu dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                setShowSharePopup(false);
              }}
              title={t("game.menuSettings")}
              aria-label={t("game.menuSettings")}
              aria-expanded={showUserMenu}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-raised border border-border text-caption text-text-secondary hover:text-text hover:bg-surface relative"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="header-full-label">{t("game.menuSettings")}</span>
              {notifications.some((n) => !n.read) && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-danger rounded-full" />
              )}
              <ChevronDown className="header-full-label w-3 h-3" />
            </button>
            {showUserMenu && (
              <div className="header-menu absolute right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-xl w-56 z-50 py-1">
                {isOwner && (
                  <button
                    onClick={() => {
                      openChannelSettings("settings");
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-body text-text-secondary hover:bg-surface-raised hover:text-text flex items-center gap-2"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    {t("game.settings")}
                  </button>
                )}

                {/* Notifications section */}
                <div className="border-t border-border my-1" />
                <div className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setNotificationsExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between text-caption text-text-dim hover:text-text-secondary"
                  >
                    <span className="flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5" />
                      {t("game.notifications")}
                      {notifications.some((n) => !n.read) && (
                        <span className="bg-danger text-white text-micro px-1.5 rounded-full">
                          {notifications.filter((n) => !n.read).length}
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${notificationsExpanded ? "rotate-180" : ""}`}
                    />
                  </button>
                  {notificationsExpanded && (
                    <div className="mt-2">
                      {notifications.length > 0 && (
                        <div className="flex justify-end mb-1">
                          <button
                            onClick={() =>
                              setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
                            }
                            className="text-micro text-primary-light hover:text-primary"
                          >
                            {t("game.markAllRead")}
                          </button>
                        </div>
                      )}
                      {notifications.length === 0 ? (
                        <div className="text-caption text-text-dim py-2 text-center">
                          {t("game.noNotifications")}
                        </div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto -mx-1 px-1">
                          {notifications.slice(0, 5).map((n) => (
                            <div
                              key={n.id}
                              className={`py-1.5 text-caption ${n.read ? "text-text-dim" : "text-text-secondary"}`}
                            >
                              <div className="truncate">{n.message}</div>
                              <div className="text-micro text-text-dim">
                                {new Date(n.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Preferences section */}
                <div className="border-t border-border my-1" />
                <div className="px-4 py-2">
                  <div className="text-caption text-text-dim mb-1 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5" />
                    {t("common.language")}
                  </div>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as typeof locale)}
                    className="w-full px-2 py-1 bg-surface border border-border rounded text-caption text-text cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-light"
                  >
                    {LOCALES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-border my-1" />
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    openBugReport();
                  }}
                  className="w-full text-left px-4 py-2 text-body text-text-secondary hover:bg-surface-raised hover:text-text flex items-center gap-2"
                >
                  <Bug className="w-3.5 h-3.5" />
                  {t("game.reportBug")}
                </button>

                {/* Exit section */}
                <div className="border-t border-border my-1" />
                <button
                  onClick={async () => {
                    setShowUserMenu(false);
                    // Save position via API before leaving (socket disconnect may not fire)
                    try {
                      const channelId = new URLSearchParams(window.location.search).get(
                        "channelId",
                      );
                      if (channelId && socketRef.current) {
                        // EventBus 로 시뮬레이션에 위치를 묻는다
                        const pos = await new Promise<{ x: number; y: number } | null>(
                          (resolve) => {
                            let resolved = false;
                            const handler = (data: { x: number; y: number }) => {
                              resolved = true;
                              EventBus.off("player-position-response", handler);
                              resolve(data);
                            };
                            EventBus.on("player-position-response", handler);
                            EventBus.emit("request-player-position");
                            setTimeout(() => {
                              if (!resolved) {
                                EventBus.off("player-position-response", handler);
                                resolve(null);
                              }
                            }, 200);
                          },
                        );
                        if (pos) {
                          await fetch(`/api/channels/${channelId}/save-position`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }),
                          }).catch(() => {});
                        }
                      }
                    } catch {
                      /* best effort */
                    }
                    window.location.href = `/channels?characterId=${characterId}`;
                  }}
                  className="w-full text-left px-4 py-2 text-body text-text-secondary hover:bg-surface-raised hover:text-text flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t("game.leaveChannel")}
                </button>
                <button
                  onClick={() => {
                    document.cookie = "token=; path=/; max-age=0";
                    window.location.href = "/auth";
                  }}
                  className="w-full text-left px-4 py-2 text-body text-danger hover:bg-surface-raised hover:text-danger flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t("auth.logout")}
                </button>

                <div className="border-t border-border my-1" />
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    setShowAboutModal(true);
                  }}
                  className="w-full text-left px-4 py-2 text-body text-text-secondary hover:bg-surface-raised hover:text-text flex items-center gap-2"
                >
                  <Info className="w-3.5 h-3.5" />
                  {t("game.aboutDeskRpg")}
                </button>
              </div>
            )}
          </div>

          {/* Share popup (positioned independently) */}
          {showSharePopup && channel?.inviteCode && (
            <div
              style={{ top: "calc(var(--game-header-height, 48px) + 4px)" }}
              className="header-menu fixed right-4 bg-surface border border-border rounded-lg p-3 shadow-xl w-72 z-50"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-text-muted">{t("game.inviteLink")}</p>
                <button
                  onClick={() => setShowSharePopup(false)}
                  className="text-text-dim hover:text-text-secondary text-xs"
                >
                  {t("common.close")}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/channels/join/${channel.inviteCode}`}
                  className="flex-1 px-2 py-1 bg-bg border border-border rounded text-xs text-text-secondary"
                />
                <button
                  onClick={handleCopyInvite}
                  className="px-2 py-1 bg-primary hover:bg-primary-hover rounded text-xs"
                >
                  {copied ? t("game.copied") : t("common.copy")}
                </button>
              </div>
              <p className="text-xs text-text-dim mt-2">
                {t("game.inviteCodeLabel")}{" "}
                <span className="text-text-secondary font-mono">{channel.inviteCode}</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close dropdowns */}
      {showUserMenu && (
        <div className="fixed inset-0 z-[9]" onClick={() => setShowUserMenu(false)} />
      )}

      {showAboutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text">{t("about.title")}</h2>
              <button
                onClick={() => setShowAboutModal(false)}
                className="text-text-dim hover:text-text"
                aria-label={t("common.close")}
              >
                &times;
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-4 text-sm">
                <div className="text-text-dim">{t("about.version")}</div>
                <div className="text-text">v{APP_VERSION}</div>

                <div className="text-text-dim">{t("about.sourceCode")}</div>
                <a
                  href={SOURCE_CODE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-light hover:text-primary underline underline-offset-2 break-all"
                >
                  {SOURCE_CODE_URL}
                </a>

                <div className="text-text-dim">{t("about.license")}</div>
                <a
                  href={LICENSE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-light hover:text-primary underline underline-offset-2 break-all"
                >
                  LICENSE.md
                </a>

                <div className="text-text-dim">{t("about.thirdPartyLicenses")}</div>
                <div className="space-y-1">
                  <a
                    href={THIRD_PARTY_LICENSES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-primary-light hover:text-primary underline underline-offset-2"
                  >
                    {t("about.viewThirdPartyLicenses")}
                  </a>
                </div>

                <div className="text-text-dim">{t("about.instanceId")}</div>
                <div className="text-text break-all">{instanceId || "—"}</div>

                <div className="text-text-dim">{t("about.debug")}</div>
                <button
                  onClick={() => void copyDebugInformation()}
                  className="text-left text-primary-light hover:text-primary underline underline-offset-2"
                >
                  {debugCopied ? t("about.debugCopied") : t("about.copyDebugInformation")}
                </button>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowAboutModal(false)}
                className="px-4 py-2 rounded bg-primary hover:bg-primary-hover text-white text-sm font-semibold"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showKanban && channelId && (
        <KanbanBoardModal
          channelId={channelId}
          refreshTick={kanbanRefreshTick}
          initialTaskId={kanbanInitialTaskId}
          onClose={closeKanban}
          onConnectGateway={
            isOwner
              ? () => {
                  returnToKanbanRef.current = true;
                  setShowKanban(false);
                  openChannelSettings("gateway");
                }
              : undefined
          }
        />
      )}

      {showCron && channelId && (
        <CronModal
          channelId={channelId}
          npcs={cronNpcs}
          socket={socket}
          onToast={cronToast}
          initialJobId={cronInitialJobId}
          onClose={closeCron}
        />
      )}

      {showPasswordModal && channelId && (
        <PasswordModal
          channelName={channel?.name || t("channels.privateChannel")}
          onSubmit={handleGamePasswordSubmit}
          onClose={() => router.push(`/channels?characterId=${characterId}`)}
        />
      )}

      {showChannelSettings && channel && (
        <ChannelSettingsModal
          channelId={channel.id}
          channelName={channel.name}
          channelDescription={channel.description}
          isPublic={channel.isPublic}
          inviteCode={channel.inviteCode}
          initialTab={channelSettingsInitialTab}
          onClose={() => {
            setShowChannelSettings(false);
            if (returnToKanbanRef.current) {
              returnToKanbanRef.current = false;
              setShowKanban(true);
            }
          }}
          onUpdated={(data) => {
            if (data.gatewayConfig) void refreshNpcLists();
            if (
              returnToKanbanRef.current &&
              (data.gatewayConfig?.gatewayId || data.gatewayConfig?.url)
            ) {
              returnToKanbanRef.current = false;
              setShowChannelSettings(false);
              setShowKanban(true);
            }
            setChannel((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                ...data,
                hasGateway: data.gatewayConfig
                  ? Boolean(
                      (typeof data.gatewayConfig.gatewayId === "string" &&
                        data.gatewayConfig.gatewayId.trim()) ||
                      (typeof data.gatewayConfig.url === "string" &&
                        data.gatewayConfig.url.trim()) ||
                      prev.gatewayConfig?.gatewayId ||
                      prev.gatewayConfig?.url,
                    )
                  : prev.hasGateway,
                gatewayConfig: data.gatewayConfig
                  ? { ...(prev.gatewayConfig || {}), ...data.gatewayConfig }
                  : prev.gatewayConfig,
              };
            });
          }}
        />
      )}

      {/* Placement mode indicator */}
      {placementMode && (
        <div
          style={{ top: "calc(var(--game-header-height, 48px) + 16px)" }}
          className="fixed left-1/2 -translate-x-1/2 z-50 bg-primary text-white px-4 py-2 rounded-lg shadow-lg text-body font-medium"
        >
          {t("game.placementMode")}
        </div>
      )}

      {mode === "office" && (
        <>
          {/* Interact selection popup */}
          {interactSelectList && (
            <div className="fixed inset-0 z-40" onClick={() => setInteractSelectList(null)}>
              <div
                className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-surface border border-border rounded-lg shadow-xl p-2 min-w-[180px]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-center text-caption text-text-muted px-3 py-1 mb-1">
                  {t("game.whoToTalkTo")}
                </div>
                {interactSelectList.map((target) => (
                  <button
                    key={`${target.type}-${target.id}`}
                    onClick={() => {
                      setInteractSelectList(null);
                      if (target.type === "npc") {
                        EventBus.emit("npc:interact", { npcId: target.id, npcName: target.name });
                      } else {
                        EventBus.emit("player:chat-open");
                      }
                    }}
                    className="w-full text-left px-3 py-2 text-body text-text hover:bg-surface-raised rounded flex items-center gap-2"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${target.type === "npc" ? "bg-npc" : "bg-info"}`}
                    />
                    {target.name}
                    <span className="text-caption text-text-dim ml-auto">
                      {target.type === "npc" ? t("game.typeNpc") : t("game.typePlayer")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bottom toast */}
          {toastMessage && !interactSelectList && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 text-text text-body bg-surface/90 backdrop-blur px-5 py-2 rounded-full shadow-lg border border-border/50">
              {toastMessage}
            </div>
          )}
        </>
      )}

      {/* NPC Context Menu */}
      {contextMenu &&
        (() => {
          const currentMoveState = npcMoveStates[contextMenu.npcId] || contextMenu.moveState;
          const isCaller = npcCallers[contextMenu.npcId] === socket?.id;
          return (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
              <div className="fixed z-50" style={{ left: contextMenu.x, top: contextMenu.y }}>
                <div className="bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
                  {currentMoveState === "idle" && (
                    <button
                      onClick={handleCallNpc}
                      className="w-full text-left px-3 py-2 text-body text-npc hover:bg-surface-raised"
                    >
                      <PhoneCall className="w-3.5 h-3.5 inline mr-1" />
                      {t("context.call")}
                    </button>
                  )}
                  {currentMoveState === "waiting" && isCaller && (
                    <button
                      onClick={() => {
                        handleReturnNpc(contextMenu.npcId);
                        setContextMenu(null);
                      }}
                      className="w-full text-left px-3 py-2 text-body text-npc hover:bg-surface-raised"
                    >
                      <Undo2 className="w-3.5 h-3.5 inline mr-1" />
                      {t("context.return")}
                    </button>
                  )}
                  {currentMoveState === "waiting" && !isCaller && (
                    <button
                      disabled
                      className="w-full text-left px-3 py-2 text-body text-text-dim cursor-not-allowed"
                    >
                      <Clock className="w-3.5 h-3.5 inline mr-1" />
                      {t("context.calledByOther")}
                    </button>
                  )}
                  {currentMoveState !== "idle" && currentMoveState !== "waiting" && (
                    <button
                      disabled
                      className="w-full text-left px-3 py-2 text-body text-text-dim cursor-not-allowed"
                    >
                      <Footprints className="w-3.5 h-3.5 inline mr-1" />
                      {t("npc.moving")}
                    </button>
                  )}
                  <button
                    onClick={handleContextTalk}
                    disabled={currentMoveState !== "idle"}
                    className={`w-full text-left px-3 py-2 text-body ${
                      currentMoveState === "idle"
                        ? "text-text hover:bg-surface-raised"
                        : "text-text-dim cursor-not-allowed"
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 inline mr-1" />
                    {t("context.talk")}
                  </button>
                  <button
                    onClick={handleContextInviteToRoom}
                    className="w-full text-left px-3 py-2 text-body text-text hover:bg-surface-raised"
                  >
                    <Users className="w-3.5 h-3.5 inline mr-1" />
                    {t("npc.inviteToRoom")}
                  </button>
                  {isOwner && (
                    <>
                      <button
                        onClick={() => handleMoveNpcById(contextMenu.npcId)}
                        className="w-full text-left px-3 py-2 text-body text-text hover:bg-surface-raised"
                      >
                        <Footprints className="w-3.5 h-3.5 inline mr-1" />
                        {t("npc.move")}
                      </button>
                      <button
                        onClick={openProfileSettings}
                        disabled={!gatewayId}
                        title={!gatewayId ? t("game.roster.needsGateway") : undefined}
                        className="w-full text-left px-3 py-2 text-body text-text hover:bg-surface-raised disabled:text-text-dim disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-3.5 h-3.5 inline mr-1" />
                        {t("npc.profileSettings")}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleResetNpcChatById(contextMenu.npcId)}
                    className="w-full text-left px-3 py-2 text-body text-text hover:bg-surface-raised"
                  >
                    <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
                    {t("context.resetChat")}
                  </button>
                  {isOwner && (
                    <button
                      onClick={() => handleSleepNpcById(contextMenu.npcId)}
                      className="w-full text-left px-3 py-2 text-body text-danger hover:bg-surface-raised"
                    >
                      <UserMinus className="w-3.5 h-3.5 inline mr-1" />
                      {t("npc.sleep")}
                    </button>
                  )}
                </div>
              </div>
            </>
          );
        })()}

      {(meetingEntry.state.status === "walking" || meetingEntry.state.status === "failed") && (
        <div
          data-meeting-entry-status={meetingEntry.state.status}
          role="status"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 rounded bg-surface p-3 text-text shadow-lg"
        >
          <p>
            {meetingEntry.state.status === "walking"
              ? t("meeting.entryWalking")
              : t("meeting.entryFailed", {
                  reason:
                    t(`meeting.reason.${meetingEntry.state.reasonCode ?? "unknown"}`) ===
                    `meeting.reason.${meetingEntry.state.reasonCode ?? "unknown"}`
                      ? (meetingEntry.state.reasonCode ?? t("common.unknown"))
                      : t(`meeting.reason.${meetingEntry.state.reasonCode}`),
                })}
          </p>
          {meetingEntry.state.status === "failed" && (
            <button type="button" onClick={meetingEntry.request}>
              {t("common.retry")}
            </button>
          )}
          <button type="button" onClick={meetingEntry.cancel}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      {mode === "meeting" && character && (
        <MeetingWorkspace
          channelId={channelId!}
          character={{
            id: character.id,
            name: character.name,
            appearance: character.appearance,
          }}
          socket={socket}
          npcs={channelNpcs}
          onLeave={meetingEntry.cancel}
        />
      )}
    </div>
  );
}
