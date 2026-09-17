"use client";

import type { KanbanTaskStatus } from "@/lib/hermes/deskrpg-plugin-types";

export type KanbanMoveEvent =
  | { type: "start"; taskId: string; source: KanbanTaskStatus }
  | { type: "target"; taskId: string; source: KanbanTaskStatus; target: KanbanTaskStatus }
  | { type: "submit"; taskId: string; source: KanbanTaskStatus; target: KanbanTaskStatus }
  | { type: "cancel"; taskId: string; source: KanbanTaskStatus; reason: KanbanMoveCancelReason };

export type KanbanMoveCancelReason =
  | "escape"
  | "outside"
  | "same-column"
  | "pointer-cancel"
  | "focus-loss"
  | "teardown"
  | "target-missing";

export type KanbanMoveInteractionHandler = (event: KanbanMoveEvent) => void;

export function visibleKanbanColumns(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-column]")).filter(
    (column) => !column.closest("[hidden]") && column.getAttribute("aria-hidden") !== "true",
  );
}

export function columnStatus(column: HTMLElement): KanbanTaskStatus | null {
  const value = column.dataset.column;
  return value ? (value as KanbanTaskStatus) : null;
}

/** `running` is owned by the Hermes dispatcher and cannot be selected directly. */
export function isKanbanDirectMoveTarget(
  target: KanbanTaskStatus,
  source?: KanbanTaskStatus,
): boolean {
  return target !== "running" || target === source;
}

export function directMoveColumns(root: ParentNode, source: KanbanTaskStatus): HTMLElement[] {
  return visibleKanbanColumns(root).filter((column) => {
    const status = columnStatus(column);
    return status !== null && isKanbanDirectMoveTarget(status, source);
  });
}

/** Pointer capture is progressive enhancement; synthetic and cancelled pointers may reject it. */
export function trySetPointerCapture(element: HTMLElement, pointerId: number): boolean {
  try {
    element.setPointerCapture?.(pointerId);
    return true;
  } catch (error) {
    if (error instanceof DOMException) return false;
    throw error;
  }
}

export function tryReleasePointerCapture(element: HTMLElement, pointerId: number): boolean {
  try {
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture?.(pointerId);
    return true;
  } catch (error) {
    if (error instanceof DOMException) return false;
    throw error;
  }
}

export function clearMoveTargets(root: ParentNode = document) {
  for (const column of root.querySelectorAll<HTMLElement>('[data-move-target="true"]')) {
    column.removeAttribute("data-move-target");
    column.classList.remove("ring-2", "ring-info", "bg-info/10");
  }
}

export function markMoveTarget(column: HTMLElement | null, root: ParentNode = document) {
  clearMoveTargets(root);
  if (!column) return;
  column.dataset.moveTarget = "true";
  column.classList.add("ring-2", "ring-info", "bg-info/10");
  column.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function autoScrollKanbanBoard(handle: HTMLElement, clientX: number, edge = 40) {
  const scroller = handle.closest<HTMLElement>(".overflow-x-auto");
  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();
  const direction = clientX < bounds.left + edge ? -1 : clientX > bounds.right - edge ? 1 : 0;
  if (direction) scroller.scrollBy({ left: direction * edge, behavior: "auto" });
}

export function restoreKanbanMoveFocus(
  handle: HTMLButtonElement | null,
  fallback: HTMLElement | null,
) {
  requestAnimationFrame(() => {
    if (handle?.isConnected) handle.focus();
    else if (fallback?.isConnected) fallback.focus();
  });
}

export function restoreKanbanMoveResultFocus(root: HTMLElement | null, taskId: string) {
  requestAnimationFrame(() => {
    if (!root?.isConnected) return;
    const handle = Array.from(
      root.querySelectorAll<HTMLButtonElement>("[data-card-move-handle]"),
    ).find((candidate) => candidate.dataset.cardMoveHandle === taskId);
    (handle ?? root).focus();
  });
}
