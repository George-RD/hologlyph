/**
 * Shared cross-module contracts for hologlyph.
 *
 * This file is the ONLY permitted cross-container import surface besides the
 * edges declared in cairn.blueprint. Modules implement these interfaces and
 * are wired together by hologlyph.runtime.core.
 */
import type * as THREE from 'three';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type Listener<T> = (payload: T) => void;

export interface Emitter<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void;
  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void;
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
}

export interface Disposable {
  /** Release GPU/audio/DOM resources. Idempotent. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Behavior (dec.behavior-state-machine, dec.scroll-timeline)
// ---------------------------------------------------------------------------

export type BehaviorState =
  | 'hidden'
  | 'emerging'
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'thinking'
  | 'reacting-to-scroll'
  | 'departing';

export type BehaviorEvent =
  | { type: 'enter-viewport' }
  | { type: 'exit-viewport' }
  | { type: 'emerge-complete' }
  | { type: 'submerge-complete' }
  | { type: 'speech-start' }
  | { type: 'speech-end' }
  | { type: 'speech-stall' }
  | { type: 'listen-start' }
  | { type: 'listen-end' }
  | { type: 'scroll-active' }
  | { type: 'scroll-settled' };

export interface BehaviorMachineEvents extends Record<string, unknown> {
  transition: { from: BehaviorState; to: BehaviorState; event: BehaviorEvent };
}

export interface BehaviorMachine extends Emitter<BehaviorMachineEvents>, Disposable {
  readonly state: BehaviorState;
  dispatch(event: BehaviorEvent): void;
  /** Normalized [0,1] scroll progress computed in JS (never CSS timelines). */
  setScrollProgress(progress: number): void;
  readonly scrollProgress: number;
  /** Observe a host element: IntersectionObserver + ResizeObserver + visibility. */
  observe(host: Element): void;
}

// ---------------------------------------------------------------------------
// Motion & expressions (dec.expression-vocab)
// ---------------------------------------------------------------------------

export type Expression =
  | 'neutral'
  | 'friendly'
  | 'thinking'
  | 'agree'
  | 'concern'
  | 'happy'
  | 'surprised'
  | 'listening'
  | 'speaking';

export type NodClass = 'backchannel' | 'affirmative' | 'emphasis';

export type GazeMode = 'contact' | 'aversion' | 'idle';

/** Blendshape name -> weight, clamped [0,1]. */
export type BlendshapeWeights = Record<string, number>;

export interface VisemeFrame {
  /** Seconds from utterance audio start. */
  time: number;
  /**
   * Mouth-region weights for one frame. A viseme frame is a mouth *shape*, so
   * the library's own speech path emits a single viseme at full weight and
   * relies on MotionEngine's attack/release smoothing to cross-fade.
   *
   * The baked silhouette hull is an outer bound on that behaviour: at most two
   * mouth morphs significant at once. A frame that drives more is accepted and
   * rendered, but the hull can then under-cover the outline, so anything
   * clipping to it (the compositor glass layer) will fall short of the chin or
   * the lips. MotionEngine warns once when a frame exceeds it.
   */
  weights: BlendshapeWeights;
}

export interface MotionEngine extends Disposable {
  attach(avatar: LoadedAvatar): void;
  update(dt: number, elapsed: number): void;
  setExpression(expression: Expression, fadeSeconds?: number): void;
  /** Live viseme stream during speech; overrides mouth-region shapes. */
  applyVisemeFrame(frame: VisemeFrame): void;
  clearVisemes(): void;
  triggerNod(kind: NodClass): void;
  /** Additive head orientation target in radians, applied on top of nods/gaze; smoothed toward the target each update; reduced motion snaps or flattens per existing conventions. */
  setHeadTarget(yaw: number, pitch: number): void;
  setGazeMode(mode: GazeMode): void;
  setReducedMotion(reduced: boolean): void;
  /** Point the gaze at a normalised pointer position (NDC x,y in [-1,1]); eyes and a subtle head fraction follow it, damped, with automatic return-to-forward after the idle timeout or on `clearGazeFollow`. */
  setGazeTarget(ndcX: number, ndcY: number): void;
  /** Stop following the pointer; the gaze eases back to forward/idle without snapping. */
  clearGazeFollow(): void;
  /** Manual blink hold weight [0,1], overriding or augmenting procedural blink. */
  setBlinkHold(weight: number): void;
}

// ---------------------------------------------------------------------------
// Speech & audio (dec.speech-architecture)
// ---------------------------------------------------------------------------

export type SpeechMode = 'demo' | 'provider' | 'fallback';

export interface UtteranceEvents extends Record<string, unknown> {
  start: void;
  viseme: VisemeFrame;
  /** Coarse energy [0,1] for fallback jaw-open driving. */
  energy: number;
  stall: void;
  end: void;
  error: Error;
}

export interface UtteranceHandle extends Emitter<UtteranceEvents> {
  cancel(): void;
}

export interface TTSAdapter extends Disposable {
  readonly mode: SpeechMode;
  speak(text: string, audio: AudioEngine): UtteranceHandle;
}

export interface AudioEngine extends Disposable {
  /** Lazily created, single reused AudioContext (dec.performance-budget). */
  readonly context: AudioContext | null;
  /** Must be called from a user gesture before audio playback. */
  resumeFromGesture(): Promise<void>;
  /** Route a media element through the shared analyser chain. */
  connectElement(el: HTMLMediaElement): void;
  /** Release a media element's analyser routing after its utterance ends. */
  disconnectElement(el: HTMLMediaElement): void;
  /** RMS energy [0,1] of the currently connected source. */
  readEnergy(): number;
  suspend(): void;
}

export interface SpeechEngineEvents extends Record<string, unknown> {
  start: void;
  end: void;
  stall: void;
}

export interface SpeechEngine extends Emitter<SpeechEngineEvents>, Disposable {
  setAdapter(adapter: TTSAdapter): void;
  speak(text: string): Promise<void>;
  cancel(): void;
  readonly speaking: boolean;
}

// ---------------------------------------------------------------------------
// Assets (dec.asset-rig-schema)
// ---------------------------------------------------------------------------

/** Canonical shared-rig morph target names (VRM-like vocabulary). */
export const RIG_VISEME_MORPHS = [
  'viseme_sil',
  'viseme_aa',
  'viseme_ee',
  'viseme_ih',
  'viseme_oh',
  'viseme_ou',
  'viseme_pp',
  'viseme_ff',
  'viseme_th',
  'viseme_dd',
  'viseme_kk',
  'viseme_ch',
  'viseme_ss',
  'viseme_nn',
  'viseme_rr',
] as const;
 
/** Canonical tongue corrective morphs authored against the shipped tongue topology. */
export const RIG_TONGUE_MORPHS = ['tongue_up', 'tongue_out', 'tongue_back'] as const;

export const RIG_EXPRESSION_MORPHS = [
  'exp_happy',
  'exp_sad',
  'exp_surprised',
  'exp_angry',
  'exp_relaxed',
  'exp_blink',
  'exp_blink_l',
  'exp_blink_r',
  'exp_brow_up',
  'exp_brow_down',
  'jaw_open',
  'mouth_round',
] as const;

export const RIG_BONES = {
  root: 'root',
  head: 'head',
  neck: 'neck',
  eyeL: 'eye_l',
  eyeR: 'eye_r',
} as const;

/**
 * One rigidly-skinned piece of the baked silhouette hull
 * (dec.liquid-glass-architecture). Points are bind-space xyz triples; the
 * runtime transforms them by `bone.matrixWorld * inverseBind`, exactly as
 * three skins a vertex weighted wholly to that joint.
 */
export interface SilhouetteHullGroup {
  readonly joint: string;
  /** Column-major inverse bind matrix for `joint`. */
  readonly inverseBind: readonly number[];
  /** Flat xyz triples in bind space. */
  readonly points: readonly number[];
}

/**
 * Low-poly outline hull baked beside the avatar geometry. It is an outer bound
 * on every position the rig can reach, so the 2D convex hull of its projected
 * points contains the rendered silhouette at any pose.
 */
export interface SilhouetteHull {
  readonly version: number;
  readonly groups: readonly SilhouetteHullGroup[];
  /** Joints the bake proved stay inside the hull; carried for provenance. */
  readonly containedJoints: readonly string[];
}

export interface LoadedAvatar extends Disposable {
  readonly root: THREE.Group;
  /** Meshes carrying the canonical morph targets. */
  readonly morphMeshes: THREE.Mesh[];
  readonly bones: Partial<Record<keyof typeof RIG_BONES, THREE.Bone>>;
  readonly animations: THREE.AnimationClip[];
  /** Baked outline hull, when the asset carries one. */
  readonly silhouetteHull?: SilhouetteHull | null;
  /** Set a canonical morph weight across all morph meshes, clamped [0,1]. */
  setMorph(name: string, weight: number): void;
  getMorph(name: string): number;
}

export interface AssetLoader extends Disposable {
  load(url: string): Promise<LoadedAvatar>;
  /**
   * Hand the loader the live renderer so KTX2 transcoding support can be
   * detected (KTX2Loader.detectSupport). Optional: plain GLBs load without it.
   */
  attachRenderer?(renderer: unknown): void;
}

// ---------------------------------------------------------------------------
// Text skin (dec.text-skin)
// ---------------------------------------------------------------------------

export interface TextSkinSource {
  /** Current full text content of the skin. */
  getText(): string;
  /** Subscribe to content changes; returns unsubscribe. */
  onChange(fn: () => void): () => void;
}

export interface TextSkinEngine extends Disposable {
  /** CanvasTexture uploaded only on content change; scroll is GPU UV motion. */
  readonly texture: THREE.CanvasTexture;
  setSource(source: TextSkinSource): void;
  /** UV scroll speed in texture-heights per second (consumed by the shader). */
  setScrollSpeed(speed: number): void;
  readonly scrollSpeed: number;
  /** Advance internal time; cheap, no canvas redraw. */
  update(dt: number): void;
  /** Elapsed scroll phase for the shader uniform. */
  readonly scrollOffset: number;
  /** Pause the row flow under a reduced-motion preference. */
  setReducedMotion(reduced: boolean): void;
}

// ---------------------------------------------------------------------------
// Shaders / VFX (dec.renderer-posture)
// ---------------------------------------------------------------------------
export interface SkinOpacityConfig {
  readonly base: number;
  readonly lips: number;
  readonly nose: number;
  readonly jaw: number;
  readonly orbit: number;
  readonly brow: number;
  readonly socketMask: number;
}

export interface SkinShadingConfig {
  readonly socketShadow: number;
  readonly socketSize: number;
  readonly cavity: number;
  readonly lipDark: number;
  readonly lipHue: number;
  readonly lipGate: number;
  readonly eyelid: number;
  readonly brow: number;
  readonly browGate: number;
}

export interface SkinGlyphConfig {
  readonly scale: number;
  readonly horizontalDensity: number;
  readonly verticalDensity: number;
  readonly sharpness: number;
}

export interface SkinToneConfig {
  readonly balance: number;
  readonly amount: number;
  readonly skinWarmth: number;
  readonly rim: number;
  readonly glowGain: number;
}

/**
 * View-dependent glass response. All terms are backdrop-independent: they
 * describe how the surface behaves as a refractive shell, not how it reacts to
 * the page behind it (see `SkinBackdropConfig` for that).
 */
export interface SkinGlassConfig {
  /** Master mix of every glass term; 0 restores the flat translucent skin. */
  readonly amount: number;
  /** Opacity added at grazing angles so the silhouette thickens like glass. */
  readonly fresnel: number;
  /** Fresnel falloff exponent; higher keeps the effect nearer the silhouette. */
  readonly fresnelPower: number;
  /** Key-light specular intensity. */
  readonly specular: number;
  /** Specular lobe tightness. */
  readonly sheen: number;
  /** Grazing-angle displacement of the sampled glyph coordinates, world units. */
  readonly refraction: number;
  /** Hex body tint of the glass, used for the specular highlight. */
  readonly tint: string;
}

/**
 * Host page background awareness (dec.glass-backdrop-adaptive). The canvas is
 * transparent, so the page shows through the head; these values tell the skin
 * what it is sitting on so glyphs stay legible on any backdrop.
 */
export interface SkinBackdropConfig {
  /** Effective host page background as a `#rrggbb` hex colour. */
  readonly color: string;
  /** Adaptation strength; 0 pins the dark-page look on every backdrop. */
  readonly adapt: number;
  /** Sample the host element's computed background colour on mount. */
  readonly auto: boolean;
}

/**
 * Tier 1 liquid surface (`dec.liquid-glass-architecture`): the pool the bust
 * emerges from. A damped height field simulated on the GPU, an analytic
 * meniscus where the body crosses the waterline, and a bounded outward
 * breathe on the shell itself.
 *
 * `amount` is a hard gate, not a fade: at 0 the engine builds no pool objects,
 * allocates no render targets and leaves every material graph evaluating to
 * the shipped look, so the approved configuration is reproduced exactly.
 */
export interface HeadPoolConfig {
  /** Master mix; 0 builds no pool at all and is the shipped default. */
  readonly amount: number;
  /**
   * Rest height of the surface above the waterline, world units. The global
   * clip plane discards everything below world Y 0, so this bias is also the
   * bound on how far a trough may travel down before it would be clipped.
   */
  readonly bias: number;
  /** Ring-wave amplitude injected per unit of scroll or emergence drive. */
  readonly ripple: number;
  /** Meniscus pull-up at the contact contour, as a fraction of `bias`. */
  readonly meniscus: number;
  /** Brightness of the bright contact ring at the contour. */
  readonly contact: number;
  /** Outward-only shell breathe amplitude, world units. */
  readonly breathe: number;
  /** Height of the band above the waterline over which internals fade out. */
  readonly fade: number;
  /** Hex body tint of the water. */
  readonly tint: string;
}

/**
 * Sparse glyphs suspended inside the glass (`dec.liquid-glass-architecture`,
 * item 10). A few hundred camera-facing sprites sampling cells of the same
 * text-skin canvas the surface samples, placed in the interior volume by the
 * baked thickness field and dragged off course when the head moves.
 *
 * The point is to make the block read as full of text rather than coated in
 * it, so the field is deliberately sparse and deliberately dim: it is a hint
 * of depth, not a second face and not a snow globe.
 *
 * `count` is a hard gate, not a fade: at 0 nothing is sampled, nothing is
 * allocated and no object joins the scene, so the shipped configuration is
 * reproduced exactly.
 */
export interface HeadInteriorConfig {
  /** Glyphs to suspend, capped at `INTERIOR_GLYPH_MAX`. 0 builds nothing. */
  readonly count: number;
  /** Sprite half-size in world units. The bust is about 1 unit tall. */
  readonly size: number;
  /**
   * Slow drift amplitude in world units, so the field never looks frozen
   * while the head is still. Damped under a reduced-motion preference.
   */
  readonly drift: number;
  /**
   * How far the glyphs lag the head, in [0,1]. 0 pins them to the rig
   * exactly; 1 leaves them wallowing seconds behind a turn. Reduced motion
   * forces 0, because the lag IS the shake response.
   */
  readonly inertia: number;
  /**
   * Share of brightness lost between the nearest and the farthest glyph in
   * the field. This is what makes the cloud read as depth rather than as
   * confetti spread across one plane.
   */
  readonly depthFade: number;
  /**
   * Peak brightness as a fraction of the sampled canvas glyph. Clamped to 1
   * so an interior glyph can never outshine the surface text it sits behind.
   */
  readonly brightness: number;
  /** Hex tint of the suspended glyphs. */
  readonly tint: string;
}

/**
 * Tier 3 fluidity (`dec.liquid-glass-fluidity`): how molten the body behaves.
 * The head stays the head; a damped modal solver on the CPU writes a flow
 * vector, and the shader bulges the shell one-sidedly along it, weighted so
 * the base and shoulders flow while the mouth and eyes stay crisp.
 *
 * `amount` is a hard gate, not a fade: at 0 the displacement term multiplies
 * out to exactly zero, the shading normal stays on the shipped chain and the
 * solver is never integrated, so the approved configuration is reproduced
 * exactly.
 */
export interface HeadFluidConfig {
  /** Master fluidity; 0 is rigid and is the shipped default, 1 is molten. */
  readonly amount: number;
  /**
   * Resting droop in world units, held by gravity against the mode. Read at
   * full fluidity in the flowing band, and scaled down by both `amount` and
   * the spatial weight everywhere else.
   */
  readonly sag: number;
  /** Gain on the response to scroll, emergence and carrier motion. */
  readonly wobble: number;
  /**
   * Stiffness of the mode in [0,1]. Stiffness is the liquidity: 1 twitches and
   * settles like a solid with a skin on it, 0 wallows.
   */
  readonly tension: number;
  /**
   * How hard the baked feature regions refuse to flow, as an exponent on the
   * face weight. Higher keeps more of the face rigid.
   */
  readonly crisp: number;
  /**
   * Height above the waterline, world units, over which the flow dies away.
   * The bust is about 1.8 tall, so this is what keeps the swell in the base
   * and the shoulders.
   */
  readonly reach: number;
}

/**
 * The melt (`dec.liquid-glass-melt`): the head collapsing to a puddle and
 * rising back. A displacement on the real bust, a function of bind-space
 * height alone, so the rig, the authored visemes, the glyphs and the glass all
 * survive it and it runs on WebGL2.
 *
 * This supersedes `fluid` as the liquid direction. Tier 3's modal solver was
 * judged on 2026-07-27 and read as a gravity bulge rather than as liquid
 * (`src.owner-look-2026-07-27`); a shape change is what was actually wanted.
 *
 * `amount` is a hard gate, not a fade: at 0 the map is an exact identity, the
 * shading normal stays on the shipped chain, and the approved configuration is
 * reproduced bit for bit rather than approximated.
 *
 * The melt runs in BIND space, so a head that is yawed carries its puddle
 * round with it. That is a known limit of the spike, not a bug to work around
 * in a host (`dec.liquid-glass-melt`, Consequences).
 */
export interface HeadMeltConfig {
  /** Master gate; 0 is the shipped head, bit for bit. */
  readonly amount: number;
  /**
   * Radial spread at the crown when fully melted, as a multiple of the bind
   * radius. Not volume conserving: this is a look control tuned by eye.
   */
  readonly spread: number;
  /**
   * Puddle thickness as a fraction of the bust's bind height: the height above
   * the base of the plane the fully melted body collapses onto.
   */
  readonly floor: number;
  /**
   * How far the crown lags the base. 0 melts every height together, which
   * reads as the head shrinking rather than pooling.
   */
  readonly lag: number;
}

/**
 * Stage participants (`dec.liquid-glass-participants`): the opt-in contract
 * that lets the fluid touch the page. A host marks elements it already owns
 * with `data-hologlyph-obstacle` (the fluid is squeezed by it) or
 * `data-hologlyph-body` (the fluid pushes it around); everything here is the
 * strength of that coupling.
 *
 * The PARTICIPANTS are the gate, not `amount`: a page that marks nothing has
 * no rect to read, no mode to integrate and no transform to write, so the
 * drop-in head is reproduced exactly and `amount` can default to 1 the way
 * `lens.amount` does.
 */
export interface HeadStageConfig {
  /** Master strength of the coupling in both directions. */
  readonly amount: number;
  /**
   * World units of flow the body holds per world unit an obstacle overlaps
   * it. This is how hard the head is squeezed by page furniture.
   */
  readonly squeeze: number;
  /**
   * Half-width of the Gaussian band each participant's mode acts over, world
   * units: the weight is `exp(-((y - centre) / band)^2)`, so the mode has
   * faded to a third of its peak at `band` and to nothing by twice it.
   *
   * Sized against the measured rig, not against `BUST_HEIGHT`, which is the
   * emergence travel and not the geometry: the shipped bust's head spans
   * roughly one world unit from jaw to crown. The default puts the effective
   * band at about that, which is what makes a shoulder-height obstacle
   * squeeze the shoulder rather than the crown.
   */
  readonly band: number;
  /**
   * Reaction on the participant, as a fraction of the flow it caused. 1 moves
   * the element exactly as far as the body bulged; 0 leaves the page still.
   */
  readonly push: number;
  /** Hard cap on that reaction, CSS pixels. Page layout must stay legible. */
  readonly maxPush: number;
  /**
   * Depth of the dent a submerged participant holds in the tier 1 pool, as a
   * fraction of `pool.bias`. The pool clamps its own waves to that bias, so
   * expressing the dent in the same unit keeps an obstacle from punching the
   * surface through the clip plane.
   */
  readonly displace: number;
}

/**
 * One measured participant, resolved into the scene
 * (`dec.liquid-glass-participants`). Produced by the core stage from a DOM
 * rect and consumed by the VFX engine and the pool; neither of those ever
 * sees an `Element`.
 */
export interface StageCollider {
  /**
   * Bind-space height at which this participant acts, world units. Bind
   * space, not world: the shader weights the mode against `positionLocal`,
   * which the emergence ramp translates rather than deforms.
   */
  readonly bandY: number;
  /**
   * Unit direction the body piles along, world space. It points from the
   * obstacle toward the body axis, because that is the side the liquid is
   * squeezed out to.
   */
  readonly direction: readonly [number, number, number];
  /** How far the participant reaches inside the body, world units. */
  readonly overlap: number;
  /** World X of the participant's centre, for the pool footprint. */
  readonly poolX: number;
  /** Half-width of that footprint, world units. */
  readonly poolHalfWidth: number;
  /** How far the participant reaches below the waterline, world units. */
  readonly submerged: number;
}

/**
 * Opt-in true lensing of a host-named subtree (`dec.liquid-glass-architecture`,
 * rung 3, item 4). No browser API hands rendered page pixels to WebGL, so the
 * only cross-engine route to per-pixel refraction is to rasterise a subtree
 * the host names, upload it as a texture and sample it displaced by the
 * head's normals and thickness (`res.dom-backdrop-capture`).
 *
 * Two things gate this, and both must hold: a source element the host named,
 * and `amount` above 0. With no source there is no rasteriser loaded, no
 * texture and no lens term, which is the shipped state.
 *
 * It also rides the glass. The substitution happens on the interior wall,
 * which is the deepest pass and the only one that can replace what is behind
 * the head, and that pass exists only while `skin.glass.amount` is above 0.
 * Turning the glass off turns the lens off with it.
 *
 * It also stands rung 2 down, but only while it is actually painting: the
 * glass on, a source bound, and `amount` above 0. Then the engine removes the
 * compositor layer, because the two rungs answer the same question and a page
 * showing both sees the backdrop twice at two different offsets
 * (`dec.liquid-glass-rung-exclusion`). A source that never captures does not
 * count, and neither does one behind `skin.glass.amount: 0` by the paragraph
 * above: the test is pixels, not intent.
 *
 * The staleness and CORS contract is inherent, not a defect to hide: content
 * behind the head is frozen between captures, cross-origin images need CORS
 * headers or they rasterise blank, `position: fixed` subtrees are typically
 * excluded, and the first capture costs 10 to 150 ms of main thread.
 */
export interface HeadLensConfig {
  /** Mix of the lensed snapshot over the live page; 0 leaves the page alone. */
  readonly amount: number;
  /**
   * Peak sample displacement at unit body thickness, in canvas heights.
   * Negative flips the bend, which is the difference between the head reading
   * as a converging lens and as a diverging one.
   */
  readonly strength: number;
  /**
   * Stillness, in milliseconds, before a moved sample window recaptures. Read
   * when the source is named, so changing it later takes effect on the next
   * `setLensSource`, not immediately.
   */
  readonly recaptureMs: number;
}

/**
 * Affine map from three's `screenUV` to snapshot texture UV. `scaleV` is
 * negative: `screenUV.y` grows downward from the top of the canvas, and a
 * texture uploaded with three's default `flipY` has `v = 1` at the top.
 */
export interface LensWindow {
  readonly offsetU: number;
  readonly offsetV: number;
  readonly scaleU: number;
  readonly scaleV: number;
}

/** Everything the glass materials need to sample a page snapshot. */
export interface LensBinding {
  readonly texture: THREE.Texture;
  readonly window: LensWindow;
  /** Per-axis displacement in `screenUV` units, at unit thickness. */
  readonly displacement: readonly [number, number];
}

/**
 * Compositor glass (`dec.liquid-glass-compositor`, `dec.liquid-glass-architecture`
 * item 6): rung 2 of the backdrop ladder. A `backdrop-filter` layer behind the
 * transparent canvas, confined to the projected silhouette by `clip-path`, so
 * genuinely live page content shows inside the head. Unlike either lens rung
 * this needs no rasteriser and no texture upload, so it carries video,
 * animation and cross-origin images for free, and unlike either lens rung it
 * can only frost and tint: there is no per-pixel refraction in CSS.
 *
 * `amount` is the gate. At 0 no element is created, no ancestor is inspected
 * and no `clip-path` string is ever built, so a page that leaves it alone is
 * byte-identical to the build before this feature existed.
 *
 * The host contract, measured in `tools/smoke/backdrop-root-spike.mjs`: no
 * ancestor of the canvas may carry `opacity` below 1, a clipping `overflow`
 * with a rounded corner, or a `filter` / `backdrop-filter` / `mask`. Any of
 * those promotes a backdrop root above the layer and the frost samples
 * nothing. The engine warns once naming the element rather than failing.
 *
 * `amount` is no longer the only thing that decides whether the layer exists.
 * The lens closes this gate too, so the rule is "the compositor layer shows
 * unless the lens is showing" (`dec.liquid-glass-rung-exclusion`). A host that
 * wants the frost while a subtree is named should drop the source rather than
 * mix the lens out, which keeps paying for captures nobody looks at.
 */
export interface HeadCompositorConfig {
  /** Master gate; 0 installs no layer at all. */
  readonly amount: number;
  /** Backdrop blur radius, CSS pixels. */
  readonly blur: number;
  /** Backdrop saturation, 1 leaves the page's own colours alone. */
  readonly saturate: number;
  /** Body tint painted over the frost, `#rrggbb`. */
  readonly tint: string;
  /** Opacity of that tint at `amount` 1. */
  readonly tintOpacity: number;
}

export interface HeadSkinConfig {
  readonly opacity: SkinOpacityConfig;
  readonly shading: SkinShadingConfig;
  readonly glyph: SkinGlyphConfig;
  readonly tone: SkinToneConfig;
  readonly glass: SkinGlassConfig;
  readonly backdrop: SkinBackdropConfig;
}

export interface HeadEyeConfig {
  readonly density: number;
  readonly scleraGlow: number;
  readonly irisGlow: number;
  readonly presence: number;
  readonly pupil: number;
  readonly flowDirection: number;
  readonly irisSize: number;
  readonly irisColor: string;
  readonly scleraColor: string;
}

export interface HeadConfig {
  readonly skin: HeadSkinConfig;
  readonly eyes: HeadEyeConfig;
  readonly pool: HeadPoolConfig;
  readonly interior: HeadInteriorConfig;
  readonly lens: HeadLensConfig;
  readonly fluid: HeadFluidConfig;
  readonly melt: HeadMeltConfig;
  readonly stage: HeadStageConfig;
  readonly compositor: HeadCompositorConfig;
}

export type HeadConfigOverrides = {
  skin?: {
    opacity?: Partial<SkinOpacityConfig>;
    shading?: Partial<SkinShadingConfig>;
    glyph?: Partial<SkinGlyphConfig>;
    tone?: Partial<SkinToneConfig>;
    glass?: Partial<SkinGlassConfig>;
    backdrop?: Partial<SkinBackdropConfig>;
  };
  eyes?: Partial<HeadEyeConfig>;
  pool?: Partial<HeadPoolConfig>;
  interior?: Partial<HeadInteriorConfig>;
  lens?: Partial<HeadLensConfig>;
  fluid?: Partial<HeadFluidConfig>;
  melt?: Partial<HeadMeltConfig>;
  stage?: Partial<HeadStageConfig>;
  compositor?: Partial<HeadCompositorConfig>;
};

export const DEFAULT_HEAD_CONFIG: HeadConfig = Object.freeze({
  skin: Object.freeze({
    opacity: Object.freeze({
      base: 0.075,
      lips: 0.32,
      nose: 0.38,
      jaw: 0.21,
      orbit: 0.15,
      brow: 0,
      socketMask: 0,
    }),
    shading: Object.freeze({
      socketShadow: 0,
      socketSize: 1,
      cavity: 0.45,
      lipDark: 0.5,
      lipHue: 0.6,
      lipGate: 1.4,
      eyelid: 0.5,
      brow: 0.3,
      browGate: 2.2,
    }),
    glyph: Object.freeze({
      scale: 0.79,
      horizontalDensity: 2,
      verticalDensity: 2,
      sharpness: 5.5,
    }),
    tone: Object.freeze({
      balance: 0.21,
      amount: 0.65,
      skinWarmth: 0,
      rim: 0.065,
      glowGain: 0.55,
    }),
    glass: Object.freeze({
      amount: 1,
      fresnel: 0.65,
      fresnelPower: 2.6,
      specular: 0.55,
      sheen: 40,
      refraction: 0.03,
      tint: '#bfe6ff',
    }),
    backdrop: Object.freeze({
      color: '#05070d',
      adapt: 1,
      auto: true,
    }),
  }),
  eyes: Object.freeze({
    density: 300,
    scleraGlow: 0.51,
    irisGlow: 2.35,
    presence: 0.74,
    pupil: 0.24,
    flowDirection: 1,
    irisSize: 0.43,
    irisColor: '#d78bf8',
    scleraColor: '#e1edf9',
  }),
  pool: Object.freeze({
    amount: 0,
    bias: 0.04,
    ripple: 1,
    meniscus: 0.55,
    contact: 0.7,
    breathe: 0.006,
    fade: 0.14,
    tint: '#4f8fbf',
  }),
  // Every non-zero value here is a lab starting point, not an approved look.
  // `count: 0` is what ships, so none of them is reached until somebody moves
  // the slider.
  interior: Object.freeze({
    count: 0,
    size: 0.02,
    drift: 0.008,
    inertia: 0.55,
    depthFade: 0.65,
    brightness: 0.55,
    tint: '#9fe7ff',
  }),
  // A source element is the hard gate, not this number: with nothing named to
  // rasterise the engine binds no texture and the materials evaluate the
  // shipped look exactly. So `refract="#hero"` alone is enough to switch the
  // lens on, and `amount` stays a strength dial.
  lens: Object.freeze({
    amount: 1,
    strength: 0.06,
    recaptureMs: 250,
  }),
  // As with the pool and the interior field, every non-zero value here is a
  // lab starting point. `amount: 0` is what ships, and at 0 the material graph
  // is the approved look bit for bit (dec.liquid-glass-fluidity).
  fluid: Object.freeze({
    amount: 0,
    sag: 0.05,
    wobble: 1,
    tension: 0.55,
    crisp: 2,
    reach: 0.6,
  }),
  // The liquid direction (dec.liquid-glass-melt), and gated exactly as the
  // others are: at `amount: 0` the map is an exact identity, so this block
  // moves nothing until an owner ruling says it should. The rest are lab
  // starting points tuned by eye, not physical constants.
  //
  // Literals, not the `MELT_*` constants: this file is the contract spine and
  // may not import from a runtime module. `test/shaders-melt.test.ts` pins the
  // two against each other so they cannot drift apart silently.
  melt: Object.freeze({
    amount: 0,
    spread: 1.6,
    floor: 0.06,
    lag: 0.55,
  }),
  // Marked participants are the gate, so these are live the moment a host
  // writes `data-hologlyph-obstacle` on something, and inert on every page
  // that does not (dec.liquid-glass-participants).
  stage: Object.freeze({
    amount: 1,
    squeeze: 0.5,
    band: 0.45,
    push: 0.6,
    maxPush: 24,
    displace: 1,
  }),
  // Rung 2 of the backdrop ladder (dec.liquid-glass-compositor). `amount: 0`
  // is what ships: the layer is real page content and the look has not been
  // judged, so the same owner gate the pool and the fluid wait behind applies
  // here. Every other value is a lab starting point.
  compositor: Object.freeze({
    amount: 0,
    blur: 18,
    saturate: 1.6,
    tint: '#bfe6ff',
    tintOpacity: 0.12,
  }),
});

/**
 * The two draw passes that make up the glass body: the front surface and the
 * back-facing interior wall rendered behind it (dec.liquid-glass-architecture,
 * item 1). Every uniform the interior consumes is the node the front consumes,
 * so look changes drive both at once; front-only terms such as the rim have no
 * meaning on an inside face and are absent from it.
 */
export interface SkinMaterials {
  readonly front: THREE.Material;
  readonly interior: THREE.Material;
  /**
   * Depth-only occlusion mask for the body. Built alongside the two visible
   * passes because it must carry the same vertex displacement they do: a rigid
   * mask behind a melting body would show the mouth cavity and the eyeballs
   * through the puddle (`dec.liquid-glass-melt`).
   */
  readonly mask: THREE.Material;
}

export interface VFXEngine extends Disposable {
  /** Build the single-source TSL text-skin materials for the bust. */
  createSkinMaterial(skin: TextSkinEngine): SkinMaterials;
  /** Build the TSL eyeball material for the sclera cap. */
  createEyeballMaterial(eyeSkin: TextSkinEngine, frame: { cx: number; cy: number; cz: number }): THREE.Material;
  /** Convert an authored standard material and bind the shared melt map. */
  createMeltedStandardMaterial(material: THREE.MeshStandardMaterial): THREE.Material;
  /** Live look controls. */
  setHeadConfig(config: HeadConfigOverrides): void;
  readonly headConfig: HeadConfig;
  /** Emergence progress [0,1]: 0 = fully submerged, 1 = fully emerged. */
  setEmergence(progress: number): void;
  readonly emergence: number;
  /** Root Y translation for the current emergence (pairs with clip plane). */
  readonly rootOffsetY: number;
  readonly clippingPlane: THREE.Plane;
  /**
   * Bind (or clear with `null`) the page snapshot the glass refracts. Clearing
   * closes the lens term outright rather than fading it: with no texture there
   * is nothing to sample, so `skin.lens.amount` alone must never switch it on.
   */
  setLens(lens: LensBinding | null): void;
  /**
   * Feed the tier 3 modal solver for the coming frame
   * (`dec.liquid-glass-fluidity`). `state` picks the behaviour gain,
   * `drive` is the saturated scroll/emergence impulse, and
   * `carrierVelocity` is the head-carrying bone's world velocity, which is
   * what makes a turned head slosh sideways. Ignored entirely while
   * `fluid.amount` is 0, so a host that never calls it is the shipped head.
   */
  setFluidDrive(
    state: BehaviorState,
    drive: number,
    carrierVelocity: readonly [number, number, number],
  ): void;
  /**
   * Hand the solver this frame's measured participants
   * (`dec.liquid-glass-participants`). One localised mode per collider, up to
   * `FLUID_PARTICIPANT_MODES`; anything beyond that is dropped rather than
   * folded together, because two obstacles averaged into one mode cancel
   * instead of denting both sides.
   *
   * An empty list is the normal case and releases every participant mode back
   * to rest, so a page that marks nothing is the shipped head exactly.
   */
  setStageColliders(colliders: readonly StageCollider[]): void;
  /**
   * The solved flow of each participant mode, XYZ per slot, world units.
   * Written in place every frame so the core can push the participants back
   * without allocating; `length` is `3 * FLUID_PARTICIPANT_MODES` and slots
   * past the collider count are 0.
   */
  readonly stageFlow: Float32Array;
  /**
   * Bind-space vertical extent of the loaded body, for the melt map
   * (`dec.liquid-glass-melt`). The melt is a function of normalised height, and
   * the shader cannot derive the bust's extent: there is no spare vertex
   * attribute for it and both interleaved buffers are full. So the core
   * measures it once at avatar load and pushes it here.
   *
   * A replacement avatar is measured on its own terms rather than inheriting
   * the shipped bust's numbers. A degenerate extent leaves the melt inert.
   */
  setBodyExtent(minY: number, maxY: number): void;
  update(dt: number): void;
  /** Shorten or snap emergence ramps when reduced motion is requested. */
  setReducedMotion(reduced: boolean): void;
}

// ---------------------------------------------------------------------------
// Renderer (dec.renderer-posture)
// ---------------------------------------------------------------------------

export interface RendererHost extends Disposable {
  /** Async: WebGPURenderer init resolves after backend selection. */
  init(canvas: HTMLCanvasElement): Promise<void>;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly backend: 'webgpu' | 'webgl2' | 'uninitialized';
  setSize(width: number, height: number, pixelRatio?: number): void;
  setClippingPlane(plane: THREE.Plane): void;
  render(): void;
  /** Raw WebGPURenderer once init resolves (for KTX2 support detection). */
  readonly gpuRenderer: unknown;
}

// ---------------------------------------------------------------------------
// Engine (dec.api-emphasis): imperative advanced surface
// ---------------------------------------------------------------------------

export interface ViewPose {
  /**
   * Orbit about the world Y axis, radians. 0 is straight on, positive turns
   * the camera to the head's left. Wrapped to (-PI, PI].
   */
  readonly yaw?: number;
  /** Camera eye height above the origin plane, world units. */
  readonly height?: number;
  /** Camera distance from the head on its own view axis, world units. */
  readonly distance?: number;
  /** Height of the point the camera aims at, world units. */
  readonly lookAt?: number;
  /** Vertical field of view, degrees. */
  readonly fov?: number;
}

export interface EngineOptions {
  avatarUrl?: string;
  textSource?: TextSkinSource;
  ttsAdapter?: TTSAdapter;
  headConfig?: HeadConfigOverrides;
  view?: ViewPose;
  reducedMotion?: boolean;
}

export interface EngineEvents extends Record<string, unknown> {
  ready: void;
  statechange: { from: BehaviorState; to: BehaviorState };
  speechstart: void;
  speechend: void;
  error: Error;
}

/**
 * Rasterises a DOM subtree to something a `THREE.Texture` can upload. Injected
 * rather than imported so the library ships with no rasteriser of its own: the
 * default lazily imports the optional `@zumer/snapdom` peer only once a host
 * has actually named a subtree.
 */
export type LensRasteriser = (element: Element) => Promise<CanvasImageSource>;

export interface LensSourceOptions {
  readonly rasterise?: LensRasteriser;
}

export interface Engine extends Emitter<EngineEvents>, Disposable {
  mount(canvas: HTMLCanvasElement, host: Element): Promise<void>;
  resize(width: number, height: number): void;
  speak(text: string): Promise<void>;
  setEmotion(expression: Expression): void;
  setScrollProgress(progress: number): void;
  setTextSkinSource(source: TextSkinSource): void;
  /** Merge a declarative camera pose into the live resolved view. */
  setView(pose: ViewPose): void;
  /** Live, validated camera pose. */
  readonly view: Required<ViewPose>;
  setVoiceAdapter(adapter: TTSAdapter): void;
  /**
   * Name a subtree for the head to refract, or `null` to stop refracting
   * (dec.liquid-glass-architecture, rung 3). NEVER pass `document.body`: the
   * fidelity traps (cross-origin images, `position: fixed`, capture cost)
   * scale with what is inside.
   *
   * Once the snapshot lands this stands the compositor glass layer down, if
   * the host had one (`dec.liquid-glass-rung-exclusion`). Passing `null`
   * brings it back on the next frame.
   */
  setLensSource(element: Element | null, options?: LensSourceOptions): void;
  /**
   * Recapture the named subtree now. Captures otherwise happen only when the
   * sampled window settles after moving, never per frame.
   */
  captureLens(): void;
  /**
   * Rescan the document for `data-hologlyph-obstacle` and
   * `data-hologlyph-body` (`dec.liquid-glass-participants`).
   *
   * The engine scans once at mount and then watches the marked elements. It
   * does NOT watch the whole document for new markers unless it found at
   * least one at mount, because a subtree `MutationObserver` on a page that
   * uses none of this is exactly the cost the drop-in promise forbids. A host
   * that marks its first participant after mount calls this.
   */
  refreshStage(): void;
  /** Freeze or unfreeze all procedural motion (idle, gaze, nods) so
   * successive frames hold an identical pose; used by deterministic
   * captures. Rendering and text-skin flow continue. */
  setMotionFrozen(frozen: boolean): void;
  readonly state: BehaviorState;
  /** Advanced hooks (documented, non-primary). */
  readonly motion: MotionEngine;
  readonly behavior: BehaviorMachine;
  readonly speech: SpeechEngine;
  readonly audio: AudioEngine;
  readonly vfx: VFXEngine;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
