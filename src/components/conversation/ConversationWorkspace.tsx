"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useT } from "@/lib/i18n";

type Props = {
  navigator: ReactNode;
  conversation: ReactNode;
  conversationWidth: number;
  children: ReactNode;
  inactive?: boolean;
};

type WorkspaceStyle = CSSProperties & {
  "--conversation-pane-width": string;
  "--workspace-nav-width": string;
};

/** Three-column frame. The CSS variables also constrain the fixed Three.js presentation. */
export default function ConversationWorkspace({
  navigator,
  conversation,
  conversationWidth,
  children,
  inactive = false,
}: Props) {
  const t = useT();
  const [mobilePanel, setMobilePanel] = useState<"navigator" | "conversation" | null>(null);
  const [conversationCollapsed, setConversationCollapsed] = useState(false);
  const navigatorButtonRef = useRef<HTMLButtonElement>(null);
  const conversationButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobilePanel = useCallback(() => {
    const closing = mobilePanel;
    setMobilePanel(null);
    queueMicrotask(() => {
      if (closing === "navigator") navigatorButtonRef.current?.focus();
      if (closing === "conversation") conversationButtonRef.current?.focus();
    });
  }, [mobilePanel]);
  useEffect(() => {
    if (!mobilePanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobilePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeMobilePanel, mobilePanel]);
  const style: WorkspaceStyle = {
    "--conversation-pane-width": conversationCollapsed ? "0px" : `${conversationWidth}px`,
    "--workspace-nav-width": "264px",
  };

  return (
    <div
      data-conversation-workspace="true"
      data-inactive={inactive}
      aria-hidden={inactive || undefined}
      inert={inactive || undefined}
      className="conversation-workspace fixed inset-x-0 bottom-0 top-[var(--game-header-height,48px)] z-0 grid min-h-0 overflow-hidden"
      style={style}
    >
      <div
        data-workspace-navigator="true"
        data-drawer-open={mobilePanel === "navigator"}
        role={mobilePanel === "navigator" ? "dialog" : undefined}
        aria-modal={mobilePanel === "navigator" ? true : undefined}
        className="workspace-navigator min-h-0 min-w-0"
      >
        {navigator}
      </div>
      <main
        data-workspace-map="true"
        aria-label={t("workspace.map")}
        className="relative min-h-0 min-w-0 overflow-hidden"
      >
        {children}
      </main>
      <div
        data-workspace-conversation="true"
        data-drawer-open={mobilePanel === "conversation"}
        data-collapsed={conversationCollapsed}
        role={mobilePanel === "conversation" ? "dialog" : undefined}
        aria-modal={mobilePanel === "conversation" ? true : undefined}
        className="workspace-conversation relative z-20 min-h-0 min-w-0 border-l border-border bg-bg"
      >
        {conversation}
      </div>
      <button
        type="button"
        aria-label={t(
          conversationCollapsed
            ? "workspace.conversation.expand"
            : "workspace.conversation.collapse",
        )}
        aria-expanded={!conversationCollapsed}
        className="workspace-conversation-collapse"
        style={{ right: conversationCollapsed ? 0 : conversationWidth }}
        onClick={() => setConversationCollapsed((collapsed) => !collapsed)}
      >
        {conversationCollapsed ? "◀" : "▶"}
      </button>
      {mobilePanel && (
        <button
          type="button"
          aria-label={t("workspace.drawer.close")}
          className="workspace-drawer-backdrop"
          onClick={closeMobilePanel}
        />
      )}
      <button
        type="button"
        ref={navigatorButtonRef}
        aria-expanded={mobilePanel === "navigator"}
        className="workspace-drawer-toggle workspace-navigator-toggle"
        onClick={() => setMobilePanel((current) => (current === "navigator" ? null : "navigator"))}
      >
        {t("workspace.drawer.navigator")}
      </button>
      <button
        type="button"
        ref={conversationButtonRef}
        aria-expanded={mobilePanel === "conversation"}
        className="workspace-drawer-toggle workspace-conversation-toggle"
        onClick={() =>
          setMobilePanel((current) => (current === "conversation" ? null : "conversation"))
        }
      >
        {t("workspace.drawer.conversation")}
      </button>
    </div>
  );
}
