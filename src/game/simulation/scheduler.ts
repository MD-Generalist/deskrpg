/** 틱 시계(rAF 시각)에 묶인 지연 호출. 루프가 멈추면 같이 멈춘다 — 옛 씬 타이머와 같다. */
export class Scheduler {
  private entries: { at: number; run: () => void }[] = [];

  delay(now: number, ms: number, run: () => void): void {
    this.entries.push({ at: now + ms, run });
  }

  tick(now: number): void {
    if (!this.entries.length) return;
    const due = this.entries.filter((entry) => entry.at <= now);
    if (!due.length) return;
    this.entries = this.entries.filter((entry) => entry.at > now);
    for (const entry of due) entry.run();
  }

  clear(): void {
    this.entries = [];
  }
}
