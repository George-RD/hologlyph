/**
 * Tiny typed event emitter shared by the engine and (as a local copy) by other
 * modules. Each module owns its own small emitter to keep the cross-module
 * contract surface minimal; this one backs the Engine.
 */
import type { Emitter, Listener } from '../contracts.js';

export function createEmitter<Events extends Record<string, unknown>>(): Emitter<Events> {
  const listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  return {
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(fn as Listener<unknown>);
      return () => {
        set?.delete(fn as Listener<unknown>);
      };
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn as Listener<unknown>);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      // Copy so listeners may unsubscribe during dispatch without skipping peers.
      for (const fn of [...set]) {
        (fn as Listener<Events[typeof event]>)(payload);
      }
    },
  };
}
