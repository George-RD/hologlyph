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
import { FrontSide, Matrix4, Mesh, MeshBasicMaterial, NoBlending, SkinnedMesh, Vector3 } from 'three';
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
  HeadCompositorConfig,
  HeadInteriorConfig,
  HeadPoolConfig,
  LensSourceOptions,
  MotionEngine,
  RendererHost,
  SpeechEngine,
  StageCollider,
  TextSkinEngine,
  TextSkinSource,
  TTSAdapter,
  VFXEngine,
  VisemeFrame,
} from '../contracts.js';
import { createAssetLoader } from '../asset';
import { bakeThickness, createThicknessBudget } from '../asset/rig.js';
import { SilhouetteProjector } from '../asset/hull.js';
import { createAudioEngine } from '../audio';
import { createBehaviorMachine } from '../behavior';
import { createMotionEngine } from '../motion';
import { createRendererHost } from '../renderer';
import { createSpeechEngine } from '../speech/engine';
import { createDemoTTSAdapter } from '../speech/adapters/demo';
import { createTextSkinEngine } from '../text-skin';
import { DEFAULT_GRID } from '../text-skin/grid.js';
import {
  createVFXEngine,
  buildEyeballMaterial,
  FLUID_PARTICIPANT_MODES,
  fluidDrive,
  fluidReaction,
  poolRadialProfile,
  poolRippleDrive,
  poolWaterlineRadius,
  type InteriorGlyphField,
  type PoolObstacle,
  type PoolProfile,
  type PoolSurface,
} from '../shaders';
import { createInteriorGlyphField } from '../shaders/interior-glyph-field.js';
import { createPoolSurface } from '../shaders/pool-surface.js';
import { createCompositorGlass, type CompositorGlass } from './compositor-glass.js';
import { createEmitter } from './emitter.js';
import {
  countInteractiveDescendants,
  createElementLens,
  lensRegionsOverlap,
  resolveLiveLens,
} from './element-lens.js';
import { documentRect, type LensSource } from './lens.js';
import { createPageLens } from './page-lens.js';
import { createPlaceholderAvatar } from './placeholder-avatar.js';
import { resolveBackdropColor } from './backdrop.js';
import {
  createStage,
  projectRect,
  stageCollider,
  stageProjection,
  type Stage,
} from './participants.js';
 
// Materials the engine must not replace with the text skin. The mouth cavity
// and the eye trim (caruncle-corner blend shell + lacrimal fluid) keep their
// authored dark materials. All other morph meshes receive the glyph grid,
// including any teeth-named or unnamed placeholder material.
const KEEP_MATERIALS: ReadonlySet<string> = new Set(['mouth_interior', 'eye_trim']);
function isEyeMesh(mesh: THREE.Mesh): boolean {
  if (mesh.parent?.name === 'eyes' || mesh.name.startsWith('eyes_') || mesh.name.startsWith('eye_')) {
    return true;
  }
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some(
    (material) =>
      material?.name === 'eye_sclera' ||
      material?.name === 'eye_iris' ||
      (material as unknown as Record<string, unknown>)?.isEyeball === true,
  );
}

/**
 * Clone the primary morph mesh as a colour-free or interior overlay pass:
 * same geometry, skeleton, pose and morph influence array, different material
 * and render order. Sharing `morphTargetInfluences` by reference is what keeps
 * the overlay welded to the face without a second animation path.
 */
function cloneOverlayMesh(
  primary: THREE.Mesh,
  material: THREE.Material,
  renderOrder: number,
): THREE.Mesh | THREE.SkinnedMesh {
  let overlay: THREE.Mesh | THREE.SkinnedMesh;
  if ('isSkinnedMesh' in primary && (primary as THREE.SkinnedMesh).isSkinnedMesh) {
    const skinned = primary as THREE.SkinnedMesh;
    const skinnedOverlay = new SkinnedMesh(skinned.geometry, material);
    if (skinned.skeleton) {
      skinnedOverlay.bindMode = skinned.bindMode;
      skinnedOverlay.bind(skinned.skeleton, skinned.bindMatrix);
    }
    overlay = skinnedOverlay;
  } else {
    overlay = new Mesh(primary.geometry, material);
  }
  overlay.position.copy(primary.position);
  overlay.rotation.copy(primary.rotation);
  overlay.scale.copy(primary.scale);
  overlay.morphTargetDictionary = primary.morphTargetDictionary;
  overlay.morphTargetInfluences = primary.morphTargetInfluences;
  overlay.renderOrder = renderOrder;
  return overlay;
}

/**
 * The body the interior glyphs hang inside, and the bone whose motion drags
 * them (dec.liquid-glass-architecture, item 10).
 *
 * On the shipped bust the whole body except the eyeballs skins to `head` at
 * weight 1 (`tools/asset-pipeline/build-bust.ts`), so the head bone is the
 * frame of the whole block of glass rather than just the skull.
 */
interface InteriorBody {
  readonly mesh: THREE.Mesh;
  /** Null on a rig with no `head` bone, or an unskinned body. */
  readonly bone: THREE.Bone | null;
  readonly boneInverse: THREE.Matrix4 | null;
}

function resolveInteriorBody(mesh: THREE.Mesh, avatar: LoadedAvatar): InteriorBody {
  const skinned = mesh as THREE.SkinnedMesh;
  const head = avatar.bones.head ?? null;
  if (skinned.isSkinnedMesh && head && skinned.skeleton) {
    const index = skinned.skeleton.bones.indexOf(head);
    const inverse = index >= 0 ? skinned.skeleton.boneInverses[index] : undefined;
    if (inverse) return { mesh, bone: head, boneInverse: inverse };
  }
  return { mesh, bone: null, boneInverse: null };
}

/**
 * Read a body's bind-space positions and its baked thickness into flat
 * arrays, for one sampling pass.
 *
 * Through `getX/getY/getZ`, never off `.array`, for the reason
 * `poolRadialProfile`'s caller states: a meshopt-compressed GLB hands back an
 * interleaved, quantised attribute whose raw buffer is neither a flat XYZ
 * stream nor in model units. Both arrays are dropped as soon as the sites are
 * sampled, so nothing here is retained for a field that is switched off.
 */
function readInteriorGeometry(mesh: THREE.Mesh): {
  positions: Float32Array;
  thickness: Float32Array | null;
} {
  const position = mesh.geometry.attributes.position;
  if (!position) return { positions: new Float32Array(0), thickness: null };
  const positions = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    positions[i * 3] = position.getX(i);
    positions[i * 3 + 1] = position.getY(i);
    positions[i * 3 + 2] = position.getZ(i);
  }
  const baked = mesh.geometry.attributes.aThickness;
  if (!baked || baked.count !== position.count) return { positions, thickness: null };
  const thickness = new Float32Array(baked.count);
  for (let i = 0; i < baked.count; i++) thickness[i] = baked.getX(i);
  return { positions, thickness };
}

const DEFAULT_TEXT =
  'hologlyph: a web-native, text-skinned talking head. Scroll to emerge, speak to converse.';

/** Handed to the compositor layer when there is no outline to show. */
const EMPTY_OUTLINE = new Float32Array(0);

/**
 * Wrap a TTSAdapter so its utterance `viseme` / `energy` events flow into a
 * motion sink. Returns a TTSAdapter whose `speak` forwards the underlying
 * handle's events and cleans up listeners on end/error.
 *
 * Ownership: pass `ownsAdapter = true` only when this wrapper owns the
 * underlying adapter's lifetime (the engine-created demo adapter). When the
 * adapter is supplied by the caller (via options.ttsAdapter or
 * setVoiceAdapter) the caller retains ownership and the wrapper must NOT
 * dispose it on `dispose()`, otherwise a later re-wrap would tear down the
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
  private readonly eyeTextSkin: TextSkinEngine;
  private readonly sysVfx: VFXEngine;
  private readonly sysAsset: AssetLoader;
  /** Base TTS adapter currently wrapped and handed to the speech engine. */
  private baseAdapter: TTSAdapter;
  /** True only when `baseAdapter` is the engine-owned demo adapter. */
  private ownsBaseAdapter: boolean;

  private readonly options: EngineOptions;

  private avatar: LoadedAvatar | null = null;
  private skinMaterial: THREE.Material | null = null;
  private occlusionMaskMesh: THREE.Mesh | THREE.SkinnedMesh | null = null;
  private interiorMesh: THREE.Mesh | THREE.SkinnedMesh | null = null;
  private readonly displacedMaterials = new Set<THREE.Material>();
  /**
   * The occlusion mask plus the authored internals that were opaque as
   * loaded. They only join the transparent render list while the interior
   * glass pass needs `renderOrder` to govern the whole draw
   * (dec.liquid-glass-architecture, item 1).
   */
  private readonly layeredMaterials = new Set<THREE.Material>();
  /** Last layering state pushed to those materials; null forces a re-apply. */
  private glassLayeringActive: boolean | null = null;
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
  private reducedMotion = false;

  /**
   * Tier 1 pool (dec.liquid-glass-architecture, item 3). Built the first frame
   * `pool.amount` goes above 0 and torn straight back down when it returns to
   * 0, so the shipped configuration allocates no render targets and adds no
   * draw call.
   */
  private pool: PoolSurface | null = null;
  /** Last pool config pushed to the surface; null forces the next write. */
  private appliedPoolConfig: HeadPoolConfig | null = null;
  /** Radial profile of the loaded body; says how wide the hole in the water is. */
  private poolProfile: PoolProfile | null = null;
  /** Scroll travel accumulated since the last frame consumed it. */
  private scrollTravel = 0;
  private scrollProgress = 0;
  private lastEmergence = 0;

  /**
   * Interior glyph field (dec.liquid-glass-architecture, item 10). Sampled the
   * first frame `interior.count` goes above 0 and torn straight back down when
   * it returns to 0, so the shipped configuration reads no geometry, allocates
   * no buffers and adds no draw call.
   */
  private interiorGlyphs: InteriorGlyphField | null = null;
  /** Last interior config pushed to the field; null forces the next write. */
  private appliedInteriorConfig: HeadInteriorConfig | null = null;
  /** The body the glyphs hang inside, and the bone that carries them. */
  private interiorBody: InteriorBody | null = null;
  /** Reused frame-to-world matrix; recomposed once per frame, never allocated. */
  private readonly interiorFrameMatrix = new Matrix4();

  /**
   * Tier 3 carrier tracking (dec.liquid-glass-fluidity). The head-carrying
   * bone's world position last frame, and whether it has one yet. Sampled only
   * while `fluid.amount` is above 0, so a shipped head recomposes no matrix
   * and reads no bone.
   */
  private readonly fluidCarrierLast = new Vector3();
  private fluidCarrierSeeded = false;
  /** Reused carrier velocity, world units per second. Never reallocated. */
  private readonly fluidCarrierVelocity: [number, number, number] = [0, 0, 0];

  /**
   * Stage participants (dec.liquid-glass-participants). Built at mount from
   * one `querySelectorAll`; a document that marks nothing leaves the arrays
   * empty, installs no observer and costs one selector match for the life of
   * the page.
   */
  private stage: Stage | null = null;
  /** This frame's resolved colliders. Reused, never reallocated. */
  private readonly stageColliders: StageCollider[] = [];
  /** This frame's pool footprints, in the same slot order. */
  private readonly stageObstacles: PoolObstacle[] = [];
  /** Which participant produced slot `i`, so the reaction lands on it. */
  private readonly stageSlotOwner: number[] = [];
  /** Reaction offsets in CSS pixels, XY per participant. Grown on demand. */
  private stageOffsets = new Float64Array(0);

  /**
   * The bound lens (dec.liquid-glass-architecture, rung 3, items 4 and 5).
   * Built only once a host names a subtree, so nothing here loads a
   * rasteriser, allocates a texture or reads layout for a head that refracts
   * nothing. Either flavour: a rasterised snapshot everywhere, or live DOM
   * where Chromium's HTML-in-Canvas is detected.
   */
  private lens: LensSource | null = null;
  private lensSource: Element | null = null;
  private lensOptions: LensSourceOptions | undefined;
  /** The mounted canvas: the lens needs it to know which part of the page shows. */
  private canvas: HTMLCanvasElement | null = null;

  /**
   * Compositor glass (dec.liquid-glass-compositor), rung 2 of the backdrop
   * ladder. A gate like the pool's: at `compositor.amount: 0` neither the
   * layer nor the projector exists, so no DOM node is authored, no ancestor is
   * walked and no outline is ever computed.
   *
   * The projector is rebuilt with the avatar because it resolves and holds the
   * rig's bones; the hull class contract says a replaced avatar invalidates it.
   */
  private compositor: CompositorGlass | null = null;
  private appliedCompositorConfig: HeadCompositorConfig | null = null;
  private hullProjector: SilhouetteProjector | null = null;
  /**
   * Set once the layer has been asked for and refused, which means this engine
   * has no `backdrop-filter` or the canvas is not in a tree. Without it an open
   * gate re-enters the constructor on every frame for the life of the page.
   */
  private compositorUnavailable = false;

  constructor(options: EngineOptions) {
    this.options = options;

    this.sysRenderer = createRendererHost();
    this.sysBehavior = createBehaviorMachine();
    this.sysMotion = createMotionEngine();
    this.sysAudio = createAudioEngine();
    this.sysSpeech = createSpeechEngine(this.sysAudio);
    this.sysTextSkin = createTextSkinEngine();
    this.sysVfx = createVFXEngine();
    this.eyeTextSkin = createTextSkinEngine({ cols: 128, rows: 96, cellWidth: 10, cellHeight: 12, fontSize: 9 });
    this.sysAsset = createAssetLoader();

    const source: TextSkinSource = options.textSource ?? createDefaultTextSource();
    this.sysTextSkin.setSource(source);
    this.eyeTextSkin.setSource(source);
    if (options.headConfig) {
      this.sysVfx.setHeadConfig(options.headConfig);
    }

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
    // Accumulate travel rather than sampling position: a host may call this
    // several times between frames, and the pool wants the distance covered,
    // not the last hop.
    //
    // Non-finite input is dropped rather than clamped. `clamp01(NaN)` is NaN,
    // and a host dividing by a zero-height container produces exactly that;
    // once NaN reaches the height field the Laplacian spreads it to every
    // texel and the pool never recovers, with nothing logged anywhere.
    if (!Number.isFinite(progress)) return;
    const clamped = clamp01(progress);
    this.scrollTravel += Math.abs(clamped - this.scrollProgress);
    this.scrollProgress = clamped;
    this.sysBehavior.setScrollProgress(clamped);
  }

  setTextSkinSource(source: TextSkinSource): void {
    this.sysTextSkin.setSource(source);
    this.eyeTextSkin.setSource(source);
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

  /**
   * Name a subtree for the head to refract, or clear it with `null`
   * (dec.liquid-glass-architecture, rung 3, item 4).
   *
   * A hard gate, like the pool: with no source there is no rasteriser loaded,
   * no texture allocated, no layout read per frame and no lens term in the
   * shader, so the shipped head is reproduced exactly. Naming a subtree before
   * mount is allowed; the lens is built when the canvas arrives.
   *
   * Idempotent on the same arguments. A capture costs 10 to 150 ms of main
   * thread, and this is exactly the shape a framework effect with a missing
   * dependency array calls every render.
   */
  setLensSource(element: Element | null, options?: LensSourceOptions): void {
    if (this.disposed) return;
    if (element === this.lensSource && options?.rasterise === this.lensOptions?.rasterise) {
      return;
    }
    if (element && this.canvas && element.contains(this.canvas)) {
      // The head would be inside what it refracts. Rasterisers do not read
      // back WebGL canvases, so this is not a feedback loop so much as a
      // guaranteed hole in the snapshot, and it is always a mistake.
      console.warn(
        '[hologlyph] refract source contains the head canvas; the head cannot refract itself.',
      );
    }
    this.lensSource = element;
    this.lensOptions = options;
    this.teardownLens();
    this.buildLens();
  }

  captureLens(): void {
    this.lens?.capture();
  }

  refreshStage(): void {
    if (this.stage) {
      this.stage.refresh();
      return;
    }
    this.buildStage();
  }

  /**
   * Adopt whatever the host has marked (dec.liquid-glass-participants).
   *
   * One `querySelectorAll` over the canvas's own document. A page that marks
   * nothing ends here: no observer, no rect read, no transform, and every
   * per-frame branch below short-circuits on an empty participant list.
   */
  private buildStage(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const root = canvas.ownerDocument;
    if (!root) return;
    this.stage ??= createStage({ root, canvas });
    this.stage.refresh();
  }

  private teardownStage(): void {
    this.stage?.dispose();
    this.stage = null;
    this.stageColliders.length = 0;
    this.stageObstacles.length = 0;
    this.stageSlotOwner.length = 0;
    this.sysVfx.setStageColliders(this.stageColliders);
  }

  /**
   * Measure the marked elements, resolve them against the body, and push the
   * reaction back as CSS transforms (dec.liquid-glass-participants).
   *
   * Strictly read-then-write: `stage.measure()` is the only layout read in the
   * frame and `stage.write()` the only style write, with the whole solve
   * between them. Interleaving the two is what turns three marked elements
   * into three forced reflows.
   *
   * Returns the pool footprints, which the caller hands to the tier 1 surface.
   */
  private applyStage(): readonly PoolObstacle[] {
    const stage = this.stage;
    this.stageColliders.length = 0;
    this.stageObstacles.length = 0;
    this.stageSlotOwner.length = 0;
    if (!stage) {
      this.sysVfx.setStageColliders(this.stageColliders);
      return this.stageObstacles;
    }

    // Before the empty check, not after: `measure` is also where a coalesced
    // `MutationObserver` rescan is drained, so a page whose FIRST marker
    // arrived since the last frame would otherwise never adopt it. With
    // nothing marked it reads no layout and returns immediately.
    stage.measure();
    if (stage.participants.length === 0) {
      this.sysVfx.setStageColliders(this.stageColliders);
      return this.stageObstacles;
    }

    const profile = this.poolProfile;
    const camera = this.sysRenderer.camera;
    const projection = stageProjection(
      stage.canvasRect,
      camera.fov,
      camera.position.x,
      camera.position.y,
      camera.position.z,
    );
    const config = this.sysVfx.headConfig;
    const rootOffsetY = this.sysVfx.rootOffsetY;

    if (profile && projection.pixelsPerWorldUnit > 0) {
      const participants = stage.participants;
      for (let i = 0; i < participants.length; i++) {
        if (this.stageColliders.length >= FLUID_PARTICIPANT_MODES) break;
        const participant = participants[i];
        // Both markers claim a mode slot. A `data-hologlyph-body` element is
        // an obstacle that happens to be free to move: it displaces the same
        // liquid, and the flow it displaces is exactly the flow that pushes
        // it back. Only `stage.write` distinguishes them.
        if (!participant?.visible) continue;
        if (!participant.obstacle && !participant.buoyant) continue;
        if (!(participant.rect.width > 0) || !(participant.rect.height > 0)) continue;
        const box = projectRect(projection, participant.rect);
        const collider = stageCollider(box, { profile, rootOffsetY });
        if (!collider) continue;
        this.stageColliders.push(collider);
        this.stageSlotOwner.push(i);
        // The dent is expressed in the pool's own field units, where 1 is the
        // amplitude bound the surface clamps to, so an obstacle can never
        // punch the water through the global clip plane.
        const depth = Math.min(
          1,
          (collider.submerged / Math.max(1e-4, config.pool.bias)) * config.stage.displace,
        );
        if (depth > 0 && collider.poolHalfWidth > 0) {
          this.stageObstacles.push({
            x: collider.poolX,
            radius: collider.poolHalfWidth,
            depth,
          });
        } else {
          this.stageObstacles.push({ x: 0, radius: 0, depth: 0 });
        }
      }
    }

    this.sysVfx.setStageColliders(this.stageColliders);

    // The reaction reads the flow the VFX engine solved LAST frame, which is
    // the flow currently on screen. Reading this frame's would push the page
    // before the glass it is reacting to has been drawn.
    const count = stage.participants.length;
    if (this.stageOffsets.length < count * 2) this.stageOffsets = new Float64Array(count * 2);
    this.stageOffsets.fill(0);
    const flow = this.sysVfx.stageFlow;
    for (let slot = 0; slot < this.stageSlotOwner.length; slot++) {
      const owner = this.stageSlotOwner[slot];
      if (owner === undefined) continue;
      const [dx, dy] = fluidReaction(
        [flow[slot * 3] ?? 0, flow[slot * 3 + 1] ?? 0, flow[slot * 3 + 2] ?? 0],
        projection.pixelsPerWorldUnit,
        // `push` alone: the flow this reads was already scaled by
        // `stage.amount` when the mode was driven, and squaring the master
        // knob would make it read as a curve rather than a level.
        config.stage.push,
        config.stage.maxPush,
      );
      this.stageOffsets[owner * 2] = dx;
      this.stageOffsets[owner * 2 + 1] = dy;
    }
    stage.write(this.stageOffsets);

    return this.stageObstacles;
  }

  /**
   * Build the lens if a source and a canvas are both present. Idempotent and
   * safe to call before either exists.
   *
   * Two flavours, and the choice is made here rather than inside either one.
   * Where Chromium's HTML-in-Canvas is detected AND the host has already put
   * the subtree inside a `<canvas layoutsubtree>`, the live path uploads real
   * DOM every frame. Everywhere else, which is the normal case, the snapshot
   * path rasterises on demand exactly as before. A host-supplied rasteriser
   * always wins: naming one is an explicit choice of the snapshot path.
   *
   * Statically imported, and the lazy alternative was built and measured
   * rather than waved away. First-load gzip: 28.32 kB on `glass`, 30.93 kB
   * with this import, 30.21 kB with a dynamic one plus a 1.58 kB chunk pulled
   * on demand. Only 0.72 kB of the 2.61 kB this feature adds is actually
   * movable, because the rest is the material's lens nodes, the VFX binding
   * and this reconciler, all of which the entry needs anyway. That is under
   * the 0.9 kB the tier 1 pool already rejected for the same trade, and it
   * buys three race windows (dispose during load, a second `setLensSource`
   * during load, and a capture request arriving before the chunk resolves).
   *
   * The RASTERISER is the thing that must stay lazy, and it does: `page-lens`
   * reaches `@zumer/snapdom` through a dynamic import of an external optional
   * peer, so a consumer who never names a subtree neither ships nor installs
   * it.
   */
  private buildLens(): void {
    if (this.disposed || this.lens) return;
    const element = this.lensSource;
    const canvas = this.canvas;
    if (!element || !canvas) return;
    const rasterise = this.lensOptions?.rasterise;
    // A lens failure is not a mount failure: the head keeps rendering over the
    // live page exactly as it did before the source was named.
    const onError = (err: Error): void => {
      console.warn('[hologlyph] lens source failed; refraction stays off.', err);
      this.emitter.emit('error', err);
    };
    const live = rasterise === undefined ? resolveLiveLens(element) : null;
    if (live) {
      this.warnIfLensTrapsControls(element, canvas);
      this.lens = createElementLens({ element, canvas, source: live, onError });
    } else {
      this.lens = createPageLens({
        element,
        canvas,
        recaptureMs: this.sysVfx.headConfig.lens.recaptureMs,
        onError,
        ...(rasterise === undefined ? {} : { rasterise }),
      });
    }
    this.lens.capture();
  }

  /**
   * The live subtree stays interactive where it is LAID OUT, and hit-testing
   * follows that undistorted box, not the refracted pixels. A head canvas over
   * it therefore swallows every click meant for a control inside, and no
   * transform can reconcile the two because a lens is not affine.
   *
   * Overlap alone is normal and silent: refracting decorative live content is
   * the whole point, and there is nothing to warn about until a CONTROL is
   * caught under the distortion. The library cannot move the host's DOM, so
   * when one is, it says so.
   */
  private warnIfLensTrapsControls(element: Element, canvas: HTMLCanvasElement): void {
    if (!lensRegionsOverlap(documentRect(canvas), documentRect(element))) return;
    const trapped = countInteractiveDescendants(element);
    if (trapped === 0) return;
    console.warn(
      `[hologlyph] the head covers ${trapped} interactive control(s) inside the live refract source; hit-testing follows their undistorted layout box, so they are unreachable under the head.`,
    );
  }

  private teardownLens(): void {
    if (!this.lens) return;
    // Unbind BEFORE disposing: `setLens(null)` rebinds the placeholder, so the
    // sampler never holds a texture whose GPU resources have been freed.
    this.sysVfx.setLens(null);
    this.lens.dispose();
    this.lens = null;
  }

  /**
   * Tear the compositor layer and its projector down. Idempotent.
   *
   * Also clears `compositorUnavailable`, because the reasons the layer was
   * refused are properties of the canvas and its tree, and a teardown is
   * always followed either by the end of the engine or by a new canvas.
   */
  private teardownCompositorGlass(): void {
    this.compositor?.dispose();
    this.compositor = null;
    this.appliedCompositorConfig = null;
    this.compositorUnavailable = false;
    this.hullProjector = null;
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
    this.eyeTextSkin.dispose();
    this.disposeOverlayMeshes();
    this.teardownLens();
    this.teardownStage();
    this.teardownCompositorGlass();
    this.canvas = null;
    if (this.pool) {
      this.sysRenderer.scene.remove(this.pool.object);
      this.pool.dispose();
      this.pool = null;
    }
    this.poolProfile = null;
    this.disposeInteriorGlyphs();
    this.interiorBody = null;
    this.fluidCarrierSeeded = false;
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
      // A remount onto a different canvas invalidates the sample window, which
      // is measured against the canvas the lens was built with. It equally
      // invalidates the compositor layer, which is a DOM node parented next to
      // the OLD canvas: without this it would be left behind in the host page,
      // frosting a canvas that is no longer the head.
      if (this.canvas !== canvas) {
        this.teardownLens();
        this.teardownStage();
        this.teardownCompositorGlass();
      }
      this.canvas = canvas;
      this.buildLens();
      this.buildStage();

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
      this.applyHostBackdrop(host);

      // Start or suspend the loop from tab visibility and behaviour state.
      this.syncLoop();
      this.emitter.emit('ready', undefined);
    } catch (err) {
      if (generation !== this.mountGeneration) return;
      this.emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private replaceAvatar(candidateAvatar: LoadedAvatar): void {
    this.disposeOverlayMeshes();
    this.disposeInteriorGlyphs();
    this.interiorBody = null;
    // A new body is a new carrier: differencing the next pose against the old
    // avatar's would hand the fluid solver a teleport
    // (dec.liquid-glass-fluidity).
    this.fluidCarrierSeeded = false;
    if (this.avatar) {
      this.sysRenderer.scene.remove(this.avatar.root);
      this.avatar.dispose();
      this.avatar = null;
      this.disposeDisplacedMaterials();
    }
    this.avatar = candidateAvatar;

    this.sysRenderer.scene.add(this.avatar.root);
    this.sysMotion.attach(this.avatar);

    // The projector resolves and holds this rig's bones, so it dies with the
    // avatar it was built against (dec.liquid-glass-compositor). An asset with
    // no baked hull, or one whose joints do not resolve, leaves it null and
    // the compositor layer simply never becomes visible.
    const hull = this.avatar.silhouetteHull;
    if (hull) {
      const projector = new SilhouetteProjector(hull, this.avatar);
      this.hullProjector = projector.usable ? projector : null;
    } else {
      this.hullProjector = null;
    }

    let eyeFrame = { cx: 0.688, cy: 0.003, cz: 0 };
    this.avatar.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mn = Array.isArray(mesh.material) ? '' : mesh.material?.name || '';
      if (mn !== 'eye_sclera') return;
      const p = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (!p) return;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let i = 0; i < p.count; i++) {
        if (p.getX(i) <= 0) continue;
        sx += p.getX(i); sy += p.getY(i); sz += p.getZ(i); n++;
      }
      if (n > 0) eyeFrame = { cx: sx / n, cy: sy / n, cz: sz / n };
    });

    const skinMats = this.sysVfx.createSkinMaterial(this.sysTextSkin);
    const headMat = skinMats.front;
    let eyeballMat: THREE.Material | null = null;
    const getEyeballMat = () => {
      if (!eyeballMat) {
        eyeballMat = this.sysVfx.createEyeballMaterial(this.eyeTextSkin, eyeFrame);
      }
      return eyeballMat;
    };
    this.skinMaterial = headMat;
    this.displacedMaterials.clear();
    const allMeshes = new Set<THREE.Mesh>(this.avatar.morphMeshes);
    this.avatar.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) allMeshes.add(obj as THREE.Mesh);
    });

    // One allowance for the whole avatar: a rig of many individually legal
    // meshes must not add up to an unbounded synchronous stall.
    const thicknessBudget = createThicknessBudget();
    const bakedGeometries = new Set<THREE.BufferGeometry>();
    // The far wall is cloned from a mesh the glass skin actually dresses.
    // `morphMeshes[0]` is only guaranteed to carry canonical morphs, so on a
    // custom rig it can be the mouth cavity or an eye, which would clone the
    // wrong surface and sample zero thickness.
    let morphingBody: THREE.Mesh | null = null;
    let anyBody: THREE.Mesh | null = null;
    for (const mesh of allMeshes) {
      const original = mesh.material;
      const name = (Array.isArray(original) ? undefined : original?.name) as string | undefined;
      if (name === 'eye_iris') {
        mesh.visible = false;
        if (original && !Array.isArray(original) && original !== headMat && original !== eyeballMat) {
          this.displacedMaterials.add(original);
        }
        continue;
      }
      if (name === 'eye_sclera') {
        const mat = getEyeballMat();
        if (original && !Array.isArray(original) && original !== headMat && original !== mat) {
          this.displacedMaterials.add(original);
        }
        mesh.material = mat;
        mesh.renderOrder = 1;
        mat.transparent = true;
        mat.side = FrontSide;
        mat.depthTest = true;
        mat.depthWrite = true;
        continue;
      }
      if (name !== undefined && KEEP_MATERIALS.has(name)) continue;
      if (Array.isArray(original)) {
        for (const material of original) {
          if (material && material !== this.skinMaterial && material !== eyeballMat) {
            this.displacedMaterials.add(material);
          }
        }
        mesh.material = this.skinMaterial;
      } else if (original) {
        if (original !== this.skinMaterial && original !== eyeballMat) {
          this.displacedMaterials.add(original);
        }
        mesh.material = this.skinMaterial;
      } else {
        continue;
      }
      // Only the glass skin reads body thickness, and the raycast that fills
      // it is the costliest part of mask baking, so it runs here rather than
      // on every mesh in the scene. Instanced nodes share one geometry and one
      // attribute, so baking the second instance would only spend the shared
      // allowance and could overwrite a good bake with zeros.
      if (!bakedGeometries.has(mesh.geometry)) {
        bakedGeometries.add(mesh.geometry);
        bakeThickness(mesh, thicknessBudget);
      }
      if (!morphingBody && mesh.morphTargetInfluences) morphingBody = mesh;
      anyBody ??= mesh;
    }

    // Overlay passes cloned off the body mesh. Both track its pose, skeleton
    // and morph influences, so they deform with the face for free.
    //
    // Draw order, back to front (dec.liquid-glass-architecture, item 1):
    //   -1 interior   back-facing far wall, blended, no depth write
    //    0 mask       front surface depth only, no colour
    //    1 internals  eyeballs, mouth cavity, eye trim, culled by the mask
    //    2 skin       translucent front surface
    //
    // That ordering only holds if every layer is in one render list, because
    // three draws the whole opaque list before the transparent one and
    // `renderOrder` sorts only within a list. Moving the mask and the authored
    // internals across is observable in its own right: with the jaw open it
    // shifts the mouth cavity by about 15 luma over the aperture. So the move
    // is not unconditional. `applyGlassLayering` performs it only while the
    // interior pass has something to show, which keeps `glass.amount = 0`
    // pixel-identical to the look before this change.
    // Prefer a morph-bearing body mesh so the overlays deform with the face.
    const bodyMesh = morphingBody ?? anyBody;
    this.layeredMaterials.clear();
    this.glassLayeringActive = null;
    if (bodyMesh) {
      const occlusionMaskMaterial = new MeshBasicMaterial({
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
        blending: NoBlending,
        side: FrontSide,
      });
      this.occlusionMaskMesh = cloneOverlayMesh(bodyMesh, occlusionMaskMaterial, 0);
      this.interiorMesh = cloneOverlayMesh(bodyMesh, skinMats.interior, -1);
      this.layeredMaterials.add(occlusionMaskMaterial);
      const overlayParent = bodyMesh.parent ?? this.avatar.root;
      overlayParent.add(this.occlusionMaskMesh);
      overlayParent.add(this.interiorMesh);
    }

    this.avatar.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || mesh === this.occlusionMaskMesh || mesh === this.interiorMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isInternal =
        isEyeMesh(mesh) ||
        materials.some((m) => m?.name === 'mouth_interior' || m?.name === 'eye_trim');
      if (isInternal) {
        mesh.renderOrder = 1;
        for (const mat of materials) {
          if (!mat) continue;
          mat.depthTest = true;
          mat.depthWrite = true;
          // Already-transparent internals (the eyeball) keep their blending
          // and their list. Only the opaque ones move, and they move as a
          // straight write so the pixels they produce never change.
          if (mat.transparent) continue;
          mat.blending = NoBlending;
          this.layeredMaterials.add(mat);
        }
      } else {
        mesh.renderOrder = 2;
      }
    });

    // The pool needs to know how wide the hole in the water is at every
    // emergence, and that is a property of the rig, not a constant: a
    // replacement bust must not silently inherit the shipped one's waterline.
    // Bind-pose positions are enough. Emergence moves the body through the
    // plane but never rotates it, and the breathe is millimetric.
    //
    // Read through `getX/getY/getZ`, not off `.array`: a meshopt-compressed
    // GLB hands back an interleaved, quantised attribute whose raw buffer is
    // neither a flat XYZ stream nor in model units, and the profile would
    // silently describe a body nobody has.
    const profileSource = bodyMesh?.geometry.attributes.position;
    if (profileSource) {
      const flat = new Float32Array(profileSource.count * 3);
      for (let i = 0; i < profileSource.count; i++) {
        flat[i * 3] = profileSource.getX(i);
        flat[i * 3 + 1] = profileSource.getY(i);
        flat[i * 3 + 2] = profileSource.getZ(i);
      }
      this.poolProfile = poolRadialProfile(flat);
    } else {
      this.poolProfile = null;
    }
    this.interiorBody = bodyMesh ? resolveInteriorBody(bodyMesh, this.avatar) : null;

    this.applyGlassLayering();
  }

  /**
   * Build or tear down the tier 1 pool to match `pool.amount`.
   *
   * A gate, not a fade: at 0 there is no pool object, no render target pair
   * and no extra draw, so the approved look costs exactly what it did before
   * this change. Reconciled from the live config every frame for the same
   * reason `applyGlassLayering` is: `engine.vfx.setHeadConfig` is a public
   * surface that renders nothing itself.
   *
   * Loaded statically. A lazy chunk was built and measured: it moved only
   * 0.9 kB gzip off the first-load path, because rollup hoists everything the
   * chunk shares with the entry into a third file, and it split
   * `dist/hologlyph.js` into a stub plus that shared chunk. Not worth an
   * asynchronous build path and its three race windows for 0.9 kB.
   */
  private applyPoolLayer(): void {
    const config = this.sysVfx.headConfig.pool;
    const want = config.amount > 0;
    if (!want) {
      if (this.pool) {
        this.sysRenderer.scene.remove(this.pool.object);
        this.pool.dispose();
        this.pool = null;
      }
      return;
    }
    if (!this.pool) {
      this.pool = createPoolSurface(this.sysRenderer.gpuRenderer, config);
      this.sysRenderer.scene.add(this.pool.object);
      this.appliedPoolConfig = config;
      return;
    }
    // `normaliseHeadConfig` mints a frozen object per `setHeadConfig`, so
    // identity is a sound change test, and it keeps the tint out of a hex
    // parse on every single frame.
    if (config === this.appliedPoolConfig) return;
    this.appliedPoolConfig = config;
    this.pool.setConfig(config);
  }

  /**
   * Is the lens putting pixels on the glass right now?
   *
   * Contribution, not intent (dec.liquid-glass-rung-exclusion). A source the
   * host named whose snapshot has not resolved, or whose rasteriser would not
   * load at all, binds nothing and shows nothing, and must not be allowed to
   * stand a working rung down on the strength of an intention.
   *
   * `glassLayeringActive` is the third term and the least obvious. The lens
   * substitutes on the INTERIOR wall, which is the only pass deep enough to
   * replace what is behind the head, and `applyGlassLayering` hides that mesh
   * outright at `skin.glass.amount: 0` or on a rig with no body to clone. So a
   * bound texture with the glass off paints nothing, exactly as
   * `HeadLensConfig` documents, and suppressing rung 2 for it would leave the
   * head showing neither rung. Read rather than recomputed: it is the same
   * flag `applyGlassLayering` set earlier in this frame, so the two cannot
   * drift.
   */
  private lensContributing(): boolean {
    if (this.glassLayeringActive !== true) return false;
    return this.lens?.binding != null && this.sysVfx.headConfig.lens.amount > 0;
  }

  /**
   * Build or tear down the compositor glass layer to match `compositor.amount`
   * (dec.liquid-glass-compositor).
   *
   * A number gate, like the pool's: the layer is one `div` and a CSS string,
   * with no resource whose absence could be the gate instead. At 0 nothing
   * exists, so a page that never touches this config is byte-identical to the
   * build before the feature.
   *
   * The lens closes the same gate (dec.liquid-glass-rung-exclusion). Rungs 2
   * and 3 of the backdrop ladder both answer "what is behind the glass", so a
   * page that opens both must see exactly one, and it is the higher rung
   * because the host had to name a subtree to get it. Down this branch rather
   * than a hide, for the reason the amount gate takes it too: an invisible
   * `backdrop-filter` element still costs the compositor a backdrop capture on
   * every scroll, which is the expensive half of the feature.
   *
   * Returns null when there is nothing to sync this frame. An engine with no
   * `backdrop-filter` lands there permanently, and `compositorUnavailable`
   * is what stops it retrying the build sixty times a second: without it the
   * gate being open is enough to re-enter the constructor every frame, which
   * is a `CSS.supports` call and an ancestor walk per frame forever. The flag
   * is cleared by anything that could change the answer, which is a new canvas
   * or a teardown.
   */
  private applyCompositorGlass(): CompositorGlass | null {
    const config = this.sysVfx.headConfig.compositor;
    if (config.amount <= 0 || !this.canvas || this.lensContributing()) {
      if (this.compositor) {
        this.compositor.dispose();
        this.compositor = null;
        this.appliedCompositorConfig = null;
      }
      return null;
    }
    if (!this.compositor) {
      if (this.compositorUnavailable) return null;
      const built = createCompositorGlass({ canvas: this.canvas });
      if (!built) {
        this.compositorUnavailable = true;
        return null;
      }
      this.compositor = built;
      this.appliedCompositorConfig = config;
      built.setConfig(config);
      return built;
    }
    if (config !== this.appliedCompositorConfig) {
      this.appliedCompositorConfig = config;
      this.compositor.setConfig(config);
    }
    return this.compositor;
  }

  /**
   * Push this frame's silhouette to the layer.
   *
   * Called AFTER `render()`, on purpose and not as an afterthought. The
   * projector needs current bone world matrices and three refreshes the whole
   * graph at the top of its render; projecting first would either read last
   * frame's pose or duplicate that walk. Both the canvas backing store and a
   * style written here are committed by the same compositing step at the end
   * of the rAF callback, so the outline and the pixels it clips cannot
   * disagree by a frame, which is the edge tearing work item 3 warns about.
   *
   * The floor is the emergence clipping plane. `Plane` holds `normal . p +
   * constant = 0` with a `+Y` normal here, so the drawn half-space is
   * `y > -constant` and the waterline is `-constant`. Without it the layer
   * would frost the submerged part of the head, which is not drawn at all.
   */
  private syncCompositorGlass(glass: CompositorGlass): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (!this.hullProjector) {
      glass.sync(EMPTY_OUTLINE, 0);
      return;
    }
    // CSS pixels, not drawing-buffer pixels: `clip-path` is resolved against
    // the layer's border box, which is the canvas's CSS box.
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    const ok = this.hullProjector.update(
      this.sysRenderer.camera,
      width,
      height,
      -this.sysVfx.clippingPlane.constant,
    );
    glass.sync(this.hullProjector.xy, ok ? this.hullProjector.count : 0);
  }

  /**
   * Build or tear down the interior glyph field to match `interior.count`
   * (dec.liquid-glass-architecture, item 10).
   *
   * A number gate, like the pool's and unlike the lens's: the field is pure
   * computation over geometry the engine already holds, so there is no
   * resource whose absence could be the gate instead. At 0 the body's
   * positions are never read, no buffers are allocated and no object joins the
   * scene, so the shipped configuration is reproduced exactly.
   */
  private applyInteriorGlyphs(): void {
    const config = this.sysVfx.headConfig.interior;
    const body = this.interiorBody;
    if (config.count <= 0 || !body) {
      this.disposeInteriorGlyphs();
      return;
    }
    if (!this.interiorGlyphs) {
      const { positions, thickness } = readInteriorGeometry(body.mesh);
      const skinned = body.mesh as THREE.SkinnedMesh;
      this.interiorGlyphs = createInteriorGlyphField({
        positions,
        thickness,
        // Sites are sampled in the geometry's bind space; `bindMatrix` is the
        // first factor of three's own skinning chain, and `interiorFrame`
        // supplies the rest of it per frame.
        bindToFrame: body.bone ? skinned.bindMatrix : new Matrix4(),
        texture: this.sysTextSkin.texture,
        grid: { cols: DEFAULT_GRID.cols, rows: DEFAULT_GRID.rows },
        config,
      });
      this.sysRenderer.scene.add(this.interiorGlyphs.object);
      this.appliedInteriorConfig = config;
      return;
    }
    if (config === this.appliedInteriorConfig) return;
    this.appliedInteriorConfig = config;
    this.interiorGlyphs.setConfig(config);
  }

  /**
   * Recompose the frame the glyphs are carried by, in place.
   *
   * Exactly three's skinning chain for a vertex weighted wholly to one bone:
   * `modelMatrix * bindMatrixInverse * boneMatrixWorld * boneInverse`, applied
   * to a bind-space position. Nothing cheaper is correct, because the avatar
   * root translates with emergence while the bone matrices already contain
   * that translation.
   *
   * The world-matrix refreshes walk only the body's and the bone's own
   * ancestor chains, which is a handful of nodes on the shipped rig. Without
   * them the field would read matrices the renderer last refreshed a frame
   * ago, and the very first frame after activation would snap the glyphs to a
   * stale pose and spring them back, in full view.
   *
   * The body goes through `updateMatrixWorld`, NOT `updateWorldMatrix`. Only
   * the former is overridden by `SkinnedMesh`, and the override is what
   * refreshes `bindMatrixInverse` in `AttachedBindMode`. Refreshing just the
   * world matrix would pair this frame's `matrixWorld` with last frame's
   * inverse, and during emergence the root's travel would be applied a second
   * time: the field would trail or jump for reasons nothing to do with the
   * spring. The parents are walked first because `updateMatrixWorld` composes
   * against `parent.matrixWorld` and assumes it is already current.
   */
  private interiorFrame(body: InteriorBody): THREE.Matrix4 {
    if (!body.bone || !body.boneInverse) {
      body.mesh.updateWorldMatrix(true, false);
      return this.interiorFrameMatrix.copy(body.mesh.matrixWorld);
    }
    const skinned = body.mesh as THREE.SkinnedMesh;
    skinned.parent?.updateWorldMatrix(true, false);
    skinned.updateMatrixWorld(true);
    body.bone.updateWorldMatrix(true, false);
    return this.interiorFrameMatrix
      .multiplyMatrices(skinned.matrixWorld, skinned.bindMatrixInverse)
      .multiply(body.bone.matrixWorld)
      .multiply(body.boneInverse);
  }

  /** Tear the field down. Idempotent; the text-skin texture is not ours. */
  private disposeInteriorGlyphs(): void {
    if (!this.interiorGlyphs) return;
    this.sysRenderer.scene.remove(this.interiorGlyphs.object);
    this.interiorGlyphs.dispose();
    this.interiorGlyphs = null;
    this.appliedInteriorConfig = null;
  }

  /**
   * Switch the glass draw order on or off to match `skin.glass.amount`.
   *
   * The interior wall needs the mask and the authored internals in the same
   * render list as itself, and that move is observable through an open mouth
   * even when the interior draws nothing. So it happens only while the glass
   * is on. Called every frame and guarded on the last applied state, because
   * `engine.vfx.setHeadConfig` is a public surface that renders nothing itself:
   * reconciling from the live config is what makes the layering hold however
   * the amount was changed.
   */
  private applyGlassLayering(): void {
    // No interior pass means nothing needs the single-list ordering, so the
    // authored internals stay exactly where the avatar put them. A rig made
    // only of kept mouth and eye materials lands here.
    const active = this.interiorMesh !== null && this.sysVfx.headConfig.skin.glass.amount > 0;
    if (active === this.glassLayeringActive) return;
    this.glassLayeringActive = active;
    if (this.interiorMesh) this.interiorMesh.visible = active;
    for (const material of this.layeredMaterials) {
      material.transparent = active;
      material.needsUpdate = true;
    }
  }

  private applyMotionAndObservation(host: Element): void {
    const reduced = this.options.reducedMotion ?? this.prefersReducedMotion();
    this.reducedMotion = reduced;
    this.sysMotion.setReducedMotion(reduced);
    // Thread reduced motion into VFX and the text skin as well as motion
    // (dec.renderer-posture); the text skin pauses its row flow.
    this.sysVfx.setReducedMotion(reduced);
    this.sysTextSkin.setReducedMotion(reduced);
    this.eyeTextSkin.setReducedMotion(reduced);
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

  /**
   * Feed the host page's own background colour into the skin so the glass
   * stays legible on it (dec.glass-backdrop-adaptive). Explicitly configuring
   * `skin.backdrop.auto = false` keeps whatever colour the caller supplied.
   */
  private applyHostBackdrop(host: Element): void {
    const backdrop = this.sysVfx.headConfig.skin.backdrop;
    if (!backdrop.auto) return;
    const color = resolveBackdropColor(host, backdrop.color);
    if (color === backdrop.color) return;
    this.sysVfx.setHeadConfig({ skin: { backdrop: { color } } });
  }

  /**
   * Tear down the occlusion mask and interior overlay passes. Idempotent, and
   * safe to call before the avatar itself is disposed: the overlays only ever
   * borrow the primary mesh's geometry, so only their materials are owned.
   */
  private disposeOverlayMeshes(): void {
    for (const overlay of [this.occlusionMaskMesh, this.interiorMesh]) {
      if (!overlay) continue;
      overlay.removeFromParent();
      const mats = Array.isArray(overlay.material) ? overlay.material : [overlay.material];
      for (const mat of mats) mat?.dispose();
    }
    this.occlusionMaskMesh = null;
    this.interiorMesh = null;
    // The mask material is gone and the authored internals are about to be
    // disposed or re-collected, so holding either would pin textures for the
    // rest of a disposed engine's life.
    this.layeredMaterials.clear();
    this.glassLayeringActive = null;
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
    this.eyeTextSkin.update(dt);
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
    this.applyGlassLayering();
    this.applyPoolLayer();
    this.applyInteriorGlyphs();
    this.sysRenderer.setClippingPlane(this.sysVfx.clippingPlane);
    if (this.avatar) this.avatar.root.position.y = this.sysVfx.rootOffsetY;

    // Lens. Two layout reads a frame, and only while a host has named a
    // subtree: the sampled window has to follow the canvas wherever the page
    // puts it, and the source rect is what says a snapshot went stale.
    if (this.lens) {
      this.lens.sync(this.sysVfx.headConfig.lens.strength);
      this.sysVfx.setLens(this.lens.binding);
    }

    // Compositor glass, AFTER the lens and not before it
    // (dec.liquid-glass-rung-exclusion). The lens stands this rung down while
    // it is contributing, and both lens sources publish `binding` from inside
    // `sync()`, so reconciling first would gate this frame's layer on last
    // frame's lens and leave the frost up for a frame after a snapshot lands.
    const compositorGlass = this.applyCompositorGlass();

    // Stage participants (dec.liquid-glass-participants). Immediately after
    // the lens so both layout reads land in one batch, and before the pool
    // update that consumes the footprints it produces.
    const stageObstacles = this.applyStage();

    // Pool drive. Both inputs are speeds: how fast the page is moving and how
    // fast the body is crossing the plane. Travel is consumed here so a frame
    // that renders nothing cannot bank scroll into a later splash.
    const emergence = this.sysVfx.emergence;
    const scrollVelocity = dt > 0 ? this.scrollTravel / dt : 0;
    const emergenceVelocity = dt > 0 ? (emergence - this.lastEmergence) / dt : 0;
    if (this.pool) {
      const rootOffsetY = this.sysVfx.rootOffsetY;
      this.pool.update(dt, {
        rootOffsetY,
        waterlineRadius: this.poolProfile
          ? poolWaterlineRadius(this.poolProfile, rootOffsetY)
          : 0,
        drive: poolRippleDrive(scrollVelocity, emergenceVelocity, this.reducedMotion),
        obstacles: stageObstacles,
      });
    }
    this.scrollTravel = 0;
    this.lastEmergence = emergence;

    // While frozen, skip the motion update entirely: idle and gaze phase off
    // wall-clock time, so even dt=0 would keep breathing between frames.
    if (!this.motionFrozen) this.sysMotion.update(dt, this.elapsed);

    // After motion, so the field reads this frame's pose rather than last
    // frame's, and before the render that consumes the buffers it writes.
    if (this.interiorGlyphs && this.interiorBody) {
      this.interiorGlyphs.update(dt, {
        frameMatrix: this.interiorFrame(this.interiorBody),
        camera: this.sysRenderer.camera,
        reduced: this.reducedMotion,
      });
    }

    // Tier 3 fluidity drive (dec.liquid-glass-fluidity). Written at the end of
    // the frame, after motion, so the carrier velocity is this frame's pose;
    // `sysVfx.update` consumes it on the next tick, which costs one frame of
    // latency on an already damped spring and is not visible.
    //
    // Everything here is gated on the configured amount rather than on the
    // behaviour-gained one: at 0 no matrix is recomposed, no bone is read and
    // the solver is never entered.
    //
    // `interiorFrame` is reused rather than widening `MotionEngine` with a
    // readable pose. What it returns is the bind-to-world frame the interior
    // glyph field already needs, so its translation column is not literally
    // the head bone's world position; it is a world-space point that tracks
    // the carrier rigidly, which is exactly the signal a drag term wants.
    // Recomposing it twice in a frame is safe: the field reads `.elements`
    // synchronously and retains nothing.
    //
    // Emergence therefore reaches the solver twice, once as the saturated
    // drive and once as vertical carrier motion. That is wanted: a head
    // bursting out of the water should slosh harder than a scrolled one.
    if (this.sysVfx.headConfig.fluid.amount > 0) {
      const body = this.interiorBody;
      if (body && dt > 0) {
        const carrier = this.interiorFrame(body);
        const cx = carrier.elements[12] ?? 0;
        const cy = carrier.elements[13] ?? 0;
        const cz = carrier.elements[14] ?? 0;
        if (this.fluidCarrierSeeded) {
          this.fluidCarrierVelocity[0] = (cx - this.fluidCarrierLast.x) / dt;
          this.fluidCarrierVelocity[1] = (cy - this.fluidCarrierLast.y) / dt;
          this.fluidCarrierVelocity[2] = (cz - this.fluidCarrierLast.z) / dt;
        } else {
          // First sample after a mount or an avatar swap has no previous pose,
          // and differencing against the origin would fling the surface.
          this.fluidCarrierVelocity[0] = 0;
          this.fluidCarrierVelocity[1] = 0;
          this.fluidCarrierVelocity[2] = 0;
          this.fluidCarrierSeeded = true;
        }
        this.fluidCarrierLast.set(cx, cy, cz);
      } else {
        this.fluidCarrierVelocity[0] = 0;
        this.fluidCarrierVelocity[1] = 0;
        this.fluidCarrierVelocity[2] = 0;
      }
      this.sysVfx.setFluidDrive(
        this.sysBehavior.state,
        fluidDrive(scrollVelocity, emergenceVelocity, this.reducedMotion),
        this.fluidCarrierVelocity,
      );
    }
    this.sysRenderer.render();
    // After the render, so the projector reads the pose three just drew from.
    if (compositorGlass) this.syncCompositorGlass(compositorGlass);

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
    this.reducedMotion = event.matches;
    this.sysMotion.setReducedMotion(event.matches);
    // Mirror the reduced-motion preference into VFX and the text skin.
    this.sysVfx.setReducedMotion(event.matches);
    this.sysTextSkin.setReducedMotion(event.matches);
    this.eyeTextSkin.setReducedMotion(event.matches);
  };

  private prefersReducedMotion(): boolean {
    if (typeof matchMedia === 'undefined') return false;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
