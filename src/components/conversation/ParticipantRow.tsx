"use client";

import RosterAvatar from "../RosterAvatar";

export default function ParticipantRow({
  name,
  detail,
  appearance,
  selected = false,
  onSelect,
  menuLabel,
  onOpenMenu,
}: {
  name: string;
  detail: string;
  appearance?: unknown;
  selected?: boolean;
  onSelect: () => void;
  menuLabel?: string;
  onOpenMenu?: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
        selected ? "bg-surface-raised" : "hover:bg-surface-raised/70"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <RosterAvatar appearance={appearance ?? null} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text">{name}</span>
          <span className="block truncate text-[11px] text-text-dim">{detail}</span>
        </span>
      </button>
      {onOpenMenu && (
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={menuLabel}
          className="rounded px-1.5 py-1 text-text-dim opacity-70 hover:bg-surface hover:text-text group-hover:opacity-100"
        >
          ⋯
        </button>
      )}
    </div>
  );
}
