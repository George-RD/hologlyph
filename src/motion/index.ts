/**
 * MotionEngine: blendshape expressions, gaze/saccades, procedural nods, and
 * live viseme lip-sync. All behaviour is driven by update(dt, elapsed) so it is
 * testable without a GPU context; observers are never created here.
 *
 * Per dec.expression-vocab and dec.performance-budget:
 *  - Semantic expressions crossfade over time, clamped to [0,1].
 *  - Visemes take priority over expression weights on the mouth region.
 *  - Reduced motion damps nods, disables saccades, and shortens crossfades.
 */

import type {
  LoadedAvatar,
  Expression,
  NodClass,
  GazeMode,
  VisemeFrame,
  MotionEngine,
} from '../contracts';
import { RIG_EXPRESSION_MORPHS, RIG_VISEME_MORPHS, clamp01 } from '../contracts';
import { weightsFor, lerpWeights, emptyExpressionWeights } from './expressions';
import { GazeController, type Rng, type Clock } from './gaze';
import { NOD_SPECS } from './nods';

type Bone = NonNullable<LoadedAvatar['bones']['eyeL']>;
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Mouth region: all viseme morphs plus jaw_open. */
const MOUTH: Record<string, true> = {};
for (const m of [...RIG_VISEME_MORPHS, 'jaw_open']) MOUTH[m] = true;

export interface MotionEngineOptions {
  /** Deterministic randomness source (defaults to Math.random). */
  rng?: Rng;
  /** Time source in seconds; when omitted update()'s elapsed argument is used. */
  clock?: Clock;
}

export function createMotionEngine(options: MotionEngineOptions = {}): MotionEngine {
  const rng: Rng = options.rng ?? Math.random;
  const clockOpt = options.clock;

  let avatar: LoadedAvatar | null = null;
  let baseEyeL: Vec3 | null = null;
  let baseEyeR: Vec3 | null = null;
  let baseHead: Vec3 | null = null;

  let fromWeights = emptyExpressionWeights();
  let toWeights = weightsFor('neutral');
  let displayWeights = weightsFor('neutral');
  let fadeElapsed = 0;
  let fadeDuration = 0.35;

  let visemeFrame: VisemeFrame | null = null;

  const gaze = new GazeController(rng, clockOpt);
  let reduced = false;

  let nod: { kind: NodClass; start: number } | null = null;
  let lastNow = 0;

  function attach(a: LoadedAvatar): void {
    avatar = a;
    const bones = a.bones;
    baseEyeL = bones.eyeL
      ? { x: bones.eyeL.rotation.x, y: bones.eyeL.rotation.y, z: bones.eyeL.rotation.z }
      : null;
    baseEyeR = bones.eyeR
      ? { x: bones.eyeR.rotation.x, y: bones.eyeR.rotation.y, z: bones.eyeR.rotation.z }
      : null;
    baseHead = bones.head
      ? { x: bones.head.rotation.x, y: bones.head.rotation.y, z: bones.head.rotation.z }
      : null;
  }

  function setExpression(expr: Expression, fadeSeconds = 0.35): void {
    fromWeights = { ...displayWeights };
    toWeights = weightsFor(expr);
    fadeElapsed = 0;
    fadeDuration = reduced ? Math.min(fadeSeconds, 0.1) : fadeSeconds;
  }

  function applyVisemeFrame(frame: VisemeFrame): void {
    visemeFrame = frame;
  }

  function clearVisemes(): void {
    visemeFrame = null;
  }

  function triggerNod(kind: NodClass): void {
    const now = clockOpt ? clockOpt() : lastNow;
    nod = { kind, start: now };
  }

  function setGazeMode(mode: GazeMode): void {
    gaze.setMode(mode);
  }

  function setReducedMotion(r: boolean): void {
    reduced = r;
    gaze.setReduced(r);
  }

  function update(dt: number, elapsed: number): void {
    const now = clockOpt ? clockOpt() : elapsed;
    lastNow = now;

    // 1. Expression crossfade toward the target weight set.
    fadeElapsed += dt;
    const t = fadeDuration > 0 ? clamp01(fadeElapsed / fadeDuration) : 1;
    displayWeights = lerpWeights(fromWeights, toWeights, t);

    // 2. Gaze, applied to the eye bones when the rig exposes them.
    const g = gaze.update(dt, now);
    if (avatar) {
      applyEye(avatar.bones.eyeL, baseEyeL, g);
      applyEye(avatar.bones.eyeR, baseEyeR, g);
    }

    // 3. Procedural nod envelope on the head bone.
    let nodPitch = 0;
    if (nod) {
      const spec = NOD_SPECS[nod.kind];
      const phase = (now - nod.start) / spec.duration;
      if (phase >= 1) {
        nod = null;
      } else {
        const amp = reduced ? spec.amplitude * 0.3 : spec.amplitude;
        nodPitch = spec.evaluate(phase) * amp;
      }
    }
    if (avatar && avatar.bones.head && baseHead) {
      avatar.bones.head.rotation.x = baseHead.x + nodPitch;
    }

    // 4. Visemes override the mouth region; expression drives the rest.
    const visemeActive = visemeFrame !== null;
    const vw = visemeFrame ? visemeFrame.weights : null;

    if (avatar) {
      for (const name of RIG_EXPRESSION_MORPHS) {
        const w =
          MOUTH[name] === true && visemeActive && vw ? (vw[name] ?? 0) : (displayWeights[name] ?? 0);
        avatar.setMorph(name, clamp01(w));
      }
      for (const name of RIG_VISEME_MORPHS) {
        const w = visemeActive && vw ? (vw[name] ?? 0) : 0;
        avatar.setMorph(name, clamp01(w));
      }
    }
  }

  function dispose(): void {
    avatar = null;
    visemeFrame = null;
    nod = null;
    baseEyeL = null;
    baseEyeR = null;
    baseHead = null;
  }

  return {
    attach,
    update,
    setExpression,
    applyVisemeFrame,
    clearVisemes,
    triggerNod,
    setGazeMode,
    setReducedMotion,
    dispose,
  };
}

function applyEye(bone: Bone | undefined, base: Vec3 | null, g: { pitch: number; yaw: number }): void {
  if (!bone || !base) return;
  bone.rotation.x = base.x + g.pitch;
  bone.rotation.y = base.y + g.yaw;
}
