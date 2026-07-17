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

export interface LoadedAvatar extends Disposable {
  readonly root: THREE.Group;
  /** Meshes carrying the canonical morph targets. */
  readonly morphMeshes: THREE.Mesh[];
  readonly bones: Partial<Record<keyof typeof RIG_BONES, THREE.Bone>>;
  readonly animations: THREE.AnimationClip[];
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
}

// ---------------------------------------------------------------------------
// Shaders / VFX (dec.renderer-posture)
// ---------------------------------------------------------------------------

export interface VFXEngine extends Disposable {
  /** Build the single-source TSL text-skin material for the bust. */
  createSkinMaterial(skin: TextSkinEngine): THREE.Material;
  /** Emergence progress [0,1]: 0 = fully submerged, 1 = fully emerged. */
  setEmergence(progress: number): void;
  readonly emergence: number;
  /** Root Y translation for the current emergence (pairs with clip plane). */
  readonly rootOffsetY: number;
  readonly clippingPlane: THREE.Plane;
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
// Engine (dec.api-emphasis) — imperative advanced surface
// ---------------------------------------------------------------------------

export interface EngineOptions {
  avatarUrl?: string;
  textSource?: TextSkinSource;
  ttsAdapter?: TTSAdapter;
  reducedMotion?: boolean;
}

export interface EngineEvents extends Record<string, unknown> {
  ready: void;
  statechange: { from: BehaviorState; to: BehaviorState };
  speechstart: void;
  speechend: void;
  error: Error;
}

export interface Engine extends Emitter<EngineEvents>, Disposable {
  mount(canvas: HTMLCanvasElement, host: Element): Promise<void>;
  speak(text: string): Promise<void>;
  setEmotion(expression: Expression): void;
  setScrollProgress(progress: number): void;
  setTextSkinSource(source: TextSkinSource): void;
  setVoiceAdapter(adapter: TTSAdapter): void;
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
