/**
 * BehaviorMachine: an explicit finite state machine (dec.behavior-state-machine)
 * driven by viewport visibility, speech events, scroll progress, and tab
 * visibility. The transition table is encoded as plain data.
 *
 * Scroll progress is normalised in JS (dec.scroll-timeline): never a CSS scroll
 * timeline. The settle debounce is timestamp based and rAF-free; both the clock
 * and the settle scheduler are injectable for deterministic tests.
 */

import type {
  BehaviorState,
  BehaviorEvent,
  BehaviorMachine,
  BehaviorMachineEvents,
} from '../contracts';
import { clamp01 } from '../contracts';

type EventType = BehaviorEvent['type'];

/** Transition table: Record<state, Partial<Record<event.type, state>>>. */
export type TransitionTable = Record<BehaviorState, Partial<Record<EventType, BehaviorState>>>;

export const TRANSITIONS: TransitionTable = {
  hidden: { 'enter-viewport': 'emerging' },
  emerging: {
    'emerge-complete': 'idle',
    'exit-viewport': 'departing',
  },
  idle: {
    'speech-start': 'speaking',
    'listen-start': 'listening',
    'scroll-active': 'reacting-to-scroll',
    'exit-viewport': 'departing',
  },
  listening: {
    'speech-start': 'speaking',
    'listen-end': 'idle',
    'scroll-active': 'reacting-to-scroll',
    'exit-viewport': 'departing',
  },
  speaking: {
    'speech-stall': 'thinking',
    'speech-end': 'idle',
    'exit-viewport': 'departing',
  },
  thinking: {
    'speech-start': 'speaking',
    'speech-end': 'idle',
    'exit-viewport': 'departing',
  },
  'reacting-to-scroll': {
    'scroll-settled': 'idle',
    'exit-viewport': 'departing',
  },
  departing: {
    'submerge-complete': 'hidden',
    'enter-viewport': 'emerging',
  },
};

type Listener<T> = (payload: T) => void

class EmitterImpl<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set<Listener<Events[K]>>();
      this.listeners[event] = set;
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners[event]?.delete(fn);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}

export interface BehaviorMachineOptions {
  /** Monotonic time source in milliseconds (defaults to performance.now). */
  clock?: () => number;
  /** Debounce window before a scroll-settled dispatch. */
  settleDelayMs?: number;
  createIntersectionObserver?: (
    cb: IntersectionObserverCallback,
    init?: IntersectionObserverInit,
  ) => IntersectionObserver;
  createResizeObserver?: (cb: ResizeObserverCallback) => ResizeObserver;
  /** Injectable so tests can flush the settle deterministically. */
  scheduleSettle?: (cb: () => void, delayMs: number) => unknown;
  clearSettle?: (handle: unknown) => void;
}

const VIEWPORT_THRESHOLD = 0.15;

export function createBehaviorMachine(options: BehaviorMachineOptions = {}): BehaviorMachine {
  const clock =
    options.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const settleDelayMs = options.settleDelayMs ?? 140;
  const createIO =
    options.createIntersectionObserver ??
    ((cb: IntersectionObserverCallback, init?: IntersectionObserverInit) => new IntersectionObserver(cb, init));
  const createRO =
    options.createResizeObserver ?? ((cb: ResizeObserverCallback) => new ResizeObserver(cb));
  const scheduleSettle =
    options.scheduleSettle ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearSettle =
    options.clearSettle ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const emitter = new EmitterImpl<BehaviorMachineEvents>();

  let state: BehaviorState = 'hidden';
  let scrollProgress = 0;
  let scrollActive = false;
  let lastScrollAt = 0;
  let settleTimer: unknown = null;
  let io: IntersectionObserver | null = null;
  let ro: ResizeObserver | null = null;
  let onVisibility: (() => void) | null = null;
  // Recomputed by the ResizeObserver; bounds the normalized progress derived in
  // JS (never a CSS scroll timeline, dec.scroll-timeline).
  let _scrollExtent = 0;
  let disposed = false;

  function dispatch(event: BehaviorEvent): void {
    const next = TRANSITIONS[state]?.[event.type];
    if (!next || next === state) return;
    const from = state;
    state = next;
    emitter.emit('transition', { from, to: next, event });
  }

  function scheduleSettleFlush(): void {
    if (settleTimer !== null) clearSettle(settleTimer);
    settleTimer = scheduleSettle(flushSettle, settleDelayMs);
  }

  function flushSettle(): void {
    settleTimer = null;
    if (scrollActive && clock() - lastScrollAt >= settleDelayMs) {
      scrollActive = false;
      if (TRANSITIONS[state]?.['scroll-settled']) dispatch({ type: 'scroll-settled' });
    }
  }

  function setScrollProgress(progress: number): void {
    scrollProgress = clamp01(progress);
    lastScrollAt = clock();
    const canActivate = !!TRANSITIONS[state]?.['scroll-active'];
    if (canActivate && !scrollActive) {
      scrollActive = true;
      dispatch({ type: 'scroll-active' });
    }
    scheduleSettleFlush();
  }

  function recomputeExtent(host: Element): void {
    const rect = host.getBoundingClientRect();
    _scrollExtent = Math.max(0, rect.height);
  }

  function observe(host: Element): void {
    io = createIO((entries) => {
      for (const entry of entries) {
        dispatch(entry.isIntersecting ? { type: 'enter-viewport' } : { type: 'exit-viewport' });
      }
    }, { threshold: VIEWPORT_THRESHOLD });
    io.observe(host);

    ro = createRO(() => recomputeExtent(host));
    ro.observe(host);

    // Suspension flag (dec.performance-budget): true while the tab is hidden.
    onVisibility = () => {
      void document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);

    recomputeExtent(host);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    io?.disconnect();
    ro?.disconnect();
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    if (settleTimer !== null) clearSettle(settleTimer);
    io = null;
    ro = null;
    onVisibility = null;
    settleTimer = null;
  }

  return {
    get state() {
      return state;
    },
    get scrollProgress() {
      return scrollProgress;
    },
    dispatch,
    setScrollProgress,
    observe,
    on: (e, fn) => emitter.on(e, fn),
    off: (e, fn) => emitter.off(e, fn),
    emit: (e, p) => emitter.emit(e, p),
    dispose,
  };
}
