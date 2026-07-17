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
import type {
  AssetLoader,
  AudioEngine,
  BehaviorMachine,
  BehaviorState,
  BehaviorMachineEvents,
  Emitter,
  Expression,
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
  state: BehaviorState;
}
interface FakeMotion extends MotionEngine {
  disposeCount: number;
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
}
interface FakeVfx extends VFXEngine {
  disposeCount: number;
  emergenceValue: number;
  reduced: boolean;
  setReducedMotion(reduce: boolean): void;
}
interface FakeRenderer extends RendererHost {
  disposeCount: number;
  renderCount: number;
  backend: 'webgpu' | 'webgl2' | 'uninitialized';
  gpuRenderer: unknown;
}
interface FakeAsset extends AssetLoader {
  disposeCount: number;
  loadCalls: number;
  loadUrls: string[];
  attachRendererCalls: unknown[];
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
      observe() {},
      setScrollProgress() {},
      disposeCount: 0,
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
      update() {},
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

vi.mock('../src/speech', () => {
  const adapter = h.buildAdapter('demo');
  h.demoAdapter = adapter;
  return {
    createSpeechEngine() {
      const emitter = h.makeEmitter<{ start: void; end: void; stall: void }>();
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

vi.mock('../src/shaders', () => ({
  createVFXEngine() {
    const vfx: FakeVfx = {
      emergenceValue: 0,
      reduced: false,
      get emergence() {
        return this.emergenceValue;
      },
      rootOffsetY: 0,
      clippingPlane: new THREE.Plane(),
      createSkinMaterial() {
        // The engine assigns this as mesh.material, so it must carry dispose().
         return h.skinMaterialOverride ?? ({ isSkin: true, dispose() {} } as unknown as THREE.Material);
       },
       setEmergence(p: number) {
        this.emergenceValue = p;
      },
      setReducedMotion(reduce: boolean) {
        this.reduced = reduce;
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
}));

vi.mock('../src/renderer', () => ({
  createRendererHost() {
    const renderer: FakeRenderer = {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(35, 1, 0.1, 100),
      backend: 'uninitialized',
      gpuRenderer: { tag: 'gpu-renderer' } as unknown,
      async init() {
        this.backend = 'webgpu';
      },
      setSize() {},
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
    expect(h.registry.behavior.at(-1)!.disposeCount).toBe(1);
    expect(h.registry.motion.at(-1)!.disposeCount).toBe(1);
    expect(h.registry.speech.at(-1)!.disposeCount).toBe(1);
    expect(h.registry.textSkin.at(-1)!.disposeCount).toBe(1);
    expect(h.registry.vfx.at(-1)!.disposeCount).toBe(1);
    expect(h.registry.renderer.at(-1)!.disposeCount).toBe(1);
    expect(h.registry.audio.at(-1)!.disposeCount).toBe(1);
    expect(h.registry.asset.at(-1)!.disposeCount).toBe(1);
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
    asset.load = () => loadPromise;

    const p = engine.mount(document.createElement('canvas'), document.createElement('div'));
    // Let renderer init resolve so mount reaches the asset-load await, then
    // dispose mid-load to exercise the second race guard.
    await Promise.resolve();
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
  it('threads reduced motion into VFX on mount', async () => {
    const engine = createEngine({ reducedMotion: true });
    const motion = h.registry.motion.at(-1)!;
    const vfx = h.registry.vfx.at(-1)!;
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    expect(motion.reduced).toBe(true);
    expect(vfx.reduced).toBe(true);
    engine.dispose();
  });

  it('routes a media-query change into VFX as well as motion', async () => {
    const engine = createEngine();
    const motion = h.registry.motion.at(-1)!;
    const vfx = h.registry.vfx.at(-1)!;
    await engine.mount(document.createElement('canvas'), document.createElement('div'));
    mqlListeners.forEach((fn) => fn({ matches: true } as MediaQueryListEvent));
    expect(motion.reduced).toBe(true);
    expect(vfx.reduced).toBe(true);
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
