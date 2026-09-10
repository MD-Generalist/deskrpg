/** FIFO within a session; independent sessions keep running concurrently. */
export class SessionQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly counts = new Map<string, number>();
  constructor(private readonly limit = 8) {}
  size(key: string): number {
    return this.counts.get(key) ?? 0;
  }
  isFull(key: string): boolean {
    return this.size(key) >= this.limit;
  }
  async idle(key: string): Promise<void> {
    await this.tails.get(key);
  }
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.size(key) >= this.limit) return Promise.reject(new Error("queue_full"));
    this.counts.set(key, this.size(key) + 1);
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work);
    const tail = result
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        const remaining = this.size(key) - 1;
        if (remaining) this.counts.set(key, remaining);
        else this.counts.delete(key);
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    this.tails.set(key, tail);
    // Resolve after cleanup, so a completed run never still counts as queued.
    return result.then(
      async (value) => {
        await tail;
        return value;
      },
      async (error) => {
        await tail;
        throw error;
      },
    );
  }
}
