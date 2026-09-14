"use client";

import type { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
};

/** Semantic boundary for the persistent conversation column. */
export default function ConversationPane({ label, children }: Props) {
  return (
    <aside
      aria-label={label}
      data-conversation-pane="true"
      className="flex h-full min-h-0 min-w-0 flex-col bg-bg"
    >
      {children}
    </aside>
  );
}
