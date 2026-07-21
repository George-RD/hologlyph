/**
 * Core engine: composes every subsystem, owns the render loop and lifecycle,
 * and wires behaviour state to motion/expression and VFX emergence.
 *
 * SEAM NOTE (contract gap, reported in the batch packet): the SpeechEngine
 * contract has no viseme-sink parameter, and no `on` method on the contract
 * surface. To route visemes from a TTSAdapter into the MotionEngine without
 * leaking speech internals into core, we wrap the adapter with
 * `visemeTap(adapter, onFrame, onEnergy)`: it forwards the adapter's
 * UtteranceHandle `viseme` events to the motion viseme sink and coarsens
 * `energy` events into a jaw-open shape. The wrapped adapter is then handed to
 * `speech.setAdapter`. This keeps the SpeechEngine contract untouched while
 * giving core the viseme stream it needs.
 */
import type * as THREE from 'three';
import { FrontSide } from 'three';
import { clamp01 } from '../contracts.js';
import type {
  AssetLoader,
  AudioEngine,
  BehaviorMachine,
  BehaviorState,
  Engine,
  EngineEvents,
  EngineOptions,
  Expression,
  LoadedAvatar,
  MotionEngine,
  RendererHost,
  SpeechEngine,
  TextSkinEngine,
  TextSkinSource,
  TTSAdapter,
  VFXEngine,
  VisemeFrame,
} from '../contracts.js';
import { createAssetLoader } from '../asset';
import { createAudioEngine } from '../audio';
import { createBehaviorMachine } from '../behavior';
import { createMotionEngine } from '../motion';
import { createRendererHost } from '../renderer';
import { createSpeechEngine, createDemoTTSAdapter } from '../speech';
import { createTextSkinEngine } from '../text-skin';
import { createVFXEngine } from '../shaders';
import { createEmitter } from './emitter.js';
import { createPlaceholderAvatar } from './placeholder-avatar.js';
 
// Materials the engine must not replace with the text skin. The mouth cavity
// and the eye trim (caruncle-corner blend shell + lacrimal fluid) keep their
// authored dark materials. All other morph meshes receive the glyph grid,
// including any teeth-named or unnamed placeholder material.
const KEEP_MATERIALS: ReadonlySet<string> = new Set(['mouth_interior', 'eye_trim']);
function isEyeMesh(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some(
    (material) => material?.name === "eye_sclera" || material?.name === "eye_iris",
  );
}

const DEFAULT_TEXT =
  'hologlyph — a web-native, text-skinned talking head. Scroll to emerge, speak to converse.';

/**
 * Wrap a TTSAdapter so its utterance `viseme` / `energy` events flow into a
 * motion sink. Returns a TTSAdapter whose `speak` forwards the underlying
 * handle's events and cleans up listeners on end/error.
 *
 * Ownership: pass `ownsAdapter = true` only when this wrapper owns the
 * underlying adapter's lifetime (the engine-created demo adapter). When the
 * adapter is supplied by the caller (via options.ttsAdapter or
 * setVoiceAdapter) the caller retains ownership and the wrapper must NOT
 * dispose it on `dispose()` — otherwise a later re-wrap would tear down the
 * caller's live adapter.
 */
export function visemeTap(
  adapter: TTSAdapter,
  onFrame: (frame: VisemeFrame) => void,
  onEnergy: (energy: number) => void,
  ownsAdapter = false,
): TTSAdapter {
  return {
    get mode() {
      return adapter.mode;
    },
    speak(text, audio) {
      const handle = adapter.speak(text, audio);
      const offViseme = handle.on('viseme', (frame) => onFrame(frame));
      const offEnergy = handle.on('energy', (energy) => onEnergy(energy));
      const cleanup = () => {
        offViseme();
        offEnergy();
      };
      handle.on('end', cleanup);
      handle.on('error', cleanup);
      return handle;
    },
    dispose() {
      // Only tear down an adapter this wrapper actually owns (engine demo
      // adapter). Caller-supplied adapters outlive any single swap.
      if (ownsAdapter) adapter.dispose();
    },
  };
}

function createDefaultTextSource(): TextSkinSource {
  return {
    getText: () => DEFAULT_TEXT,
    onChange: () => () => {},
  };
}

export function createEngine(options?: EngineOptions): Engine {
  return new EngineImpl(options ?? {});
}

class EngineImpl implements Engine {
  private readonly emitter = createEmitter<EngineEvents>();

  private readonly sysRenderer: RendererHost;
  private readonly sysBehavior: BehaviorMachine;
  private readonly sysMotion: MotionEngine;
  private readonly sysAudio: AudioEngine;
  private readonly sysSpeech: SpeechEngine;
  private readonly sysTextSkin: TextSkinEngine;
  private readonly sysVfx: VFXEngine;
  private readonly sysAsset: AssetLoader;
  /** Base TTS adapter currently wrapped and handed to the speech engine. */
  private baseAdapter: TTSAdapter;
  /** True only when `baseAdapter` is the engine-owned demo adapter. */
  private ownsBaseAdapter: boolean;

  private readonly options: EngineOptions;

  private avatar: LoadedAvatar | null = null;
  private skinMaterial: THREE.Material | null = null;
  private readonly displacedMaterials = new Set<THREE.Material>();
  private mountGeneration = 0;
  private mountSerial: Promise<void> = Promise.resolve();

  private rafHandle: number | null = null;
  private running = false;
  private disposed = false;
  private lastTime = 0;
  private elapsed = 0;
  private motionFrozen = false;
  private observed = false;
  private reducedMotionMql: MediaQueryList | null = null;

  constructor(options: EngineOptions) {
    this.options = options;

    this.sysRenderer = createRendererHost();
    this.sysBehavior = createBehaviorMachine();
    this.sysMotion = createMotionEngine();
    this.sysAudio = createAudioEngine();
    this.sysSpeech = createSpeechEngine(this.sysAudio);
    this.sysTextSkin = createTextSkinEngine();
    this.sysVfx = createVFXEngine();
    this.sysAsset = createAssetLoader();

    const source: TextSkinSource = options.textSource ?? createDefaultTextSource();
    this.sysTextSkin.setSource(source);

    // Route visemes: demo adapter by default, or a user-provided one. The
    // caller owns any adapter it passes via options.ttsAdapter, so the wrapper
    // must not dispose it; the engine-owned demo adapter is disposed on swap.
    const onViseme = (frame: VisemeFrame) => this.sysMotion.applyVisemeFrame(frame);
    const onEnergy = (energy: number) =>
      this.sysMotion.applyVisemeFrame({ time: 0, weights: { jaw_open: clamp01(energy) } });
    this.baseAdapter = options.ttsAdapter ?? createDemoTTSAdapter();
    this.ownsBaseAdapter = !options.ttsAdapter;
    this.sysSpeech.setAdapter(
      visemeTap(this.baseAdapter, onViseme, onEnergy, this.ownsBaseAdapter),
    );

    // Behaviour transitions drive engine events + motion/VFX targets.
    this.sysBehavior.on('transition', (t) => this.onBehaviorTransition(t.from, t.to));

    // Speech lifecycle drives behaviour speech events and engine speech events.
    this.sysSpeech.on('start', () => {
      this.sysBehavior.dispatch({ type: 'speech-start' });
      this.emitter.emit('speechstart', undefined);
    });
    this.sysSpeech.on('end', () => {
      // Drop residual viseme shaping before the behaviour/speech events
      // propagate (mouth returns to neutral on silence, dec.expression-vocab).
      this.sysMotion.clearVisemes();
      this.sysBehavior.dispatch({ type: 'speech-end' });
      this.emitter.emit('speechend', undefined);
    });
    this.sysSpeech.on('stall', () => {
      this.sysBehavior.dispatch({ type: 'speech-stall' });
    });
  }

  // --- Emitter surface ------------------------------------------------------

  on<K extends keyof EngineEvents>(event: K, fn: (payload: EngineEvents[K]) => void): () => void {
    return this.emitter.on(event, fn);
  }

  off<K extends keyof EngineEvents>(event: K, fn: (payload: EngineEvents[K]) => void): void {
    this.emitter.off(event, fn);
  }

  emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  get state(): BehaviorState {
    return this.sysBehavior.state;
  }

  // --- Advanced hook accessors (fixed contract names) -----------------------

  get motion(): MotionEngine {
    return this.sysMotion;
  }

  get behavior(): BehaviorMachine {
    return this.sysBehavior;
  }

  get speech(): SpeechEngine {
    return this.sysSpeech;
  }

  get audio(): AudioEngine {
    return this.sysAudio;
  }

  get vfx(): VFXEngine {
    return this.sysVfx;
  }
  // --- Lifecycle ------------------------------------------------------------

  async mount(canvas: HTMLCanvasElement, host: Element): Promise<void> {
    const generation = ++this.mountGeneration;
    const next = this.mountSerial.then(
      () => this.doMount(canvas, host, generation),
      () => this.doMount(canvas, host, generation),
    );
    this.mountSerial = next.catch(() => {});
    await next;
  }

  async speak(text: string): Promise<void> {
    try {
      // AudioContext must resume from a user gesture before playback.
      await this.sysAudio.resumeFromGesture();
      await this.sysSpeech.speak(text);
    } catch (err) {
      this.emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.sysRenderer.setSize(width, height);
  }

  setMotionFrozen(frozen: boolean): void {
    this.motionFrozen = frozen;
  }

  setEmotion(expression: Expression): void {
    this.sysMotion.setExpression(expression);
  }

  setScrollProgress(progress: number): void {
    this.sysBehavior.setScrollProgress(progress);
  }

  setTextSkinSource(source: TextSkinSource): void {
    this.sysTextSkin.setSource(source);
  }

  setVoiceAdapter(adapter: TTSAdapter): void {
    // Re-passing the same base adapter is a no-op: swapping would build a fresh
    // wrapper (and dispose the old one) for an adapter the caller still owns.
    if (this.baseAdapter === adapter) return;
    const onViseme = (frame: VisemeFrame) => this.sysMotion.applyVisemeFrame(frame);
    const onEnergy = (energy: number) =>
      this.sysMotion.applyVisemeFrame({ time: 0, weights: { jaw_open: clamp01(energy) } });
    // Caller-supplied adapter: the caller owns the instance, so the wrapper
    // must not dispose it when the speech engine swaps adapters.
    this.sysSpeech.setAdapter(visemeTap(adapter, onViseme, onEnergy, false));
    this.baseAdapter = adapter;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.stopLoop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.reducedMotionMql?.removeEventListener?.('change', this.onReducedMotion);

    this.sysBehavior.dispose();
    this.sysMotion.dispose();
    this.sysSpeech.dispose();
    this.sysTextSkin.dispose();
    if (this.avatar) {
      this.sysRenderer.scene.remove(this.avatar.root);
      this.avatar.dispose();
      this.avatar = null;
    }
    this.disposeDisplacedMaterials();
    this.sysVfx.dispose();
    this.sysRenderer.dispose();
    this.sysAudio.dispose();
    this.sysAsset.dispose();
    this.mountSerial = Promise.resolve();
  }

  private async doMount(canvas: HTMLCanvasElement, host: Element, generation: number): Promise<void> {
    if (this.disposed) return;
    try {
      await this.sysRenderer.init(canvas);
      if (this.disposed || generation !== this.mountGeneration) return;

      const width = canvas.clientWidth || canvas.width || 640;
      const height = canvas.clientHeight || canvas.height || 480;
      this.sysRenderer.setSize(width, height);

      // Expose the live renderer to the asset loader so KTX2 transcoding
      // support can be detected (dec.asset-rig-schema) before any load.
      this.sysAsset.attachRenderer?.(this.sysRenderer.gpuRenderer);

      // Avatar delivery (dec.default-asset-delivery): an undefined avatarUrl
      // resolves to the packaged bust; an empty string explicitly requests the
      // placeholder; load failures degrade to the placeholder with a warning.
      // Dynamic import on purpose: the library build inlines the default head
      // (~890 kB) into this module's chunk, and the lazy boundary keeps it out
      // of consumers who pass their own avatarUrl.
      let candidates: string[];
      if (this.options.avatarUrl === undefined) {
        try {
          const { defaultAvatarUrls } = await import('./default-avatar.js');
          candidates = defaultAvatarUrls();
        } catch (err) {
          // A failed chunk load is an avatar-delivery failure, not a mount
          // failure: degrade to the placeholder like any other candidate miss.
          console.warn('[hologlyph] default avatar chunk failed to load.', err);
          candidates = [];
        }
      } else {
        candidates = this.options.avatarUrl ? [this.options.avatarUrl] : [];
      }
      if (this.disposed || generation !== this.mountGeneration) return;

      let candidateAvatar: LoadedAvatar | null = null;
      for (const url of candidates) {
        try {
          candidateAvatar = await this.sysAsset.load(url);
          if (this.disposed || generation !== this.mountGeneration) {
            if (candidateAvatar) {
              candidateAvatar.dispose();
            }
            return;
          }
          break;
        } catch (err) {
          console.warn(`[hologlyph] avatar load failed for ${url}.`, err);
        }
        if (this.disposed || generation !== this.mountGeneration) {
          return;
        }
      }
      if (!candidateAvatar) {
        if (candidates.length > 0) {
          console.warn('[hologlyph] no avatar candidate loaded; using placeholder.');
        }
        candidateAvatar = createPlaceholderAvatar();
      }
      if (this.disposed || generation !== this.mountGeneration) {
        candidateAvatar.dispose();
        return;
      }

      this.replaceAvatar(candidateAvatar);
      this.applyMotionAndObservation(host);

      // Start or suspend the loop from tab visibility and behaviour state.
      this.syncLoop();
      this.emitter.emit('ready', undefined);
    } catch (err) {
      if (generation !== this.mountGeneration) return;
      this.emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private replaceAvatar(candidateAvatar: LoadedAvatar): void {
    if (this.avatar) {
      this.sysRenderer.scene.remove(this.avatar.root);
      this.avatar.dispose();
      this.avatar = null;
      this.disposeDisplacedMaterials();
    }
    this.avatar = candidateAvatar;

    this.sysRenderer.scene.add(this.avatar.root);
    this.sysMotion.attach(this.avatar);

    // Place the translucent shell in front of transparent eye materials.
    for (const mesh of this.avatar.morphMeshes) mesh.renderOrder = 1;
    this.avatar.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !isEyeMesh(mesh)) return;
      mesh.renderOrder = 2;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.transparent = true;
        material.side = FrontSide;
        material.depthTest = true;
        material.depthWrite = true;
      }
    });
    this.skinMaterial = this.sysVfx.createSkinMaterial(this.sysTextSkin);
    this.displacedMaterials.clear();
    for (const mesh of this.avatar.morphMeshes) {
      const original = mesh.material;
      const name = (Array.isArray(original) ? undefined : original?.name) as string | undefined;
      if (name !== undefined && KEEP_MATERIALS.has(name)) continue;
      if (Array.isArray(original)) {
        for (const material of original) {
          if (material && material !== this.skinMaterial) {
            this.displacedMaterials.add(material);
          }
        }
        mesh.material = this.skinMaterial;
      } else if (original) {
        if (original !== this.skinMaterial) {
          this.displacedMaterials.add(original);
        }
        mesh.material = this.skinMaterial;
      }
    }
  }

  private applyMotionAndObservation(host: Element): void {
    const reduced = this.options.reducedMotion ?? this.prefersReducedMotion();
    this.sysMotion.setReducedMotion(reduced);
    // Thread reduced motion into VFX and the text skin as well as motion
    // (dec.renderer-posture); the text skin pauses its row flow.
    this.sysVfx.setReducedMotion(reduced);
    this.sysTextSkin.setReducedMotion(reduced);
    if (typeof matchMedia !== 'undefined' && !this.observed) {
      this.reducedMotionMql = matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotionMql.addEventListener?.('change', this.onReducedMotion);
    }
    if (!this.observed) {
      this.sysBehavior.observe(host);
      this.observed = true;
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  private disposeDisplacedMaterials(): void {
    const textures = new Set<THREE.Texture>();
    for (const material of this.displacedMaterials) {
      for (const key of Object.keys(material) as Array<keyof typeof material & string>) {
        const value = (material as unknown as Record<string, unknown>)[key];
        if (value && (value as THREE.Texture).isTexture) {
          textures.add(value as THREE.Texture);
        }
      }
    }
    for (const texture of textures) {
      if (typeof texture.dispose === 'function') {
        texture.dispose();
      }
    }
    for (const material of this.displacedMaterials) {
      if (typeof material.dispose === 'function') {
        material.dispose();
      }
    }
    this.displacedMaterials.clear();
  }

  // --- Internals ------------------------------------------------------------

  private onBehaviorTransition(from: BehaviorState, to: BehaviorState): void {
    this.emitter.emit('statechange', { from, to });
    switch (to) {
      case 'listening':
        this.sysMotion.setGazeMode('contact');
        this.sysMotion.setExpression('listening');
        break;
      case 'speaking':
        this.sysMotion.setGazeMode('aversion');
        this.sysMotion.setExpression('speaking');
        break;
      case 'thinking':
        this.sysMotion.setExpression('thinking');
        break;
      case 'idle':
      case 'hidden':
      case 'departing':
        this.sysMotion.setGazeMode('idle');
        this.sysMotion.setExpression('neutral');
        break;
      default:
        break;
    }
    this.syncEmergence();
    this.syncLoop();
  }

  private syncEmergence(): void {
    const state = this.sysBehavior.state;
    const target = state === 'hidden' || state === 'departing' ? 0 : 1;
    this.sysVfx.setEmergence(target);
  }

  private startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = this.lastTime ? (now - this.lastTime) / 1000 : 0;
    this.lastTime = now;
    this.elapsed += dt;

    this.syncEmergence();
    this.sysTextSkin.update(dt);
    this.sysVfx.update(dt);

    // Close the emergence loop: the state machine needs completion events
    // once the VFX ramp settles (dec.behavior-state-machine transitions
    // emerging -> idle and departing -> hidden).
    const state = this.sysBehavior.state;
    if (state === 'emerging' && this.sysVfx.emergence >= 0.999) {
      this.sysBehavior.dispatch({ type: 'emerge-complete' });
    } else if (state === 'departing' && this.sysVfx.emergence <= 0.001) {
      this.sysBehavior.dispatch({ type: 'submerge-complete' });
    }
    this.sysRenderer.setClippingPlane(this.sysVfx.clippingPlane);
    if (this.avatar) this.avatar.root.position.y = this.sysVfx.rootOffsetY;
    // While frozen, skip the motion update entirely: idle and gaze phase off
    // wall-clock time, so even dt=0 would keep breathing between frames.
    if (!this.motionFrozen) this.sysMotion.update(dt, this.elapsed);
    this.sysRenderer.render();

    if (this.running) this.rafHandle = requestAnimationFrame(this.frame);
  };
  /**
   * Single source of truth for render-loop suspension (dec.performance-budget).
   * Runs the loop only when the tab is visible AND the behaviour state is not
   * `hidden`; otherwise stops it and suspends audio. Called from the visibility
   * handler, every behaviour transition, and at mount.
   */
  private syncLoop(): void {
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const suspended = !visible || this.sysBehavior.state === 'hidden';
    if (suspended) {
      this.stopLoop();
      this.sysAudio.suspend();
    } else {
      this.startLoop();
    }
  }

  private readonly onVisibility = (): void => {
    // Single suspension policy (dec.performance-budget): visibility drives the
    // loop and audio suspension together with behaviour state via syncLoop().
    this.syncLoop();
  };

  private readonly onReducedMotion = (event: MediaQueryListEvent): void => {
    this.sysMotion.setReducedMotion(event.matches);
    // Mirror the reduced-motion preference into VFX and the text skin.
    this.sysVfx.setReducedMotion(event.matches);
    this.sysTextSkin.setReducedMotion(event.matches);
  };

  private prefersReducedMotion(): boolean {
    if (typeof matchMedia === 'undefined') return false;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
