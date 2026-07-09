import { describe, it, expect, vi } from 'vitest';
import { createBehaviorMachine, TRANSITIONS } from '../src/behavior';
import type { BehaviorState, BehaviorEvent, BehaviorMachine } from '../src/contracts';

/** Minimal event sequence from 'hidden' to each reachable state. */
const PATHS: Record<BehaviorState, BehaviorEvent[]> = {
  hidden: [],
  emerging: [{ type: 'enter-viewport' }],
  idle: [{ type: 'enter-viewport' }, { type: 'emerge-complete' }],
  listening: [{ type: 'enter-viewport' }, { type: 'emerge-complete' }, { type: 'listen-start' }],
  speaking: [{ type: 'enter-viewport' }, { type: 'emerge-complete' }, { type: 'speech-start' }],
  thinking: [
    { type: 'enter-viewport' },
    { type: 'emerge-complete' },
    { type: 'speech-start' },
    { type: 'speech-stall' },
  ],
  'reacting-to-scroll': [
    { type: 'enter-viewport' },
    { type: 'emerge-complete' },
    { type: 'scroll-active' },
  ],
  departing: [
    { type: 'enter-viewport' },
    { type: 'emerge-complete' },
    { type: 'exit-viewport' },
  ],
};

function reach(state: BehaviorState): BehaviorMachine {
  const m = createBehaviorMachine();
  for (const e of PATHS[state]) m.dispatch(e);
  expect(m.state).toBe(state);
  return m;
}

describe('transition table is data-driven', () => {
  it('declares a row for every state', () => {
    const states: BehaviorState[] = [
      'hidden',
      'emerging',
      'idle',
      'listening',
      'speaking',
      'thinking',
      'reacting-to-scroll',
      'departing',
    ];
    for (const s of states) expect(TRANSITIONS[s]).toBeDefined();
  });
});

describe('legal transitions', () => {
  const cases: Array<[BehaviorState, BehaviorEvent, BehaviorState]> = [
    ['hidden', { type: 'enter-viewport' }, 'emerging'],
    ['emerging', { type: 'emerge-complete' }, 'idle'],
    ['idle', { type: 'speech-start' }, 'speaking'],
    ['listening', { type: 'speech-start' }, 'speaking'],
    ['speaking', { type: 'speech-stall' }, 'thinking'],
    ['thinking', { type: 'speech-start' }, 'speaking'],
    ['thinking', { type: 'speech-end' }, 'idle'],
    ['speaking', { type: 'speech-end' }, 'idle'],
    ['idle', { type: 'listen-start' }, 'listening'],
    ['listening', { type: 'listen-end' }, 'idle'],
    ['idle', { type: 'scroll-active' }, 'reacting-to-scroll'],
    ['listening', { type: 'scroll-active' }, 'reacting-to-scroll'],
    ['reacting-to-scroll', { type: 'scroll-settled' }, 'idle'],
    ['idle', { type: 'exit-viewport' }, 'departing'],
    ['speaking', { type: 'exit-viewport' }, 'departing'],
    ['reacting-to-scroll', { type: 'exit-viewport' }, 'departing'],
    ['emerging', { type: 'exit-viewport' }, 'departing'],
    ['departing', { type: 'submerge-complete' }, 'hidden'],
    ['departing', { type: 'enter-viewport' }, 'emerging'],
  ];

  for (const [from, event, to] of cases) {
    it(`transitions ${from} + ${event.type} -> ${to}`, () => {
      const m = reach(from);
      const seen: string[] = [];
      m.on('transition', (t) => seen.push(`${t.from}->${t.to}:${t.event.type}`));
      m.dispatch(event);
      expect(m.state).toBe(to);
      expect(seen).toContain(`${from}->${to}:${event.type}`);
    });
  }
});

describe('illegal events are ignored', () => {
  const illegal: Array<[BehaviorState, BehaviorEvent]> = [
    ['hidden', { type: 'speech-start' }],
    ['hidden', { type: 'scroll-active' }],
    ['idle', { type: 'emerge-complete' }],
    ['idle', { type: 'listen-end' }],
    ['speaking', { type: 'enter-viewport' }],
    ['thinking', { type: 'scroll-active' }],
    ['departing', { type: 'speech-start' }],
    ['emerging', { type: 'speech-end' }],
  ];

  for (const [from, event] of illegal) {
    it(`ignores ${from} + ${event.type} without throwing or changing state`, () => {
      const m = reach(from);
      const seen: string[] = [];
      m.on('transition', () => seen.push('x'));
      expect(() => m.dispatch(event)).not.toThrow();
      expect(m.state).toBe(from);
      expect(seen).toHaveLength(0);
    });
  }
});
describe('stalled utterance ending while thinking returns to idle', () => {
  it('speaking -> speech-stall -> thinking -> speech-end -> idle', () => {
    const m = createBehaviorMachine();
    const seen: string[] = [];
    m.on('transition', (t) => seen.push(`${t.from}->${t.to}:${t.event.type}`));

    m.dispatch({ type: 'enter-viewport' });
    m.dispatch({ type: 'emerge-complete' });
    expect(m.state).toBe('idle');
    m.dispatch({ type: 'speech-start' });
    expect(m.state).toBe('speaking');
    m.dispatch({ type: 'speech-stall' });
    expect(m.state).toBe('thinking');

    // The utterance ends while still thinking: must fall back to idle rather
    // than hanging in 'thinking' (dec.behavior-state-machine).
    m.dispatch({ type: 'speech-end' });
    expect(m.state).toBe('idle');
    expect(seen).toContain('thinking->idle:speech-end');
  });
});

describe('scroll progress + settle debounce', () => {
  function makeDebounced(): { m: BehaviorMachine; tick: () => void; setNow: (n: number) => void } {
    let now = 0;
    let settleCb: (() => void) | null = null;
    const m = createBehaviorMachine({
      clock: () => now,
      settleDelayMs: 150,
      scheduleSettle: (cb) => {
        settleCb = cb;
        return 1;
      },
      clearSettle: () => {
        settleCb = null;
      },
    });
    m.dispatch({ type: 'enter-viewport' });
    m.dispatch({ type: 'emerge-complete' }); // -> idle
    return {
      m,
      setNow: (n) => {
        now = n;
      },
      tick: () => settleCb?.(),
    };
  }

  it('clamps progress and dispatches scroll-active then scroll-settled', () => {
    const { m, setNow, tick } = makeDebounced();
    m.setScrollProgress(2);
    expect(m.scrollProgress).toBe(1);
    expect(m.state).toBe('reacting-to-scroll');

    m.setScrollProgress(-1);
    expect(m.scrollProgress).toBe(0);

    setNow(100);
    tick();
    expect(m.state).toBe('reacting-to-scroll'); // 100 < 150 ms since last scroll

    setNow(300);
    tick();
    expect(m.state).toBe('idle'); // settled
  });

  it('delays settle while scrolling continues', () => {
    const { m, setNow, tick } = makeDebounced();
    m.setScrollProgress(0.5);
    for (let i = 0; i < 10; i++) {
      setNow(i * 20 + 20);
      m.setScrollProgress(0.5);
    }
    setNow(250);
    tick();
    expect(m.state).toBe('reacting-to-scroll');
    setNow(450);
    tick();
    expect(m.state).toBe('idle');
  });
});

describe('observers and disposal', () => {
  it('disconnects observers and removes the visibility listener on dispose', () => {
    const ioDisconnect = vi.fn();
    const roDisconnect = vi.fn();
    const ioStub = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: ioDisconnect,
    } as unknown as IntersectionObserver;
    const roStub = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: roDisconnect,
    } as unknown as ResizeObserver;
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const m = createBehaviorMachine({
      createIntersectionObserver: () => ioStub,
      createResizeObserver: () => roStub,
    });
    const host = document.createElement('div');
    m.observe(host);
    expect(ioStub.observe).toHaveBeenCalledWith(host);
    expect(roStub.observe).toHaveBeenCalledWith(host);

    m.dispose();
    expect(ioDisconnect).toHaveBeenCalledTimes(1);
    expect(roDisconnect).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('maps IntersectionObserver crossings to viewport events', () => {
    let cb: IntersectionObserverCallback = () => {};
    const ioStub = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as IntersectionObserver;
    const m = createBehaviorMachine({
      createIntersectionObserver: ((callback: IntersectionObserverCallback) => {
        cb = callback;
        return ioStub;
      }) as never,
      createResizeObserver: (() =>
        ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })) as never,
    });
    m.observe(document.createElement('div'));
    m.dispatch({ type: 'enter-viewport' });
    m.dispatch({ type: 'emerge-complete' }); // idle

    cb([{ isIntersecting: true } as IntersectionObserverEntry], ioStub);
    expect(m.state).toBe('idle'); // enter-viewport while idle is a no-op
    cb([{ isIntersecting: false } as IntersectionObserverEntry], ioStub);
    expect(m.state).toBe('departing'); // exit-viewport from idle
  });
});
