"use client";

import type { Socket } from "socket.io-client";
import MeetingRoom from "../MeetingRoom";
import type { CharacterAppearance, LegacyCharacterAppearance } from "@/lib/lpc-registry";
import { useT } from "@/lib/i18n";

type Props = {
  channelId: string;
  character: {
    id: string;
    name: string;
    appearance: CharacterAppearance | LegacyCharacterAppearance;
  };
  socket: Socket | null;
  npcs: { id: string; name: string; appearance: unknown }[];
  onLeave: () => void;
};

/** Semantic entry surface around the existing full-featured meeting room. */
export default function MeetingWorkspace(props: Props) {
  const t = useT();
  return (
    <section
      data-meeting-workspace="true"
      aria-label={t("meeting.title")}
      className="fixed inset-0 z-30"
    >
      <MeetingRoom {...props} />
    </section>
  );
}
