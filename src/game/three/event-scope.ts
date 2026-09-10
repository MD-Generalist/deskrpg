import { EventBus } from "../EventBus";
/** A renderer/scene may only remove subscriptions it owns during remounts. */
export function createEventScope(bus: typeof EventBus = EventBus) {
  const cleanup = new Set<() => void>();
  return {
    on<Args extends unknown[]>(event: string, listener: (...args: Args) => void) {
      bus.on(event, listener);
      cleanup.add(() => bus.off(event, listener));
    },
    addCleanup(callback: () => void) {
      cleanup.add(callback);
    },
    dispose() {
      for (const off of cleanup) off();
      cleanup.clear();
    },
  };
}
