/**
 * Core engine wiring tests. All sibling modules (behavior, motion, audio,
 * speech, text-skin, shaders, renderer, asset) are mocked with lightweight
 * fakes so the engine runs end-to-end without any GPU, audio, or real
 * subsystem. The sibling implementation files are owned by other agents; the
 * test resolves the (real) module paths and substitutes these fakes.
 *
 * Subsystem factories return FRESH fake objects per call and push them into a
 * registry, so a test can drive behaviour/speech events on the exact instance
 * the engine constructed and assert its reactions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createEngine, visemeTap } from '../src/core';
import { createPlaceholderAvatar } from '../src/core/placeholder-avatar';
import { DEFAULT_HEAD_CONFIG } from '../src/contracts';
import type {
  InteriorGlyphFieldOptions,
  InteriorGlyphState,
} from '../src/shaders/interior-glyph-field';
import type {
  AssetLoader,
  AudioEngine,
  BehaviorMachine,
  BehaviorState,
  BehaviorMachineEvents,
  Emitter,
  Expression,
  HeadConfig,
  HeadConfigOverrides,
  HeadInteriorConfig,
  HeadPoolConfig,
  LensBinding,
  LoadedAvatar,
  GazeMode,
  MotionEngine,
  RendererHost,
  SpeechEngine,
  SpeechMode,
  TTSAdapter,
  TextSkinEngine,
  UtteranceEvents,
  VFXEngine,
  VisemeFrame,
} from '../src/contracts';

// --- Fake shapes (contract + test-only bookkeeping) ------------------------

interface FakeBehavior extends BehaviorMachine {
  disposeCount: number;
  observeCount: number;
  state: BehaviorState;
}
interface FakeMotion extends MotionEngine {
  disposeCount: number;
  motionUpdateCalls: number;
  applyVisemeCount: number;
  lastFrame: VisemeFrame | undefined;
  gazeMode: GazeMode | undefined;
  expression: Expression | undefined;
  clearVisemesCount: number;
  reduced: boolean;
}
interface FakeAudio extends AudioEngine {
  disposeCount: number;
  suspendCount: number;
  resumeCount: number;
}
interface FakeSpeech extends SpeechEngine {
  disposeCount: number;
  adapter: TTSAdapter | undefined;
  speaking: boolean;
}
interface FakeTextSkin extends TextSkinEngine {
  disposeCount: number;
  updateCalls: number;
  reduced: boolean | undefined;
}
interface FakeVfx extends Omit<VFXEngine, 'rootOffsetY'> {
  disposeCount: number;
  emergenceValue: number;
  reduced: boolean;
  /** Writable here so a test can place the waterline anywhere on the rig. */
  rootOffsetY: number;
  _headConfig: HeadConfig;
  headConfigCalls: HeadConfigOverrides[];
  lensBindings: Array<LensBinding | null>;
  fluidDrives: Array<{
    state: BehaviorState;
    drive: number;
    carrier: readonly [number, number, number];
  }>;
  setReducedMotion(reduce: boolean): void;
}
interface FakeRenderer extends RendererHost {
  disposeCount: number;
  renderCount: number;
  backend: 'webgpu' | 'webgl2' | 'uninitialized';
  gpuRenderer: unknown;
  setSizeCalls: Array<{ width: number; height: number; pixelRatio?: number }>;
}
interface FakeAsset extends AssetLoader {
  disposeCount: number;
  loadCalls: number;
  loadUrls: string[];
  attachRendererCalls: unknown[];
}

interface FakePool {
  object: THREE.Object3D;
  configs: HeadPoolConfig[];
  updates: { dt: number; rootOffsetY: number; waterlineRadius: number; drive: number }[];
  disposeCount: number;
  setConfig(config: HeadPoolConfig): void;
  update(dt: number, state: { rootOffsetY: number; waterlineRadius: number; drive: number }): void;
  dispose(): void;
}
interface FakeInteriorField {
  object: THREE.Object3D;
  options: InteriorGlyphFieldOptions[];
  configs: HeadInteriorConfig[];
  updates: { dt: number; frame: THREE.Matrix4; reduced: boolean; camera: THREE.Camera }[];
  disposeCount: number;
  setConfig(config: HeadInteriorConfig): void;
  update(dt: number, state: InteriorGlyphState): void;
  dispose(): void;
}
interface Registry {
  behavior: FakeBehavior[];
  motion: FakeMotion[];
  audio: FakeAudio[];
  speech: FakeSpeech[];
  textSkin: FakeTextSkin[];
  vfx: FakeVfx[];
  renderer: FakeRenderer[];
  asset: FakeAsset[];
  pool: FakePool[];
  interior: FakeInteriorField[];
}

// --- Shared helpers + per-subsystem instance registry ----------------------

const h = vi.hoisted(() => {
  function makeEmitter<E extends Record<string, unknown>>(): Emitter<E> {
    const map = new Map<keyof E, Set<(payload: unknown) => void>>();
    return {
      on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void {
        let set = map.get(event);
        if (!set) {
          set = new Set<(payload: unknown) => void>();
          map.set(event, set);
        }
        const wrapped = fn as (payload: unknown) => void;
        set.add(wrapped);
        return () => {
          set?.delete(wrapped);
        };
      },
      off<K extends keyof E>(event: K, fn: (payload: E[K]) => void): void {
        map.get(event)?.delete(fn as (payload: unknown) => void);
      },
      emit<K extends keyof E>(event: K, payload: E[K]): void {
        map.get(event)?.forEach((fn) => fn(payload));
      },
    };
  }

  function buildAdapter(mode: SpeechMode): TTSAdapter {
    const emitter = makeEmitter<UtteranceEvents>();
    return {
      mode,
      speak() {
        return { ...emitter, cancel() {} };
      },
      dispose() {},
    };
  }

  const registry: Registry = {
    behavior: [],
    motion: [],
    audio: [],
    speech: [],
    textSkin: [],
    vfx: [],
    renderer: [],
    asset: [],
    pool: [],
    interior: [],
  };

   return { makeEmitter, buildAdapter, registry, demoAdapter: undefined as TTSAdapter | undefined, avatarOverride: undefined as LoadedAvatar | undefined, skinMaterialOverride: null as THREE.Material | null };
});

// --- Mocks for sibling modules ---------------------------------------------

 
vi.mock('../src/behavior', () => ({
  createBehaviorMachine() {
    const emitter = h.makeEmitter<BehaviorMachineEvents>();
    const machine: FakeBehavior = {
      state: 'idle',
      scrollProgress: 0,
      dispatch() {},
      observe() {
        this.observeCount++;
      },
      setScrollProgress() {},
      disposeCount: 0,
      observeCount: 0,
      dispose() {
        this.disposeCount++;
      },
      on: emitter.on,
      off: emitter.off,
      emit: emitter.emit,
    };
    h.registry.behavior.push(machine);
    return machine;
  },
}));

vi.mock('../src/motion', () => ({
  createMotionEngine() {
    const motion: FakeMotion = {
      applyVisemeCount: 0,
      lastFrame: undefined,
      gazeMode: undefined,
      expression: undefined,
      reduced: false,
      clearVisemesCount: 0,
      attach() {},
      motionUpdateCalls: 0,
      update() {
        this.motionUpdateCalls++;
      },
      setExpression(e: Expression) {
        this.expression = e;
      },
      applyVisemeFrame(f: VisemeFrame) {
        this.applyVisemeCount++;
        this.lastFrame = f;
      },
      clearVisemes() {
        this.clearVisemesCount++;
      },
      triggerNod() {},
      setGazeMode(m: GazeMode) {
        this.gazeMode = m;
      },
      setReducedMotion(r: boolean) {
        this.reduced = r;
      },
      setHeadTarget() {},
      setGazeTarget() {},
      clearGazeFollow() {},
      setBlinkHold() {},
      disposeCount: 0,
      dispose() {
        this.disposeCount++;
      },
    };
    h.registry.motion.push(motion);
    return motion;
  },
}));

vi.mock('../src/audio', () => ({
  createAudioEngine() {
    const audio: FakeAudio = {
      context: null,
      suspendCount: 0,
      resumeCount: 0,
      async resumeFromGesture() {
        this.resumeCount++;
      },
      connectElement() {},
      disconnectElement(_el: Element) {},
      readEnergy() {
        return 0;
      },
      suspend() {
        this.suspendCount++;
      },
      disposeCount: 0,
      dispose() {
        this.disposeCount++;
      },
    };
    h.registry.audio.push(audio);
    return audio;
  },
}));

vi.mock('../src/speech/engine', () => ({
  createSpeechEngine() {
    const emitter = h.makeEmitter<{ start: undefined; end: undefined; stall: undefined }>();
    const speech: FakeSpeech = {
      adapter: undefined,
      speaking: false,
      setAdapter(a: TTSAdapter) {
        this.adapter = a;
      },
      async speak() {},
      cancel() {},
      disposeCount: 0,
      dispose() {
        this.disposeCount++;
      },
      on: emitter.on,
      off: emitter.off,
      emit: emitter.emit,
    };
    h.registry.speech.push(speech);
    return speech;
  },
}));

vi.mock('../src/speech/adapters/demo', () => {
  const adapter = h.buildAdapter('demo');
  h.demoAdapter = adapter;
  return {
    createDemoTTSAdapter() {
      return adapter;
    },
  };
});

vi.mock('../src/text-skin', () => ({
  createTextSkinEngine() {
    const skin: FakeTextSkin = {
      texture: new THREE.CanvasTexture(),
      scrollSpeed: 0,
      scrollOffset: 0,
      updateCalls: 0,
      setSource() {},
      reduced: undefined,
      setReducedMotion(r: boolean) {
        this.reduced = r;
      },
      setScrollSpeed() {},
      update() {
        this.updateCalls++;
      },
      disposeCount: 0,
      dispose() {
        this.disposeCount++;
      },
    };
    h.registry.textSkin.push(skin);
    return skin;
  },
}));

vi.mock('../src/shaders', async () => ({
  // The pool and fluid maths are pure and import nothing GPU-shaped, so the
  // fake uses the real functions: a stubbed profile or a stubbed drive would
  // let the engine's waterline and fluidity wiring pass while being wrong. The
  // imports are dynamic because `vi.mock` factories are hoisted above every
  // top-level import in the file, so a static binding is not in scope here.
  ...(await import('../src/shaders/pool')),
  ...(await import('../src/shaders/fluid')),
  createVFXEngine() {
    const vfx: FakeVfx = {
      emergenceValue: 0,
      reduced: false,
      _headConfig: DEFAULT_HEAD_CONFIG,
      get headConfig() {
        return this._headConfig;
      },
      headConfigCalls: [],
      get emergence() {
        return this.emergenceValue;
      },
      rootOffsetY: 0,
      clippingPlane: new THREE.Plane(),
      createSkinMaterial() {
        const front =
          h.skinMaterialOverride ?? ({ isSkin: true, dispose() {} } as unknown as THREE.Material);
        return { front, interior: { isInterior: true, dispose() {} } as unknown as THREE.Material };
      },
      createEyeballMaterial() {
        return { isEyeball: true, dispose() {} } as unknown as THREE.Material;
      },
      setHeadConfig(config: HeadConfigOverrides) {
        this.headConfigCalls.push(config);
        this._headConfig = {
          skin: {
            opacity: { ...this._headConfig.skin.opacity, ...config.skin?.opacity },
            shading: { ...this._headConfig.skin.shading, ...config.skin?.shading },
            glyph: { ...this._headConfig.skin.glyph, ...config.skin?.glyph },
            tone: { ...this._headConfig.skin.tone, ...config.skin?.tone },
            glass: { ...this._headConfig.skin.glass, ...config.skin?.glass },
            backdrop: { ...this._headConfig.skin.backdrop, ...config.skin?.backdrop },
          },
          eyes: { ...this._headConfig.eyes, ...config.eyes },
          pool: { ...this._headConfig.pool, ...config.pool },
          interior: { ...this._headConfig.interior, ...config.interior },
          lens: { ...this._headConfig.lens, ...config.lens },
          fluid: { ...this._headConfig.fluid, ...config.fluid },
        };
      },
      setEmergence(p: number) {
        this.emergenceValue = p;
      },
      setReducedMotion(reduce: boolean) {
        this.reduced = reduce;
      },
      lensBindings: [],
      setLens(binding: LensBinding | null) {
        this.lensBindings.push(binding);
      },
      fluidDrives: [],
      setFluidDrive(
        state: BehaviorState,
        drive: number,
        carrier: readonly [number, number, number],
      ) {
        this.fluidDrives.push({ state, drive, carrier: [carrier[0], carrier[1], carrier[2]] });
      },
      update() {},
      disposeCount: 0,
      dispose() {
        this.disposeCount++;
      },
    };
    h.registry.vfx.push(vfx);
    return vfx;
  },
  buildEyeballMaterial() {
    return { material: { isEyeball: true, dispose() {} } as unknown as THREE.Material };
  },
}));

// The engine loads the pool's GPU half as its own chunk, so the mock has to
// sit on that specifier, not on the `../src/shaders` barrel.
vi.mock('../src/shaders/pool-surface', () => ({
  createPoolSurface(_renderer: unknown, config: HeadPoolConfig) {
    const pool: FakePool = {
      object: new THREE.Group(),
      configs: [config],
      updates: [],
      disposeCount: 0,
      setConfig(next: HeadPoolConfig) {
        this.configs.push(next);
      },
      update(dt, state) {
        this.updates.push({ dt, ...state });
      },
      dispose() {
        this.disposeCount++;
      },
    };
    h.registry.pool.push(pool);
    return pool;
  },
}));

// Same reasoning as the pool: only the field's GPU half is faked, and it sits
// on its own specifier rather than on the `../src/shaders` barrel. The pure
// half stays real, so a wrong gate cannot pass by stubbing the maths out.
vi.mock('../src/shaders/interior-glyph-field', () => ({
  createInteriorGlyphField(options: InteriorGlyphFieldOptions) {
    const field: FakeInteriorField = {
      object: new THREE.Group(),
      options: [options],
      configs: [options.config],
      updates: [],
      disposeCount: 0,
      setConfig(next: HeadInteriorConfig) {
        this.configs.push(next);
      },
      update(dt, state) {
        this.updates.push({
          dt,
          frame: state.frameMatrix.clone(),
          reduced: state.reduced,
          camera: state.camera,
        });
      },
      dispose() {
        this.disposeCount++;
      },
    };
    h.registry.interior.push(field);
    return field;
  },
}));

vi.mock('../src/renderer', () => ({
  createRendererHost() {
    const renderer: FakeRenderer = {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(35, 1, 0.1, 100),
      backend: 'uninitialized',
      gpuRenderer: { tag: 'gpu-renderer' } as unknown,
      setSizeCalls: [],
      async init() {
        this.backend = 'webgpu';
      },
      setSize(width: number, height: number, pixelRatio?: number) {
        this.setSizeCalls.push({ width, height, pixelRatio });
      },
      setClippingPlane() {},
      renderCount: 0,
      render() {
        this.renderCount++;
      },
      disposeCount: 0,
      dispose() {
        this.disposeCount++;
      },
    };
    h.registry.renderer.push(renderer);
    return renderer;
  },
}));

vi.mock('../src/asset', () => ({
  createAssetLoader() {
    const asset: FakeAsset = {
      loadCalls: 0,
      loadUrls: [],
      attachRendererCalls: [],
      async load(url: string) {
        this.loadCalls++;
        this.loadUrls.push(url);
        // Failure injection for delivery tests: fail: URLs reject.
        if (url.startsWith('fail:')) throw new Error('injected load failure');
         if (h.avatarOverride) return h.avatarOverride;
         // Default lightweight avatar: no morph meshes, unnamed material.
         return {
           root: new THREE.Group(),
           morphMeshes: [],
           bones: {},
           animations: [],
           setMorph() {},
           getMorph() {
             return 0;
           },
           dispose() {},
         };
      },
      disposeCount: 0,
      dispose() {
        this.disposeCount++;
      },
      attachRenderer(r: unknown) {
        this.attachRendererCalls.push(r);
      },
    };
    h.registry.asset.push(asset);
    return asset;
  },
}));

// --- requestAnimationFrame + matchMedia control ----------------------------

let rafCb: ((time: number) => void) | null = null;
let visibilityHidden = false;
let mqlListeners: Array<(e: MediaQueryListEvent) => void> = [];

function stubMatchMedia(): void {
  mqlListeners = [];
  vi.stubGlobal('matchMedia', (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener(_type: string, cb: (e: MediaQueryListEvent) => void) {
        mqlListeners.push(cb);
      },
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList,
  );
}

beforeEach(() => {
  rafCb = null;
  visibilityHidden = false;
  vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => {
    rafCb = fn;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafCb = null;
  });
  stubMatchMedia();
});

 afterEach(() => {
   vi.unstubAllGlobals();
   h.avatarOverride = undefined;
   h.skinMaterialOverride = null;
 });

// --- Tests -----------------------------------------------------------------

 describe('engine state wiring', () => {
   it('emits statechange on behaviour transition', () => {
     const engine = createEngine();
     const behavior = h.registry.behavior.at(-1)!;
     const transitions: Array<{ from: string; to: string }> = [];
     engine.on('statechange', (s) => transitions.push(s));
     behavior.emit('transition', {
       from: 'hidden',
       to: 'emerging',
       event: { type: 'enter-viewport' },
     });
     expect(transitions).toEqual([{ from: 'hidden', to: 'emerging' }]);
     engine.dispose();
   });

  it('maps listening/speaking/thinking to motion gaze and expression', () => {
    const engine = createEngine();
    const behavior = h.registry.behavior.at(-1)!;
    const motion = h.registry.motion.at(-1)!;
    const go = (to: string) =>
      behavior.emit('transition', { from: 'idle', to: to as never, event: { type: 'speech-start' } });

    go('listening');
    expect(motion.gazeMode).toBe('contact');
    expect(motion.expression).toBe('listening');

    go('speaking');
    expect(motion.gazeMode).toBe('aversion');
    expect(motion.expression).toBe('speaking');

    go('thinking');
    expect(motion.expression).toBe('thinking');
    engine.dispose();
  });

  it('emits speechstart / speechend from speech engine events', () => {
    const engine = createEngine();
    const speech = h.registry.speech.at(-1)!;
    let starts = 0;
    let ends = 0;
    engine.on('speechstart', () => starts++);
    engine.on('speechend', () => ends++);

    speech.emit('start', undefined);
    speech.emit('end', undefined);

    expect(starts).toBe(1);
    expect(ends).toBe(1);
    engine.dispose();
  });

  it('routes behaviour speech events through dispatch', () => {
    const engine = createEngine();
    const speech = h.registry.speech.at(-1)!;
    const behavior = h.registry.behavior.at(-1)!;
    const dispatched: string[] = [];
    const originalDispatch = behavior.dispatch;
    behavior.dispatch = (e) => dispatched.push(e.type);
    speech.emit('start', undefined);
    speech.emit('stall', undefined);
    speech.emit('end', undefined);
    behavior.dispatch = originalDispatch;
    expect(dispatched).toEqual(['speech-start', 'speech-stall', 'speech-end']);
    engine.dispose();
  });
});

describe('engine lifecycle', () => {
  it('disposes every subsystem exactly once (idempotent)', () => {
    const engine = createEngine();
    engine.dispose();
    engine.dispose();
    expect(h.registry.behavior.at(-1)?.disposeCount).toBe(1);
    expect(h.registry.motion.at(-1)?.disposeCount).toBe(1);
    expect(h.registry.speech.at(-1)?.disposeCount).toBe(1);
    expect(h.registry.textSkin.at(-1)?.disposeCount).toBe(1);
    expect(h.registry.vfx.at(-1)?.disposeCount).toBe(1);
    expect(h.registry.renderer.at(-1)?.disposeCount).toBe(1);
    expect(h.registry.audio.at(-1)?.disposeCount).toBe(1);
    expect(h.registry.asset.at(-1)?.disposeCount).toBe(1);
  });

  it('pauses the render loop when the tab is hidden and resumes on visible', () => {
    const engine = createEngine();
    const renderer = h.registry.renderer.at(-1)!;
    const audio = h.registry.audio.at(-1)!;
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visibilityHidden ? 'hidden' : 'visible'),
    });

    return engine.mount(canvas, host).then(() => {
      expect(renderer.renderCount).toBe(0);
      rafCb?.(16);
      expect(renderer.renderCount).toBe(1);

      visibilityHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      rafCb?.(32);
      expect(renderer.renderCount).toBe(1);
      expect(audio.suspendCount).toBe(1);

      visibilityHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      rafCb?.(48);
      expect(renderer.renderCount).toBe(2);

      engine.dispose();
    });
  });

  it('setMotionFrozen halts motion updates while rendering continues, and resumes on unfreeze', () => {
    const engine = createEngine();
    const renderer = h.registry.renderer.at(-1)!;
    const motion = h.registry.motion.at(-1)!;
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');

    return engine.mount(canvas, host).then(() => {
      rafCb?.(16);
      rafCb?.(32);
      const before = motion.motionUpdateCalls;
      expect(before).toBeGreaterThan(0);

      // Frozen: motion is skipped entirely (idle and gaze phase off wall
      // clock, so dt=0 would still breathe between frames) but frames render.
      engine.setMotionFrozen(true);
      const rendersBefore = renderer.renderCount;
      rafCb?.(48);
      rafCb?.(64);
      expect(motion.motionUpdateCalls).toBe(before);
      expect(renderer.renderCount).toBe(rendersBefore + 2);

      engine.setMotionFrozen(false);
      rafCb?.(80);
      expect(motion.motionUpdateCalls).toBe(before + 1);

      engine.dispose();
    });
  });
});

describe('visemeTap', () => {
  it('forwards viseme frames and coarsens energy into jaw-open', () => {
    const adapter = h.buildAdapter('fallback');
    const audio = h.registry.audio.at(-1)!;

    let appliedFrames = 0;
    let lastEnergyWeights: Record<string, number> | null = null;
    const tapped = visemeTap(
      adapter,
      () => {
        appliedFrames++;
      },
      (energy) => {
        lastEnergyWeights = { jaw_open: energy };
      },
    );

    const handle = tapped.speak('hello', audio);
    const frame: VisemeFrame = { time: 0.25, weights: { viseme_aa: 1 } };
    handle.emit('viseme', frame);
    handle.emit('energy', 0.7);

    expect(appliedFrames).toBe(1);
    expect(lastEnergyWeights).toEqual({ jaw_open: 0.7 });
    expect(tapped.mode).toBe('fallback');
  });
});

// --- Regression tests for the adversarial-review fixes ---------------------

describe('mount / dispose race', () => {
  it('serialises overlapping mounts, disposes superseded avatar state, and observes once', async () => {
    const engine = createEngine({ avatarUrl: 'fake.glb' });
    const asset = h.registry.asset.at(-1)!;
    const behavior = h.registry.behavior.at(-1)!;
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    let firstDisposed = 0;
    let secondDisposed = 0;
    let resolveFirst!: (a: LoadedAvatar) => void;
    const firstLoad = new Promise<LoadedAvatar>((resolve) => {
      resolveFirst = resolve;
    });

    const firstAvatar: LoadedAvatar = {
      root: new THREE.Group(),
      morphMeshes: [],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {
        firstDisposed += 1;
      },
    };

    const secondAvatar: LoadedAvatar = {
      root: new THREE.Group(),
      morphMeshes: [],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {
        secondDisposed += 1;
      },
    };

    let call = 0;
    const originalLoad = asset.load;
    asset.load = async () => {
      call += 1;
      asset.loadCalls += 1;
      if (call === 1) return firstLoad;
      if (call === 2) return secondAvatar;
      return originalLoad('fake.glb');
    };
    asset.loadCalls = 0;

    const mountOne = engine.mount(canvas, host);
    while (asset.loadCalls < 1) {
      await Promise.resolve();
    }
    const mountTwo = engine.mount(canvas, host);
    resolveFirst(firstAvatar);
    await Promise.all([mountOne, mountTwo]);

    expect(firstDisposed).toBe(1);
    expect(behavior.observeCount).toBe(1);
    expect(firstAvatar.root.parent).toBeNull();
    expect(secondAvatar.root.parent).not.toBeNull();
    expect(secondDisposed).toBe(0);
    expect(asset.loadCalls).toBe(2);

    engine.dispose();
  });
  it('leaves no loop or listeners when disposed during renderer init', async () => {
    const engine = createEngine();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const p = engine.mount(document.createElement('canvas'), document.createElement('div'));
    engine.dispose();
    await p;
    // Loop never scheduled and the visibilitychange listener was never added.
    expect(rafCb).toBeNull();
    expect(addSpy).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    addSpy.mockRestore();
  });
  it('disposes a late-loading avatar when disposed mid asset load', async () => {
    const engine = createEngine({ avatarUrl: 'fake.glb' });
    const asset = h.registry.asset.at(-1)!;
    let resolveLoad!: (a: LoadedAvatar) => void;
    const loadPromise = new Promise<LoadedAvatar>((res) => {
      resolveLoad = res;
    });
    let avatarDisposed = false;
    const fakeAvatar: LoadedAvatar = {
      root: new THREE.Group(),
      morphMeshes: [],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {
        avatarDisposed = true;
      },
    };
    let call = 0;
    const originalLoad = asset.load;
    asset.load = async () => {
      call += 1;
      if (call === 1) {
        asset.loadCalls += 1;
        return loadPromise;
      }
      return originalLoad('fallback.glb');
    };

    const p = engine.mount(document.createElement('canvas'), document.createElement('div'));
    while (asset.loadCalls < 1) {
      await Promise.resolve();
    }
    engine.dispose();
    resolveLoad(fakeAvatar);
    await p;

    expect(avatarDisposed).toBe(true);
    expect(rafCb).toBeNull();
  });
});


describe('speech end clears visemes', () => {
  it('clears residual visemes before emitting speechend', () => {
    const engine = createEngine();
    const motion = h.registry.motion.at(-1)!;
    const speech = h.registry.speech.at(-1)!;
    speech.emit('end', undefined);
    expect(motion.clearVisemesCount).toBe(1);
    engine.dispose();
  });
});

describe('engine resize', () => {
  it('forwards resize requests to the renderer host', () => {
    const engine = createEngine();
    const renderer = h.registry.renderer.at(-1)!;
    engine.resize(800, 450);
    expect(renderer.setSizeCalls).toEqual([{ width: 800, height: 450, pixelRatio: undefined }]);
    engine.dispose();
  });
});

describe('placeholder avatar feature attributes', () => {
  it('provides every attribute required by the skin material', () => {
    const avatar = createPlaceholderAvatar();
    const geometry = avatar.morphMeshes[0]?.geometry;

    expect(geometry).toBeDefined();
    for (const name of ['aLips', 'aJaw', 'aEyelid', 'aBrow', 'aCavity', 'aNose', 'aSocket']) {
      expect(geometry?.getAttribute(name), name).toBeDefined();
    }
    avatar.dispose();
  });
});

describe('head configuration wiring', () => {
  it('applies constructor overrides and exposes live VFX updates', () => {
    const initial: HeadConfigOverrides = { eyes: { pupil: 0.42 } };
    const live: HeadConfigOverrides = { skin: { glyph: { scale: 0.8 } } };
    const engine = createEngine({ headConfig: initial });
    const vfx = h.registry.vfx.at(-1)!;

    engine.vfx.setHeadConfig(live);

    expect(vfx.headConfigCalls).toEqual([initial, live]);
    expect(vfx.headConfig.eyes.pupil).toBe(0.42);
    expect(vfx.headConfig.skin.glyph.scale).toBe(0.8);
    engine.dispose();
  });
});

describe('voice adapter re-wrap ownership', () => {
  it('does not dispose the same caller adapter when set twice', () => {
    const engine = createEngine();
    const adapter = h.buildAdapter('provider');
    const disposeSpy = vi.spyOn(adapter, 'dispose');
    engine.setVoiceAdapter(adapter);
    engine.setVoiceAdapter(adapter);
    expect(disposeSpy).not.toHaveBeenCalled();
    engine.dispose();
  });
});

describe('host-offscreen loop suspension', () => {
  it('stops the loop on hidden state and restarts on emerging', async () => {
    const engine = createEngine();
    const behavior = h.registry.behavior.at(-1)!;
    const audio = h.registry.audio.at(-1)!;
    await engine.mount(document.createElement('canvas'), document.createElement('div'));

    // Loop is running after mount (tab visible, behaviour not hidden).
    expect(rafCb).not.toBeNull();

    // Behaviour transitions to hidden -> loop must stop and audio suspend.
    behavior.state = 'hidden';
    behavior.emit('transition', { from: 'idle', to: 'hidden', event: { type: 'submerge-complete' } });
    expect(rafCb).toBeNull();
    expect(audio.suspendCount).toBe(1);

    // hidden -> emerging must restart the loop (emergence completion is
    // dispatched from the frame loop).
    behavior.state = 'emerging';
    behavior.emit('transition', { from: 'hidden', to: 'emerging', event: { type: 'enter-viewport' } });
    expect(rafCb).not.toBeNull();

    engine.dispose();
  });
});

describe('reduced motion propagation', () => {
  it('threads reduced motion into VFX and the text skin on mount', async () => {
    const engine = createEngine({ reducedMotion: true });
    const motion = h.registry.motion.at(-1)!;
    const vfx = h.registry.vfx.at(-1)!;
    const skin = h.registry.textSkin.at(-1)!;
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    expect(motion.reduced).toBe(true);
    expect(vfx.reduced).toBe(true);
    expect(skin.reduced).toBe(true);
    engine.dispose();
  });

  it('routes a media-query change into VFX and the text skin as well as motion', async () => {
    const engine = createEngine();
    const motion = h.registry.motion.at(-1)!;
    const vfx = h.registry.vfx.at(-1)!;
    const skin = h.registry.textSkin.at(-1)!;
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    mqlListeners.forEach((fn) => fn({ matches: true } as MediaQueryListEvent));
    expect(motion.reduced).toBe(true);
    expect(vfx.reduced).toBe(true);
    expect(skin.reduced).toBe(true);
    engine.dispose();
  });
});

describe('renderer handle wired to asset loader', () => {
  it('attaches the gpu renderer to the asset loader before load', async () => {
    const engine = createEngine({ avatarUrl: 'fake.glb' });
    const renderer = h.registry.renderer.at(-1)!;
    const asset = h.registry.asset.at(-1)!;
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    expect(asset.attachRendererCalls.length).toBe(1);
    expect(asset.attachRendererCalls[0]).toBe(renderer.gpuRenderer);
    engine.dispose();
  });
});

describe('avatar delivery (dec.default-asset-delivery)', () => {
  it('loads the packaged bust by default when no avatarUrl is given', async () => {
    const engine = createEngine();
    const asset = h.registry.asset.at(-1)!;
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    expect(asset.loadCalls).toBe(1);
    expect(asset.loadUrls[0]).toMatch(/assets\/hologlyph-bust\.glb$/);
    engine.dispose();
  });

  it('an empty avatarUrl explicitly requests the placeholder (no load attempt)', async () => {
    const engine = createEngine({ avatarUrl: '' });
    const asset = h.registry.asset.at(-1)!;
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    expect(asset.loadCalls).toBe(0);
    engine.dispose();
  });

  it('degrades to the placeholder and still becomes ready when the load fails', async () => {
    const engine = createEngine({ avatarUrl: 'fail://broken.glb' });
    const asset = h.registry.asset.at(-1)!;
    let ready = false;
    engine.on('ready', () => {
      ready = true;
    });
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    expect(asset.loadCalls).toBe(1);
    expect(ready).toBe(true);
    engine.dispose();
  });
});
 
 describe('text-skin material application (mouth interior)', () => {
   it('keeps mouth material but skins teeth, ordinary, and unnamed meshes', async () => {
     const keepMaterials = { isKept: true } as unknown as THREE.Material;
     const teethMaterials = { isTeeth: true } as unknown as THREE.Material;
     const skinnedMaterial = { isSkin: false } as unknown as THREE.Material;
     const unnamedMaterial = { isUnnamed: true } as unknown as THREE.Material;
     const keptMesh = new THREE.Mesh(new THREE.BufferGeometry(), keepMaterials);
     const teethMesh = new THREE.Mesh(new THREE.BufferGeometry(), teethMaterials);
     const ordinaryMesh = new THREE.Mesh(new THREE.BufferGeometry(), skinnedMaterial);
     const unnamedMesh = new THREE.Mesh(new THREE.BufferGeometry(), unnamedMaterial);
     const skinMeshMaterial = { name: 'skin', dispose() {} } as unknown as THREE.Material;
     h.skinMaterialOverride = skinMeshMaterial;
 
     h.avatarOverride = {
       root: new THREE.Group(),
       morphMeshes: [keptMesh, teethMesh, ordinaryMesh, unnamedMesh],
       bones: {},
       animations: [],
       setMorph() {},
       getMorph() {
         return 0;
       },
       dispose() {},
     };
     (keptMesh.material as THREE.Material).name = 'mouth_interior';
     (teethMesh.material as THREE.Material).name = 'teeth';
     (ordinaryMesh.material as THREE.Material).name = 'bust';
 
     const engine = createEngine({ avatarUrl: 'fake.glb' });
     await engine.mount(document.createElement('canvas'), document.createElement('div'));
 
     expect(keptMesh.material).toBe(keepMaterials);
     expect((keptMesh.material as THREE.Material).name).toBe('mouth_interior');
     expect(teethMesh.material).toBe(skinMeshMaterial);
     expect(ordinaryMesh.material).toBe(skinMeshMaterial);
     expect(unnamedMesh.material).toBe(skinMeshMaterial);
     engine.dispose();
   });
 });
describe('displaced materials', () => {
  it('disposes displaced authored materials and their textures once on teardown', async () => {
    const texture = { isTexture: true, dispose: vi.fn() } as unknown as THREE.Texture;
    const sharedMaterialDispose = vi.fn();
    const sharedMaterial = {
      name: 'bust',
      map: texture,
      dispose: sharedMaterialDispose,
    } as unknown as THREE.Material;
    const sharedMesh = new THREE.Mesh(new THREE.BufferGeometry(), sharedMaterial);
    const arrayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      [sharedMaterial] as unknown as THREE.Material | THREE.Material[],
    );
    const skinMaterial = { name: 'skin', dispose: vi.fn() } as unknown as THREE.Material;
    h.skinMaterialOverride = skinMaterial;

    const sharedGroup = new THREE.Group();
    sharedGroup.add(sharedMesh, arrayMesh);
    h.avatarOverride = {
      root: sharedGroup,
      morphMeshes: [sharedMesh, arrayMesh],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };

    const engine = createEngine({ avatarUrl: 'fake.glb' });
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    engine.dispose();

    expect(sharedMaterialDispose).toHaveBeenCalledTimes(1);
    expect(texture.dispose).toHaveBeenCalledTimes(1);
  });
});
describe('glass body draw order', () => {
  /** A bust-shaped rig: skin plus the two authored internals and the eyes. */
  function makeLayeredAvatar(): {
    group: THREE.Group;
    skin: THREE.Mesh;
    eye: THREE.Mesh;
    mouth: THREE.Mesh;
    trim: THREE.Mesh;
  } {
    const skin = new THREE.Mesh(new THREE.BufferGeometry(), { name: 'bust' } as THREE.Material);
    skin.morphTargetDictionary = { jaw_open: 0, exp_blink: 1 };
    skin.morphTargetInfluences = [0, 0];
    const eye = new THREE.Mesh(new THREE.BufferGeometry(), { name: 'eye_sclera' } as THREE.Material);
    const mouth = new THREE.Mesh(new THREE.BufferGeometry(), {
      name: 'mouth_interior',
      transparent: false,
      blending: THREE.NormalBlending,
    } as THREE.Material);
    mouth.morphTargetDictionary = { jaw_open: 0 };
    mouth.morphTargetInfluences = [0];
    const trim = new THREE.Mesh(new THREE.BufferGeometry(), {
      name: 'eye_trim',
      transparent: false,
      blending: THREE.NormalBlending,
    } as THREE.Material);
    const group = new THREE.Group();
    group.add(skin, eye, mouth, trim);
    return { group, skin, eye, mouth, trim };
  }

  it('layers interior, mask, internals and skin in one transparent pass', async () => {
    const { group, skin, eye, mouth, trim } = makeLayeredAvatar();
    h.avatarOverride = {
      root: group,
      morphMeshes: [skin, mouth],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };

    const engine = createEngine({ avatarUrl: 'fake.glb' });
    await engine.mount(document.createElement('canvas'), document.createElement('div'));

    const authored = new Set<THREE.Object3D>([skin, eye, mouth, trim]);
    const overlays = group.children.filter((child) => !authored.has(child)) as THREE.Mesh[];
    expect(overlays).toHaveLength(2);

    const mask = overlays.find((mesh) => mesh.renderOrder === 0);
    const interior = overlays.find((mesh) => mesh.renderOrder === -1);
    expect(mask, 'occlusion depth mask at renderOrder 0').toBeDefined();
    expect(interior, 'interior wall at renderOrder -1').toBeDefined();

    const maskMat = mask?.material as THREE.MeshBasicMaterial;
    expect(maskMat.colorWrite).toBe(false);
    expect(maskMat.depthWrite).toBe(true);
    expect(maskMat.depthTest).toBe(true);
    // Three renders the whole opaque list before the transparent one, so the
    // mask has to be transparent for renderOrder to place it after the
    // interior wall.
    expect(maskMat.transparent).toBe(true);

    // Same reason for the authored internals. They were opaque, so they keep
    // NoBlending and still draw as a straight write: only the layer moves.
    for (const internal of [mouth, trim]) {
      const mat = internal.material as THREE.Material;
      expect(mat.transparent, `${mat.name} transparent`).toBe(true);
      expect(mat.blending, `${mat.name} blending`).toBe(THREE.NoBlending);
      expect(mat.depthWrite, `${mat.name} depthWrite`).toBe(true);
      expect(internal.renderOrder, `${mat.name} renderOrder`).toBe(1);
    }
    expect(eye.renderOrder).toBe(1);
    expect(skin.renderOrder).toBe(2);

    // Both overlays ride the skin mesh's morph influences, so the far wall and
    // the depth mask open with the jaw and close with a blink.
    expect(interior?.morphTargetInfluences).toBe(skin.morphTargetInfluences);
    expect(mask?.morphTargetInfluences).toBe(skin.morphTargetInfluences);
    expect(interior?.morphTargetInfluences).not.toBe(mouth.morphTargetInfluences);

    engine.dispose();
    expect(group.children).not.toContain(mask);
    expect(group.children).not.toContain(interior);
  });

  it('clones the overlays off a glass-dressed mesh, not just the first morph mesh', async () => {
    // `morphMeshes[0]` is the mouth cavity here. It keeps its authored
    // material, so cloning the interior wall from it would show the inside of
    // the mouth instead of the far side of the head.
    const { group, skin, eye, mouth, trim } = makeLayeredAvatar();
    h.avatarOverride = {
      root: group,
      morphMeshes: [mouth, skin],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };

    const engine = createEngine({ avatarUrl: 'fake.glb' });
    await engine.mount(document.createElement('canvas'), document.createElement('div'));

    const authored = new Set<THREE.Object3D>([skin, eye, mouth, trim]);
    const overlays = group.children.filter((child) => !authored.has(child)) as THREE.Mesh[];
    const interior = overlays.find((mesh) => mesh.renderOrder === -1);
    expect(interior).toBeDefined();
    expect(interior?.geometry).toBe(skin.geometry);
    expect(interior?.geometry).not.toBe(mouth.geometry);

    engine.dispose();
  });

  it('leaves the pre-glass draw order intact at glass.amount 0', async () => {
    const { group, skin, eye, mouth, trim } = makeLayeredAvatar();
    h.avatarOverride = {
      root: group,
      morphMeshes: [skin, mouth],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };

    const engine = createEngine({ avatarUrl: 'fake.glb' });
    await engine.mount(document.createElement('canvas'), document.createElement('div'));

    const authored = new Set<THREE.Object3D>([skin, eye, mouth, trim]);
    const overlays = group.children.filter((child) => !authored.has(child)) as THREE.Mesh[];
    const mask = overlays.find((mesh) => mesh.renderOrder === 0);
    const interior = overlays.find((mesh) => mesh.renderOrder === -1);
    const maskMat = mask?.material as THREE.Material;
    const mouthMat = mouth.material as THREE.Material;

    // Moving the mask and the internals into the transparent list is itself
    // visible: with the jaw open it shifts the mouth cavity by about 15 luma.
    // So it must unwind when the glass has nothing to show.
    engine.vfx.setHeadConfig({ skin: { glass: { amount: 0 } } });
    rafCb?.(16);
    expect(interior?.visible).toBe(false);
    expect(maskMat.transparent).toBe(false);
    expect(mouthMat.transparent).toBe(false);
    // Depth behaviour is unchanged either way; only the render list moves.
    expect(maskMat.depthWrite).toBe(true);
    expect(mouthMat.depthWrite).toBe(true);

    engine.vfx.setHeadConfig({ skin: { glass: { amount: 1 } } });
    rafCb?.(32);
    expect(interior?.visible).toBe(true);
    expect(maskMat.transparent).toBe(true);
    expect(mouthMat.transparent).toBe(true);

    engine.dispose();
  });
});

describe('tier 1 pool lifecycle (dec.liquid-glass-architecture, item 3)', () => {
  // The shared registry is never cleared between suites, so a stale entry
  // from a neighbouring test would satisfy `at(-1)` before this engine has
  // built anything.
  beforeEach(() => {
    h.registry.pool.length = 0;
  });

  /** A bust-shaped body whose radius pinches at the neck. */
  function makeBustAvatar(): { group: THREE.Group; body: THREE.Mesh } {
    const positions: number[] = [];
    const ring = (radius: number, y: number) => {
      for (let s = 0; s < 16; s++) {
        const a = (s / 16) * Math.PI * 2;
        positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      }
    };
    for (let i = 0; i <= 8; i++) ring(0.6, (i / 8) * 0.6);
    for (let i = 0; i <= 4; i++) ring(0.15, 0.6 + (i / 4) * 0.4);
    for (let i = 0; i <= 8; i++) ring(0.5, 1.0 + (i / 8) * 0.8);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const body = new THREE.Mesh(geometry, { name: 'bust' } as THREE.Material);
    body.morphTargetDictionary = { jaw_open: 0 };
    body.morphTargetInfluences = [0];
    const group = new THREE.Group();
    group.add(body);
    return { group, body };
  }

  async function mountBust(): Promise<{ engine: ReturnType<typeof createEngine> }> {
    const { group, body } = makeBustAvatar();
    h.avatarOverride = {
      root: group,
      morphMeshes: [body],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };
    const engine = createEngine({ avatarUrl: 'fake.glb' });
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    return { engine };
  }

  /** Turn the pool on and run the frame that reconciles it into the scene. */
  function enablePool(engine: ReturnType<typeof createEngine>, time = 16): FakePool {
    engine.vfx.setHeadConfig({ pool: { amount: 1 } });
    rafCb?.(time);
    const pool = h.registry.pool.at(-1);
    if (!pool) throw new Error('pool was not built');
    return pool;
  }

  it('builds nothing at amount 0 and tears the pool back down when it returns', async () => {
    const { engine } = await mountBust();
    const scene = h.registry.renderer.at(-1)!.scene;

    rafCb?.(16);
    rafCb?.(32);
    expect(h.registry.pool).toHaveLength(0);

    const pool = enablePool(engine, 48);
    expect(scene.children).toContain(pool.object);

    engine.vfx.setHeadConfig({ pool: { amount: 0 } });
    rafCb?.(64);
    expect(pool.disposeCount).toBe(1);
    expect(scene.children).not.toContain(pool.object);
    // Torn down, not hidden: the shipped configuration must not hold a pair of
    // render targets alive for a surface nobody can see.
    expect(h.registry.pool).toHaveLength(1);

    engine.dispose();
  });

  it('builds the pool once and pushes config only when it changes', async () => {
    const { engine } = await mountBust();
    const pool = enablePool(engine);
    const pushes = pool.configs.length;
    for (let i = 0; i < 20; i++) rafCb?.(2000 + 16 * i);
    expect(h.registry.pool).toHaveLength(1);
    // The reconciler runs every frame; re-pushing an unchanged config would
    // reparse the tint hex sixty times a second for nothing.
    expect(pool.configs.length).toBe(pushes);

    engine.vfx.setHeadConfig({ pool: { tint: '#123456' } });
    rafCb?.(3000);
    expect(pool.configs.length).toBe(pushes + 1);
    expect(pool.configs.at(-1)?.tint).toBe('#123456');

    engine.dispose();
  });

  it('feeds the waterline radius from the rig, not from a constant', async () => {
    const { engine } = await mountBust();
    const vfx = h.registry.vfx.at(-1)!;
    const pool = enablePool(engine);

    // Settled: the base sits on the plane, so the widest part is in the water.
    vfx.rootOffsetY = 0;
    rafCb?.(4000);
    expect(pool.updates.at(-1)!.waterlineRadius).toBeGreaterThan(0.5);

    // Mid-emergence: the neck is on the plane, so the hole pinches.
    vfx.rootOffsetY = -0.8;
    rafCb?.(4016);
    expect(pool.updates.at(-1)!.waterlineRadius).toBeLessThan(0.3);

    engine.dispose();
  });

  it('drives ripples from scroll travel and consumes it once', async () => {
    const { engine } = await mountBust();
    const pool = enablePool(engine);

    // Several calls between frames accumulate as distance covered, not as the
    // last hop, so a host that streams scroll events is not under-reported.
    engine.setScrollProgress(0.2);
    engine.setScrollProgress(0.5);
    rafCb?.(4000);
    expect(pool.updates.at(-1)!.drive).toBeGreaterThan(0);

    // Travel is consumed by the frame that used it.
    rafCb?.(4016);
    expect(pool.updates.at(-1)!.drive).toBe(0);

    engine.dispose();
  });

  it('drops a non-finite scroll progress instead of poisoning the field', async () => {
    const { engine } = await mountBust();
    const pool = enablePool(engine);

    // `clamp01(NaN)` is NaN, and one NaN texel spreads across the whole height
    // field within a second and never decays.
    engine.setScrollProgress(Number.NaN);
    engine.setScrollProgress(Number.POSITIVE_INFINITY);
    rafCb?.(4000);
    expect(Number.isFinite(pool.updates.at(-1)!.drive)).toBe(true);
    expect(pool.updates.at(-1)!.drive).toBe(0);

    engine.dispose();
  });

  it('feeds the fluid solver only once the gate is open', async () => {
    const { engine } = await mountBust();
    const vfx = h.registry.vfx.at(-1)!;

    // Shipped configuration: no matrix recomposed, no bone read, no call.
    rafCb?.(4000);
    rafCb?.(4016);
    expect(vfx.fluidDrives).toHaveLength(0);

    vfx.setHeadConfig({ fluid: { amount: 1 } });
    engine.setScrollProgress(0.6);
    rafCb?.(4032);
    const first = vfx.fluidDrives.at(-1);
    expect(first).toBeDefined();
    expect(first!.drive).toBeGreaterThan(0);
    // The behaviour state picks the melt gain, so it has to be the live one.
    expect(first!.state).toBe(engine.behavior.state);
    // First carrier sample has no previous pose to difference against.
    expect(first!.carrier).toEqual([0, 0, 0]);

    // Travel is consumed by the frame that used it, exactly as the pool's is.
    rafCb?.(4048);
    expect(vfx.fluidDrives.at(-1)!.drive).toBe(0);

    engine.dispose();
  });

  it('keeps the carrier velocity finite once the head is moving', async () => {
    const { engine } = await mountBust();
    const vfx = h.registry.vfx.at(-1)!;
    vfx.setHeadConfig({ fluid: { amount: 1 } });

    // The solver reads its own last offset, so one non-finite carrier reading
    // would poison the flow vector permanently rather than for a frame.
    for (let i = 0; i < 6; i++) rafCb?.(4000 + i * 16);
    expect(vfx.fluidDrives.length).toBeGreaterThan(1);
    for (const sample of vfx.fluidDrives) {
      expect(Number.isFinite(sample.drive)).toBe(true);
      for (const v of sample.carrier) expect(Number.isFinite(v)).toBe(true);
    }

    engine.dispose();
  });

  it('disposes the pool with the engine', async () => {
    const { engine } = await mountBust();
    const pool = enablePool(engine);
    const scene = h.registry.renderer.at(-1)!.scene;

    engine.dispose();
    expect(pool.disposeCount).toBe(1);
    expect(scene.children).not.toContain(pool.object);
  });
});

describe('interior glyph field lifecycle (dec.liquid-glass-architecture, item 10)', () => {
  beforeEach(() => {
    h.registry.interior.length = 0;
  });

  /** A body with a baked thickness attribute and a head bone that carries it. */
  function makeBustAvatar(): { group: THREE.Group; body: THREE.SkinnedMesh; head: THREE.Bone } {
    const positions: number[] = [];
    for (let i = 0; i <= 6; i++) {
      for (let s = 0; s < 12; s++) {
        const a = (s / 12) * Math.PI * 2;
        positions.push(Math.cos(a) * 0.4, (i / 6) * 1.2, Math.sin(a) * 0.4);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const vertices = positions.length / 3;
    geometry.setAttribute(
      'aThickness',
      new THREE.Float32BufferAttribute(new Float32Array(vertices).fill(0.5), 1),
    );

    const root = new THREE.Bone();
    root.name = 'root';
    const head = new THREE.Bone();
    head.name = 'head';
    root.add(head);
    const skeleton = new THREE.Skeleton([root, head]);

    const body = new THREE.SkinnedMesh(geometry, { name: 'bust' } as THREE.Material);
    body.morphTargetDictionary = { jaw_open: 0 };
    body.morphTargetInfluences = [0];
    const group = new THREE.Group();
    group.add(root);
    group.add(body);
    body.bind(skeleton);
    return { group, body, head };
  }

  async function mountBust(): Promise<{
    engine: ReturnType<typeof createEngine>;
    head: THREE.Bone;
    group: THREE.Group;
  }> {
    const { group, body, head } = makeBustAvatar();
    h.avatarOverride = {
      root: group,
      morphMeshes: [body],
      bones: { head },
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };
    const engine = createEngine({ avatarUrl: 'fake.glb' });
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    return { engine, head, group };
  }

  function enableField(engine: ReturnType<typeof createEngine>, time = 16): FakeInteriorField {
    engine.vfx.setHeadConfig({ interior: { count: 120 } });
    rafCb?.(time);
    const field = h.registry.interior.at(-1);
    if (!field) throw new Error('the interior field was not built');
    return field;
  }

  it('builds nothing at count 0 and tears the field back down when it returns', async () => {
    const { engine } = await mountBust();
    const scene = h.registry.renderer.at(-1)!.scene;

    rafCb?.(16);
    rafCb?.(32);
    expect(h.registry.interior).toHaveLength(0);

    const field = enableField(engine, 48);
    expect(scene.children).toContain(field.object);

    engine.vfx.setHeadConfig({ interior: { count: 0 } });
    rafCb?.(64);
    expect(field.disposeCount).toBe(1);
    expect(scene.children).not.toContain(field.object);
    // Torn down, not hidden: the shipped configuration must not hold a
    // vertex buffer alive for a field nobody can see.
    expect(h.registry.interior).toHaveLength(1);

    engine.dispose();
  });

  it('builds the field once and pushes config only when it changes', async () => {
    const { engine } = await mountBust();
    const field = enableField(engine);
    const pushes = field.configs.length;
    for (let i = 0; i < 20; i++) rafCb?.(2000 + 16 * i);
    expect(h.registry.interior).toHaveLength(1);
    expect(field.configs.length).toBe(pushes);

    // A count change rides `setConfig`, so the sites are never resampled and
    // a glyph keeps its identity across the whole travel of the slider.
    engine.vfx.setHeadConfig({ interior: { count: 200 } });
    rafCb?.(3000);
    expect(h.registry.interior).toHaveLength(1);
    expect(field.configs.length).toBe(pushes + 1);
    expect(field.configs.at(-1)?.count).toBe(200);

    engine.dispose();
  });

  it('samples the rig it was given, thickness and all', async () => {
    const { engine } = await mountBust();
    const field = enableField(engine);
    const options = field.options[0]!;
    expect(options.positions.length).toBe(7 * 12 * 3);
    expect(options.thickness).not.toBeNull();
    expect(options.thickness?.length).toBe(7 * 12);
    // The canvas the SURFACE samples, not a second texture upload. The engine
    // builds the body skin first and the eye skin last, so the body's is the
    // second-newest entry in the registry.
    expect(options.texture).toBe(h.registry.textSkin.at(-2)?.texture);

    engine.dispose();
  });

  it('carries the field on the head bone, so a head turn moves the targets', async () => {
    const { engine, head } = await mountBust();
    const field = enableField(engine);
    rafCb?.(2000);
    const still = field.updates.at(-1)!.frame.clone();

    head.rotation.y = 0.9;
    rafCb?.(2016);
    const turned = field.updates.at(-1)!.frame;
    expect(turned.equals(still)).toBe(false);

    engine.dispose();
  });

  it('does not apply the emergence travel twice while the root translates', async () => {
    const { engine } = await mountBust();
    const vfx = h.registry.vfx.at(-1)!;
    const field = enableField(engine);

    // At rest the frame is the identity: the bind pose IS the current pose.
    vfx.rootOffsetY = 0;
    rafCb?.(2000);
    const settled = field.updates.at(-1)!.frame;
    expect(settled.elements[13]).toBeCloseTo(0, 6);

    // Mid-emergence the whole avatar translates. `SkinnedMesh` refreshes
    // `bindMatrixInverse` inside `updateMatrixWorld` and NOT inside
    // `updateWorldMatrix`, so pairing a fresh `matrixWorld` with a stale
    // inverse applies the root's travel a second time: -0.6 would read as
    // -1.2 here and the field would sit half a body below the head.
    vfx.rootOffsetY = -0.6;
    rafCb?.(2016);
    const rising = field.updates.at(-1)!.frame;
    expect(rising.elements[13]).toBeCloseTo(-0.6, 6);

    engine.dispose();
  });

  it('passes reduced motion through, because the lag is the shake response', async () => {
    const { engine } = await mountBust();
    const field = enableField(engine);
    rafCb?.(2000);
    expect(field.updates.at(-1)!.reduced).toBe(false);

    mqlListeners.forEach((fn) => fn({ matches: true } as MediaQueryListEvent));
    rafCb?.(2016);
    expect(field.updates.at(-1)!.reduced).toBe(true);

    engine.dispose();
  });

  it('updates once per frame with the live camera', async () => {
    const { engine } = await mountBust();
    const field = enableField(engine);
    const before = field.updates.length;
    rafCb?.(2000);
    rafCb?.(2016);
    expect(field.updates.length).toBe(before + 2);
    expect(field.updates.at(-1)!.camera).toBe(h.registry.renderer.at(-1)!.camera);

    engine.dispose();
  });

  it('drops the field when the avatar is replaced, because its sites are stale', async () => {
    const { engine } = await mountBust();
    const field = enableField(engine);
    const scene = h.registry.renderer.at(-1)!.scene;

    engine.setTextSkinSource({ getText: () => 'x', onChange: () => () => {} });
    // A remount is what replaces the avatar; the field must not survive it
    // holding rest positions sampled from a body that is gone.
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    expect(field.disposeCount).toBe(1);
    expect(scene.children).not.toContain(field.object);

    engine.dispose();
  });

  it('disposes the field with the engine', async () => {
    const { engine } = await mountBust();
    const field = enableField(engine);
    const scene = h.registry.renderer.at(-1)!.scene;

    engine.dispose();
    expect(field.disposeCount).toBe(1);
    expect(scene.children).not.toContain(field.object);
  });
});

describe('snapshot lens lifecycle (dec.liquid-glass-architecture, item 4)', () => {
  function makeBustAvatar(): { group: THREE.Group; body: THREE.Mesh } {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0.1, 0.5, 0, -0.1, 1, 0], 3),
    );
    const body = new THREE.Mesh(geometry, { name: 'bust' } as THREE.Material);
    body.morphTargetDictionary = { jaw_open: 0 };
    body.morphTargetInfluences = [0];
    const group = new THREE.Group();
    group.add(body);
    return { group, body };
  }

  async function mountHead(): Promise<ReturnType<typeof createEngine>> {
    const { group, body } = makeBustAvatar();
    h.avatarOverride = {
      root: group,
      morphMeshes: [body],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };
    const engine = createEngine({ avatarUrl: 'fake.glb' });
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    return engine;
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  function stubRasteriser(): () => Promise<CanvasImageSource> {
    return () => Promise.resolve({ width: 4, height: 4 } as unknown as CanvasImageSource);
  }

  it('never touches the lens uniforms for a head with no source named', async () => {
    const engine = await mountHead();
    const vfx = h.registry.vfx.at(-1)!;
    rafCb?.(16);
    rafCb?.(32);
    // Not "bound null": never called at all. No layout read, no rasteriser
    // load, no texture, so the shipped head costs exactly what it did.
    expect(vfx.lensBindings).toEqual([]);
    engine.dispose();
  });

  it('binds a snapshot once a source is named, and clears it when it is dropped', async () => {
    const engine = await mountHead();
    const vfx = h.registry.vfx.at(-1)!;

    engine.setLensSource(document.createElement('section'), { rasterise: stubRasteriser() });
    await settle();
    rafCb?.(16);

    const bound = vfx.lensBindings.at(-1);
    expect(bound).not.toBeNull();
    expect(bound?.texture).toBeDefined();

    engine.setLensSource(null);
    expect(vfx.lensBindings.at(-1)).toBeNull();
    engine.dispose();
  });

  it('is idempotent on the same source, so a re-rendering host cannot storm captures', async () => {
    const engine = await mountHead();
    const rasterise = vi.fn(stubRasteriser());
    const section = document.createElement('section');

    for (let render = 0; render < 25; render++) {
      engine.setLensSource(section, { rasterise });
    }
    await settle();
    // One capture, not twenty-five. A capture is 10 to 150 ms of main thread,
    // and this is the exact shape of a framework effect with no dependencies.
    expect(rasterise).toHaveBeenCalledTimes(1);

    engine.setLensSource(document.createElement('section'), { rasterise });
    await settle();
    expect(rasterise).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it('unbinds the snapshot before disposing it, so no dead texture stays in the sampler', async () => {
    const engine = await mountHead();
    const vfx = h.registry.vfx.at(-1)!;
    engine.setLensSource(document.createElement('section'), { rasterise: stubRasteriser() });
    await settle();
    rafCb?.(16);

    const texture = vfx.lensBindings.at(-1)?.texture;
    expect(texture).toBeDefined();
    let disposedAt = -1;
    texture?.addEventListener('dispose', () => {
      disposedAt = vfx.lensBindings.length;
    });

    engine.setLensSource(null);
    // The clearing call must already have been made when the texture died.
    expect(vfx.lensBindings.at(-1)).toBeNull();
    expect(disposedAt).toBe(vfx.lensBindings.length);
    engine.dispose();
  });

  it('accepts a source named before mount and builds it when the canvas arrives', async () => {
    const { group, body } = makeBustAvatar();
    h.avatarOverride = {
      root: group,
      morphMeshes: [body],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };
    const engine = createEngine({ avatarUrl: 'fake.glb' });
    engine.setLensSource(document.createElement('section'), { rasterise: stubRasteriser() });
    const vfx = h.registry.vfx.at(-1)!;
    expect(vfx.lensBindings).toEqual([]);

    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    await settle();
    rafCb?.(16);
    expect(vfx.lensBindings.at(-1)).not.toBeNull();
    engine.dispose();
  });

  it('reports a capture failure as an engine error and keeps rendering', async () => {
    const engine = await mountHead();
    const errors: Error[] = [];
    engine.on('error', (err) => errors.push(err));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    engine.setLensSource(document.createElement('section'), {
      rasterise: () => Promise.reject(new Error('rasteriser missing')),
    });
    await settle();

    expect(errors.map((e) => e.message)).toEqual(['rasteriser missing']);
    rafCb?.(16);
    expect(h.registry.renderer.at(-1)!.renderCount).toBeGreaterThan(0);
    warn.mockRestore();
    engine.dispose();
  });

  it('clears the binding when the engine is disposed', async () => {
    const engine = await mountHead();
    const vfx = h.registry.vfx.at(-1)!;
    engine.setLensSource(document.createElement('section'), { rasterise: stubRasteriser() });
    await settle();
    rafCb?.(16);
    expect(vfx.lensBindings.at(-1)).not.toBeNull();

    engine.dispose();
    expect(vfx.lensBindings.at(-1)).toBeNull();
  });
});

/**
 * The Chromium HTML-in-Canvas enhancement, seen from the engine
 * (dec.liquid-glass-architecture, item 5). What matters here is only which
 * lens gets built: the upload path itself is covered in
 * `test/core-element-lens.test.ts`.
 */
describe('live lens selection (dec.liquid-glass-architecture, item 5)', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  function makeBustAvatar(): { group: THREE.Group; body: THREE.Mesh } {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0.1, 0.5, 0, -0.1, 1, 0], 3),
    );
    const body = new THREE.Mesh(geometry, { name: 'bust' } as THREE.Material);
    body.morphTargetDictionary = { jaw_open: 0 };
    body.morphTargetInfluences = [0];
    const group = new THREE.Group();
    group.add(body);
    return { group, body };
  }

  async function mountHead(canvas = document.createElement('canvas')) {
    const { group, body } = makeBustAvatar();
    h.avatarOverride = {
      root: group,
      morphMeshes: [body],
      bones: {},
      animations: [],
      setMorph() {},
      getMorph() {
        return 0;
      },
      dispose() {},
    };
    const engine = createEngine({ avatarUrl: 'fake.glb' });
    await engine.mount(canvas, document.createElement('div'));
    return engine;
  }

  /** A subtree shaped for the enhancement: an immediate child of a drawable canvas. */
  function liveSubtree(options: { control?: boolean } = {}): HTMLElement {
    const holder = document.createElement('canvas');
    holder.setAttribute('layoutsubtree', '');
    holder.width = 512;
    holder.height = 512;
    holder.getContext = (() => ({
      clearRect() {},
      setTransform() {},
      drawElementImage() {},
    })) as unknown as HTMLCanvasElement['getContext'];
    const child = document.createElement('div');
    child.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 512 }) as DOMRect;
    if (options.control) child.appendChild(document.createElement('input'));
    holder.appendChild(child);
    return child;
  }

  /**
   * Turn the flag on. Torn down in `afterEach` rather than at the end of a
   * test body, or a failed assertion would leak the fake capability into every
   * later suite in this file and silently reroute the snapshot lens.
   */
  const scope = globalThis as unknown as {
    CanvasRenderingContext2D?: unknown;
    WebGL2RenderingContext?: unknown;
  };
  function withCapability(): void {
    scope.CanvasRenderingContext2D = { prototype: { drawElementImage(): void {} } };
    scope.WebGL2RenderingContext = { prototype: { texElementImage2D(): void {} } };
  }
  afterEach(() => {
    delete scope.CanvasRenderingContext2D;
    delete scope.WebGL2RenderingContext;
  });

  const stubRasteriser = () =>
    vi.fn(async () => ({ width: 4, height: 4 }) as unknown as CanvasImageSource);

  it('takes the snapshot path for the same subtree when the capability is absent', async () => {
    const engine = await mountHead();
    const vfx = h.registry.vfx.at(-1)!;
    const rasterise = stubRasteriser();
    engine.setLensSource(liveSubtree(), { rasterise });
    await settle();
    rafCb?.(16);

    expect(rasterise).toHaveBeenCalledTimes(1);
    expect(vfx.lensBindings.at(-1)).not.toBeNull();
    engine.dispose();
  });

  it('uploads live DOM instead, with no rasteriser at all, where it is detected', async () => {
    withCapability();
    const engine = await mountHead();
    const vfx = h.registry.vfx.at(-1)!;

    engine.setLensSource(liveSubtree());
    await settle();
    rafCb?.(16);

    const bound = vfx.lensBindings.at(-1);
    expect(bound).not.toBeNull();
    expect(bound?.texture).toBeDefined();
    engine.dispose();
  });

  it('honours an explicit rasteriser over the enhancement', async () => {
    withCapability();
    const engine = await mountHead();
    const rasterise = stubRasteriser();

    engine.setLensSource(liveSubtree(), { rasterise });
    await settle();

    // Naming a rasteriser is an explicit choice of the snapshot path.
    expect(rasterise).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it('warns when the head covers a control inside the subtree it refracts', async () => {
    withCapability();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
    const engine = await mountHead(canvas);

    // Hit-testing follows the undistorted layout box, so a head over the live
    // subtree makes a control inside it unreachable, and no transform can
    // reconcile that: a lens is not affine.
    engine.setLensSource(liveSubtree({ control: true }));
    expect(warn.mock.calls.flat().join(' ')).toContain('interactive control(s)');

    warn.mockRestore();
    engine.dispose();
  });

  it('says nothing about decorative live content under the head', async () => {
    withCapability();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
    const engine = await mountHead(canvas);

    // Overlap is the normal, intended arrangement: the head refracts what is
    // behind it. Only a trapped CONTROL is worth a word.
    engine.setLensSource(liveSubtree());
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
    engine.dispose();
  });
});
