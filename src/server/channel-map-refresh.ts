import { randomUUID } from "node:crypto";
/** One socket authority per installation. Leases deliberately fail closed on reset
 * failure; retry finish or restart the socket process after repairing the DB. */
export function createChannelMapRefresh(effects: {
  pause(id: string): Promise<void>;
  reset(id: string): Promise<void>;
  ready(id: string): void;
}) {
  const leases = new Map<string, string>();
  const generations = new Map<string, number>();
  const finishing = new Map<string, Promise<void>>();
  return {
    generation: (id: string) => generations.get(id) ?? 0,
    isPaused: (id: string) => leases.has(id),
    async begin(id: string) {
      if (leases.has(id)) return null;
      const lease = randomUUID();
      leases.set(id, lease);
      generations.set(id, (generations.get(id) ?? 0) + 1);
      try {
        await effects.pause(id);
        if (leases.get(id) !== lease) throw Error("Stale map refresh lease");
        return lease;
      } catch (error) {
        if (leases.get(id) === lease) leases.delete(id);
        throw error;
      }
    },
    async finish(id: string, lease: string) {
      if (leases.get(id) !== lease) throw Error("Invalid map refresh lease");
      const pending = finishing.get(id);
      if (pending) return pending;
      // Retry requests for one lease must not launch a second asynchronous reset.
      const completion = Promise.resolve()
        .then(async () => {
          await effects.reset(id);
          if (leases.get(id) !== lease) throw Error("Stale map refresh lease");
          effects.ready(id);
          leases.delete(id);
        })
        .finally(() => {
          if (finishing.get(id) === completion) finishing.delete(id);
        });
      finishing.set(id, completion);
      return completion;
    },
  };
}
