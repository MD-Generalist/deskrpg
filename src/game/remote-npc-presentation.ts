/** Visual follower only. Collision coordinates remain in the authoritative motion snapshot. */
export class RemoteNpcPresentation {
  x: number;
  y: number;
  private targetX: number;
  private targetY: number;
  walking = false;

  constructor(x: number, y: number) {
    this.x = this.targetX = x;
    this.y = this.targetY = y;
  }

  accept(x: number, y: number, snap = false) {
    this.targetX = x;
    this.targetY = y;
    if (snap || Math.hypot(x - this.x, y - this.y) > 192) {
      this.x = x;
      this.y = y;
      this.walking = false;
    }
  }

  step(deltaMs: number) {
    const dx = this.targetX - this.x,
      dy = this.targetY - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.25) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.walking = false;
      return;
    }
    // A 100ms time constant keeps advancing throughout ordinary 200ms packet gaps.
    // Never extrapolate beyond the latest authoritative target or stop on an idle packet.
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(deltaMs, 100)) / 100);
    this.x += dx * alpha;
    this.y += dy * alpha;
    this.walking = alpha > 0;
  }
}
