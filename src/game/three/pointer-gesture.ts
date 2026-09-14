type Pointer = Pick<PointerEvent, "pointerId" | "isPrimary" | "button" | "clientX" | "clientY">;
/** A drag never becomes a click, even if it returns to its starting point. */
export class PointerGesture {
  private down: { id: number; button: number; x: number; y: number; dragged: boolean } | null =
    null;
  start(e: Pointer) {
    this.down =
      e.isPrimary && (e.button === 0 || e.button === 2)
        ? { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, dragged: false }
        : null;
  }
  move(e: Pointer) {
    if (
      this.down?.id === e.pointerId &&
      Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) >= 5
    )
      this.down.dragged = true;
  }
  finish(e: Pointer) {
    this.move(e);
    const down = this.down;
    this.down = null;
    return (
      !!down && e.isPrimary && down.id === e.pointerId && down.button === e.button && !down.dragged
    );
  }
  cancel() {
    this.down = null;
  }
}
