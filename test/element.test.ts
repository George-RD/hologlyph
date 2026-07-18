/**
 * Tests for the <hologlyph-head> custom element.
 *
 * The element accepts a static `engineFactory` override so tests inject a fake
 * engine and never construct the real GPU/WebGPU engine. The fake's `ready`
 * event is triggered explicitly (markReady) so queueing vs flushing is fully
 * deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  BehaviorState,
  Engine,
  EngineEvents,
  EngineOptions,
  Expression,
  TextSkinSource,
  TTSAdapter,
} from '../src/contracts';
import { HologlyphHeadElement, defineHologlyphHead } from '../src/element';

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// --- Fake engine -----------------------------------------------------------

class FakeEngine implements Engine {
  readonly options: EngineOptions | undefined;
  mounted = false;
  disposed = 0;
  speakCalls: string[] = [];
  emotionCalls: Expression[] = [];
  scrollCalls: number[] = [];
  textSourceCalls: TextSkinSource[] = [];
  voiceAdapterCalls: TTSAdapter[] = [];
  motionCalls: boolean[] = [];

  private listeners = new Map<keyof EngineEvents, Set<(p: unknown) => void>>();

  // Stubs for the advanced sub-engines (only what the element touches).
  readonly motion = {
    attach: () => {},
    update: () => {},
    setExpression: () => {},
    applyVisemeFrame: () => {},
    clearVisemes: () => {},
    triggerNod: () => {},
    setGazeMode: () => {},
    setReducedMotion: (v: boolean) => {
      this.motionCalls.push(v);
    },
  } as unknown as Engine['motion'];

  readonly behavior = {
    state: 'hidden' as BehaviorState,
    scrollProgress: 0,
    on: () => () => {},
    off: () => {},
    emit: () => {},
    dispatch: () => {},
    setScrollProgress: () => {},
    observe: () => {},
    dispose: () => {},
  } as unknown as Engine['behavior'];

  readonly speech = {
    speaking: false,
    on: () => () => {},
    off: () => {},
    emit: () => {},
    setAdapter: () => {},
    speak: () => Promise.resolve(),
    cancel: () => {},
    dispose: () => {},
  } as unknown as Engine['speech'];

  readonly audio = {
    context: null,
    resumeFromGesture: () => Promise.resolve(),
    connectElement: () => {},
    readEnergy: () => 0,
    suspend: () => {},
    dispose: () => {},
  } as unknown as Engine['audio'];

  readonly vfx = {
    setEmergence: () => {},
    get emergence() {
      return 0;
    },
    get rootOffsetY() {
      return 0;
    },
    clippingPlane: {} as unknown as import('three').Plane,
    update: () => {},
    createSkinMaterial: () => ({}) as unknown as import('three').Material,
    dispose: () => {},
  } as unknown as Engine['vfx'];

  constructor(options?: EngineOptions) {
    this.options = options;
  }

  on<K extends keyof EngineEvents>(
    event: K,
    fn: (payload: EngineEvents[K]) => void,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (p: unknown) => void);
    return () => this.off(event, fn);
  }

  off<K extends keyof EngineEvents>(
    event: K,
    fn: (payload: EngineEvents[K]) => void,
  ): void {
    this.listeners.get(event)?.delete(fn as (p: unknown) => void);
  }

  emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  async mount(_canvas: HTMLCanvasElement, _host: Element): Promise<void> {
    this.mounted = true;
    // The element wires the 'ready' listener before mount; we emit it on
    // demand so tests control the exact ready moment.
    return;
  }

  markReady(): void {
    this.emit('ready', undefined as EngineEvents['ready']);
  }

  async speak(text: string): Promise<void> {
    this.speakCalls.push(text);
  }

  setEmotion(expression: Expression): void {
    this.emotionCalls.push(expression);
  }

  setScrollProgress(progress: number): void {
    this.scrollCalls.push(progress);
  }

  setTextSkinSource(source: TextSkinSource): void {
    this.textSourceCalls.push(source);
  }

  setVoiceAdapter(adapter: TTSAdapter): void {
    this.voiceAdapterCalls.push(adapter);
  }

  get state(): BehaviorState {
    return 'idle';
  }

  dispose(): void {
    this.disposed += 1;
  }
}

// --- Harness ---------------------------------------------------------------

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  HologlyphHeadElement.engineFactory = null;
  container.remove();
});

function makeFactory(): { engines: FakeEngine[] } {
  const engines: FakeEngine[] = [];
  HologlyphHeadElement.engineFactory = (opts?: EngineOptions) => {
    const e = new FakeEngine(opts);
    engines.push(e);
    return e;
  };
  return { engines };
}

// --- Deferred-mount engine (boot/disconnect race) ---------------------------

/**
 * A fake engine whose `mount` returns a promise the test controls, so we can
 * model the boot/disconnect race: connect, then disconnect before mount
 * resolves.
 */
class DeferredMountEngine extends FakeEngine {
  mountCalled = false;
  private _resolveMount: () => void = () => {};
  private _rejectMount: (err: unknown) => void = () => {};

  override async mount(_canvas: HTMLCanvasElement, _host: Element): Promise<void> {
    this.mountCalled = true;
    await new Promise<void>((resolve, reject) => {
      this._resolveMount = resolve;
      this._rejectMount = reject;
    });
  }

  resolveMount(): void {
    this._resolveMount();
  }

  rejectMount(err: unknown): void {
    this._rejectMount(err);
  }
}

function makeDeferredFactory(): { engines: DeferredMountEngine[] } {
  const engines: DeferredMountEngine[] = [];
  HologlyphHeadElement.engineFactory = (opts?: EngineOptions) => {
    const e = new DeferredMountEngine(opts);
    engines.push(e);
    return e;
  };
  return { engines };
}

// --- Fake ResizeObserver (leak detection) -----------------------------------

class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  readonly callback: (entries: unknown[]) => void;

  constructor(callback: (entries: unknown[]) => void) {
    this.callback = callback;
    FakeResizeObserver.last = this;
    FakeResizeObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
}

// --- Tests -----------------------------------------------------------------

describe('defineHologlyphHead', () => {
  it('registers the element idempotently', () => {
    defineHologlyphHead();
    const first = customElements.get('hologlyph-head');
    defineHologlyphHead();
    const second = customElements.get('hologlyph-head');
    expect(first).toBe(second);
    expect(first).toBe(HologlyphHeadElement);
  });
  it('registers under a custom tag name', () => {
    defineHologlyphHead('hologlyph-head-custom');
    const ctor = customElements.get('hologlyph-head-custom');
    expect(ctor).toBeDefined();
    const inst = document.createElement('hologlyph-head-custom');
    expect(inst instanceof HologlyphHeadElement).toBe(true);
  });
});

describe('lifecycle', () => {
  it('creates and mounts an engine on connect with attribute options', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    el.src = 'avatar.glb';
    container.appendChild(el);
    await flush();

    expect(engines).toHaveLength(1);
    expect(engines[0]!.mounted).toBe(true);
    expect(engines[0]!.options?.avatarUrl).toBe('avatar.glb');
  });

  it('passes reducedMotion option from the attribute', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    el.reducedMotion = true;
    container.appendChild(el);
    await flush();

    expect(engines[0]!.options?.reducedMotion).toBe(true);
  });

  it('disposes the engine exactly once on disconnect', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush();
    engines[0]!.markReady();
    await flush();

    expect(engines[0]!.disposed).toBe(0);
    expect(el.engine).not.toBeNull();

    el.remove();
    await flush();

    expect(engines[0]!.disposed).toBe(1);
    expect(el.engine).toBeNull();
  });

  it('creates a fresh engine on reconnect after disconnect', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush();
    engines[0]!.markReady();
    await flush();

    el.remove();
    await flush();
    expect(engines[0]!.disposed).toBe(1);

    container.appendChild(el);
    await flush();
    engines[1]!.markReady();
    await flush();

    expect(engines).toHaveLength(2);
    expect(engines[1]!.mounted).toBe(true);
  });
});

describe('queueing', () => {
  it('queues speak before ready and flushes after', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush();

    const p = el.speak('hello world');
    expect(engines[0]!.speakCalls).toHaveLength(0);

    engines[0]!.markReady();
    await flush();

    expect(engines[0]!.speakCalls).toContain('hello world');
    await expect(p).resolves.toBeUndefined();
  });

  it('queues setEmotion before ready and flushes after', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush();

    el.setEmotion('happy');
    expect(engines[0]!.emotionCalls).toHaveLength(0);

    engines[0]!.markReady();
    await flush();

    expect(engines[0]!.emotionCalls).toContain('happy');
  });

  it('speaks immediately once ready', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush();
    engines[0]!.markReady();
    await flush();

    await el.speak('later');
    expect(engines[0]!.speakCalls).toContain('later');
  });
});

describe('attribute reflection', () => {
  it('mirrors declarative attributes and properties', () => {
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;

    el.src = 'a.glb';
    expect(el.getAttribute('src')).toBe('a.glb');

    el.mode = 'manual';
    expect(el.getAttribute('mode')).toBe('manual');

    el.textSkin = 'hi';
    expect(el.getAttribute('text-skin')).toBe('hi');

    el.reducedMotion = true;
    expect(el.hasAttribute('reduced-motion')).toBe(true);
    el.reducedMotion = false;
    expect(el.hasAttribute('reduced-motion')).toBe(false);
  });
});

describe('attributeChangedCallback', () => {
  it('maps reduced-motion onto the live engine', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush();
    engines[0]!.markReady();
    await flush();

    el.reducedMotion = true;
    await flush();
    expect(engines[0]!.motionCalls).toContain(true);

    el.reducedMotion = false;
    await flush();
    expect(engines[0]!.motionCalls).toContain(false);
  });
});

describe('CustomEvent re-dispatch', () => {
  it('re-dispatches engine events as DOM CustomEvents', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;

    const events: string[] = [];
    el.addEventListener('hologlyph-ready', () => events.push('ready'));
    el.addEventListener('hologlyph-speechstart', () => events.push('speechstart'));
    el.addEventListener('hologlyph-speechend', () => events.push('speechend'));
    el.addEventListener('hologlyph-statechange', (e) =>
      events.push(`statechange:${(e as CustomEvent).detail.to}`),
    );
    el.addEventListener('hologlyph-error', (e) =>
      events.push(`error:${(e as CustomEvent).detail.error.message}`),
    );

    container.appendChild(el);
    await flush();
    const engine = engines[0]!;

    engine.markReady();
    await flush();
    engine.emit('speechstart', undefined as void);
    await flush();
    engine.emit('speechend', undefined as void);
    await flush();
    engine.emit('statechange', { from: 'idle', to: 'speaking' });
    await flush();
    engine.emit('error', new Error('boom'));
    await flush();

    expect(events).toContain('ready');
    expect(events).toContain('speechstart');
    expect(events).toContain('speechend');
    expect(events).toContain('statechange:speaking');
    expect(events).toContain('error:boom');
  });
});

describe('imperative surface', () => {
  it('exposes state and advanced engine getter', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush();

    expect(el.state).toBe('hidden');
    expect(el.engine).not.toBeNull();

    engines[0]!.markReady();
    await flush();
    expect(el.state).toBe('idle');
  });

  it('forwards setScrollProgress, setTextSkinSource, setVoiceAdapter', async () => {
    const { engines } = makeFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush();

    el.setScrollProgress(0.5);
    expect(engines[0]!.scrollCalls).toContain(0.5);

    const source: TextSkinSource = { getText: () => 'x', onChange: () => () => {} };
    el.setTextSkinSource(source);
    expect(engines[0]!.textSourceCalls).toContain(source);

    const adapter = {} as TTSAdapter;
    el.setVoiceAdapter(adapter);
    expect(engines[0]!.voiceAdapterCalls).toContain(adapter);
  });
});

describe('boot/disconnect race', () => {
  it('disposes an engine still mounting when disconnected and never leaves it live', async () => {
    const { engines } = makeDeferredFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);

    // Boot has reached the deferred mount await synchronously.
    expect(engines).toHaveLength(1);
    expect(engines[0]!.mountCalled).toBe(true);

    el.remove();
    await flush();

    // Disconnected mid-mount: the engine must be disposed and the element must
    // not expose a live engine.
    expect(engines[0]!.disposed).toBe(1);
    expect(el.engine).toBeNull();

    // Resolving the pending mount afterwards must not resurrect the engine.
    engines[0]!.resolveMount();
    await flush();
    expect(el.engine).toBeNull();
    expect(engines[0]!.disposed).toBe(1);
  });

  it('reconnects after a race creating exactly one fresh engine', async () => {
    const { engines } = makeDeferredFactory();
    defineHologlyphHead();
    const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
    container.appendChild(el);
    await flush(); // boot reached the deferred mount await (engine[0])

    el.remove();
    await flush(); // teardown disposes engine[0] and bumps the generation
    expect(engines[0]!.disposed).toBe(1);

    // Reconnect: a brand-new engine must be built and mounted.
    container.appendChild(el);
    await flush();
    expect(engines).toHaveLength(2);
    expect(engines[1]!.mountCalled).toBe(true);

    engines[1]!.resolveMount();
    await flush();
    expect(el.engine).toBe(engines[1]!);
    expect(engines[1]!.disposed).toBe(0);
  });
});

describe('ResizeObserver lifecycle', () => {
  it('disconnects the canvas ResizeObserver on teardown', async () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
    FakeResizeObserver.instances = [];
    FakeResizeObserver.last = null;
    try {
      makeFactory();
      defineHologlyphHead();
      const el = document.createElement('hologlyph-head') as HologlyphHeadElement;
      container.appendChild(el);
      await flush();

      expect(FakeResizeObserver.instances).toHaveLength(1);
      expect(FakeResizeObserver.last!.disconnected).toBe(false);

      el.remove();
      await flush();

      expect(FakeResizeObserver.last!.disconnected).toBe(true);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});
