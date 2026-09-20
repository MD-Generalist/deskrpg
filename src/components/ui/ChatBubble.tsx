"use client";

import type { ReactNode } from "react";
import RosterAvatar from "../RosterAvatar";
import MarkdownContent from "./MarkdownContent";

/** 말풍선 옆 아바타의 지름(px). 연속 말풍선의 빈 자리도 같은 폭을 쓴다. */
export const CHAT_AVATAR_SIZE = 28;

export interface ChatBubbleProps {
  sender: "player" | "npc" | "system";
  name?: string;
  streaming?: boolean;
  /**
   * 발화자의 외형. **넘기면** 상대 말풍선 왼쪽에 원형 아바타가 붙는다 — 외형을 모르면(`null`)
   * 기본 표시로 그린다. 넘기지 않으면(`undefined`) 아바타 자리 자체가 없다.
   * 내 말풍선(`player`)에는 어느 쪽이든 아바타가 없다.
   */
  avatar?: unknown;
  /** 바로 앞 말풍선과 같은 발화자다 — 아바타·이름을 되풀이하지 않고 자리만 맞춘다. */
  continued?: boolean;
  children: ReactNode;
}

export default function ChatBubble({
  sender,
  name,
  streaming,
  avatar,
  continued = false,
  children,
}: ChatBubbleProps) {
  if (sender === "system") {
    return <div className="text-center text-text-muted text-caption italic py-1">{children}</div>;
  }

  const isPlayer = sender === "player";
  const isNpc = sender === "npc";

  const withAvatar = !isPlayer && avatar !== undefined;

  return (
    <div
      className={`flex ${isPlayer ? "justify-end" : "justify-start"} ${withAvatar ? "gap-2" : ""}`}
    >
      {withAvatar &&
        (continued ? (
          <div
            data-chat-avatar="spacer"
            aria-hidden="true"
            className="shrink-0"
            style={{ width: CHAT_AVATAR_SIZE }}
          />
        ) : (
          <div data-chat-avatar="shown" className="shrink-0 self-start">
            <RosterAvatar appearance={avatar} size={CHAT_AVATAR_SIZE} />
          </div>
        ))}
      <div
        // e2e 훅. 말풍선은 클래스명만으로는 발신자를 구분할 수 없고(색상 유틸리티는
        // 리팩터 한 번에 바뀐다), 스트리밍 중인지도 밖에서 알 수 없다.
        data-chat-bubble={sender}
        data-streaming={streaming ? "true" : "false"}
        className={`
          max-w-[85%] px-3 py-2 rounded-lg text-body
          ${isPlayer ? "bg-primary text-white" : "bg-surface-raised text-text-secondary"}
        `
          .trim()
          .replace(/\s+/g, " ")}
      >
        {!isPlayer && name && !(withAvatar && continued) && (
          <div className="text-caption font-semibold text-npc mb-0.5">{name}</div>
        )}
        {isNpc && typeof children === "string" ? <MarkdownContent content={children} /> : children}
        {streaming && (
          <span className="inline-block w-1.5 h-4 bg-npc ml-0.5 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
