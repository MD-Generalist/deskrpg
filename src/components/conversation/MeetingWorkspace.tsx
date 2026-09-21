"use client";

import type { Socket } from "socket.io-client";
import MeetingRoom from "../MeetingRoom";
import { useT } from "@/lib/i18n";
import { useState } from "react";

type Props = {
  channelId: string;
  character: {
    id: string;
    name: string;
    appearance: unknown;
  };
  socket: Socket | null;
  npcs: { id: string; name: string; appearance: unknown }[];
  onLeave: () => void;
};

/** Semantic entry surface around the existing full-featured meeting room. */
export default function MeetingWorkspace(props: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section
      data-meeting-workspace="true"
      aria-label={t("meeting.title")}
      className="meeting-map-panel"
      data-meeting-panel-collapsed={collapsed}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="meeting-map-content"
          onClick={() => setCollapsed(!collapsed)}
        >
          {t(collapsed ? "meeting.panelExpand" : "meeting.panelCollapse")}
        </button>
        <button type="button" data-meeting-leave onClick={props.onLeave}>
          {t("meeting.backToOffice")}
        </button>
      </div>
      <div id="meeting-map-content" className="min-h-0 flex-1" hidden={collapsed}>
        <MeetingRoom {...props} />
      </div>
    </section>
  );
}
