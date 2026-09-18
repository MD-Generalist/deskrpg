"use client";
import { createPortal } from "react-dom";

export interface KanbanDragPreviewState {
  /** 잡은 순간 카드 안에서의 커서 위치. 이걸 유지해야 카드가 손에서 튀지 않는다. */
  grabX: number;
  grabY: number;
  pointerX: number;
  pointerY: number;
  width: number;
  title: string;
  subtitle: string;
}

/**
 * 포인터를 따라다니는 카드 사본. 원본 카드는 제자리에 흐리게 남고(R2) 이 사본만 움직인다.
 * `transform` 만 바꾸므로 프레임마다 레이아웃이 다시 계산되지 않는다.
 * 키보드 이동에는 포인터 좌표가 없으므로 렌더링되지 않는다.
 */
export default function KanbanDragPreview({ state }: { state: KanbanDragPreviewState | null }) {
  if (!state || typeof document === "undefined") return null;
  const x = state.pointerX - state.grabX;
  const y = state.pointerY - state.grabY;
  return createPortal(
    <div
      data-kanban-drag-preview=""
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-50 rounded-lg border border-info bg-surface-raised p-2.5 text-xs shadow-lg"
      style={{
        // 기울임은 CSS 의 개별 `rotate` 속성이 얹는다 — reduced-motion 이 그것만 끌 수 있도록.
        transform: `translate3d(${x}px, ${y}px, 0)`,
        width: state.width > 0 ? `${state.width}px` : undefined,
      }}
    >
      <div className="font-semibold text-text leading-snug break-words">{state.title}</div>
      <div className="mt-1 text-[11px] text-text-muted truncate">{state.subtitle}</div>
    </div>,
    document.body,
  );
}
